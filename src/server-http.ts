#!/usr/bin/env node
import "dotenv/config";
/**
 * Spendesk MCP Server (Streamable HTTP)
 * Exposes the same MCP over HTTP for use with ChatGPT, etc.
 * @see https://developer.spendesk.com/reference/general
 */

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { SpendeskClient } from "./spendesk-api/client.js";
import { createMcpServer } from "./lib/create-server.js";
import { authenticateClient } from "./middleware/auth.js";
import { SessionStore } from "./lib/session-store.js";
import { getRegisterForm, registerClient, getSuccessPage } from "./routes/ui.js";

function getApiToken(): string | null {
  return process.env.SPENDESK_API_TOKEN || null;
}

// Extended session store with client token support
const sessionStore = new SessionStore();

function buildApi(clientToken?: string): SpendeskClient {
  // Use client token if provided, otherwise fallback to env var
  const apiToken = clientToken || getApiToken();
  if (!apiToken) {
    throw new Error(
      "No Spendesk API token available. Either provide X-Client-Token header or set SPENDESK_API_TOKEN environment variable."
    );
  }
  const useDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
  const baseUrl = process.env.SPENDESK_BASE_URL;
  return new SpendeskClient({ apiToken, useDemo, baseUrl });
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Build allowedHosts only when ALLOWED_HOSTS is set (e.g. in production). When unset, no validation so healthchecks and first deploy succeed (e.g. Railway); set ALLOWED_HOSTS to your public domain and redeploy to restrict hosts.
const allowedHostsRaw = process.env.ALLOWED_HOSTS?.trim();
const allowedHostsList = allowedHostsRaw
  ? [...new Set([...allowedHostsRaw.split(",").map((h) => h.trim()).filter(Boolean), ...(HOST === "0.0.0.0" || HOST === "::" ? ["0.0.0.0", "::"] : [])])]
  : undefined;
const allowedHosts = allowedHostsList?.length ? allowedHostsList : undefined;

const app = createMcpExpressApp({ host: HOST, ...(allowedHosts && { allowedHosts }) });

// JSON body parser for UI routes
app.use((req: Request, res: Response, next) => {
  if (req.path.startsWith("/ui") && req.method === "POST") {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        req.body = data ? JSON.parse(data) : {};
      } catch {
        req.body = {};
      }
      next();
    });
  } else {
    next();
  }
});

app.get("/", (_req: Request, res: Response) => {
  res.status(200).type("application/json").send(
    JSON.stringify({
      name: "spendesk-mcp-server",
      status: "ok",
      mcp: "/mcp",
      ui: "/ui",
      endpoints: {
        post: "POST /mcp (JSON-RPC)",
        get: "GET /mcp (SSE, send mcp-session-id)",
        delete: "DELETE /mcp (close session)",
        ui: "GET /ui (Client registration portal)",
      },
    })
  );
});

// Explicit healthcheck endpoint for Railway
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).type("application/json").send(
    JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
    })
  );
});

// UI Routes
app.get("/ui", getRegisterForm);
app.post("/ui/register", registerClient);
app.get("/ui/success", getSuccessPage);

// Apply authentication middleware to MCP routes
app.post("/mcp", authenticateClient, async (req: Request, res: Response) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const sessionInfo = sessionId ? sessionStore.get(sessionId) : undefined;
    let transport: StreamableHTTPServerTransport | undefined = sessionInfo?.transport;

    if (transport) {
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      // Get client token from request (set by middleware) or use env fallback
      const clientToken = req.clientToken;
      
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          if (transport) {
            sessionStore.set(id, transport, clientToken, req.clientApiKey);
          }
        },
      });
      
      const api = buildApi(clientToken);
      const mcp = createMcpServer(api);
      await mcp.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID or missing initialize request" },
      id: null,
    });
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      const errorMessage = err instanceof Error ? err.message : "Internal server error";
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: errorMessage },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const sessionInfo = sessionId ? sessionStore.get(sessionId) : undefined;
  if (!sessionId || !sessionInfo) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await sessionInfo.transport.handleRequest(req, res);
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId) {
    const sessionInfo = sessionStore.get(sessionId);
    if (sessionInfo) {
      await sessionInfo.transport.close();
      sessionStore.delete(sessionId);
    }
  }
  res.status(204).send();
});

const server = app.listen(PORT, () => {
  console.log(`✓ Spendesk MCP HTTP server listening on http://${HOST}:${PORT}`);
  console.log("  GET  /health — Health check endpoint");
  console.log("  GET  / — Server info");
  console.log("  POST /mcp — JSON-RPC (init and messages)");
  console.log("  GET  /mcp — SSE stream (send mcp-session-id header)");
  console.log("  DELETE /mcp — close session (send mcp-session-id header)");
  console.log("  GET  /ui — Client registration portal");
  
  // Log environment status
  if (process.env.ENCRYPTION_KEY) {
    console.log("✓ ENCRYPTION_KEY configured");
  } else {
    console.warn("⚠ ENCRYPTION_KEY not set - multi-tenant mode will not work");
  }
  
  if (process.env.SPENDESK_API_TOKEN) {
    console.log("✓ SPENDESK_API_TOKEN configured (fallback mode)");
  } else {
    console.warn("⚠ SPENDESK_API_TOKEN not set - clients must register via /ui");
  }
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await sessionStore.closeAll();
  server.close(() => process.exit(0));
});
process.on("SIGTERM", async () => {
  await sessionStore.closeAll();
  server.close(() => process.exit(0));
});
