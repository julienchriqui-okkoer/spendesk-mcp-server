#!/usr/bin/env node
import "dotenv/config";
/**
 * Spendesk MCP Server (Streamable HTTP)
 * Exposes the same MCP over HTTP for use with ChatGPT, etc.
 * @see https://developer.spendesk.com/reference/general
 */

import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { SpendeskClient } from "./spendesk-api/client.js";
import { createMcpServer } from "./lib/create-server.js";
import { authenticateClient } from "./middleware/auth.js";
import { SessionStore } from "./lib/session-store.js";
import { getRegisterForm, registerClient, getSuccessPage, getCompaniesPage, addCompany, getDocsPage } from "./routes/ui.js";

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
// Always allow Railway's healthcheck hostname
const railwayHealthcheckHost = "healthcheck.railway.app";
const allowedHostsRaw = process.env.ALLOWED_HOSTS?.trim();
const allowedHostsList = allowedHostsRaw
  ? [
      ...new Set([
        ...allowedHostsRaw.split(",").map((h) => h.trim()).filter(Boolean),
        railwayHealthcheckHost, // Always allow Railway healthcheck
        ...(HOST === "0.0.0.0" || HOST === "::" ? ["0.0.0.0", "::"] : []),
      ]),
    ]
  : undefined;
const allowedHosts = allowedHostsList?.length ? allowedHostsList : undefined;

// Create Express app with MCP support
// Note: createMcpExpressApp adds middleware that might block healthcheck
// We'll register routes before the MCP middleware takes effect
const app = createMcpExpressApp({ host: HOST, ...(allowedHosts && { allowedHosts }) });

// Register healthcheck FIRST, before any MCP middleware that might block it
// This endpoint must be accessible without any host validation for Railway healthchecks
app.get("/health", (req: Request, res: Response) => {
  try {
    const clientHost = req.get("host") || req.hostname || "unknown";
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    console.log(`[Healthcheck] Request from ${clientIp} (host: ${clientHost})`);
    
    const response = {
      status: "ok",
      timestamp: new Date().toISOString(),
      port: PORT,
      host: HOST,
      uptime: process.uptime(),
      clientHost,
    };
    console.log(`[Healthcheck] Sending 200 OK response`);
    res.status(200).type("application/json").send(JSON.stringify(response));
  } catch (err) {
    console.error("[Healthcheck] Error:", err);
    res.status(500).json({ status: "error", message: "Healthcheck failed", error: err instanceof Error ? err.message : String(err) });
  }
});

// JSON body parser for UI routes
// Note: createMcpExpressApp might already parse JSON, so we check if body exists first
app.use((req: Request, res: Response, next: NextFunction) => {
  // Skip if body already parsed or not a POST to /ui
  if (!req.path.startsWith("/ui") || req.method !== "POST") {
    return next();
  }
  
  // If body is already parsed (by createMcpExpressApp), use it
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    console.log("[BodyParser] Body already parsed:", Object.keys(req.body));
    return next();
  }
  
  // Otherwise, parse manually
  if (req.get("content-type")?.includes("application/json")) {
    console.log("[BodyParser] Parsing body manually for", req.path);
    const chunks: Buffer[] = [];
    let bodyRead = false;
    
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    
    req.on("end", () => {
      if (bodyRead) return;
      bodyRead = true;
      try {
        const data = Buffer.concat(chunks).toString("utf8");
        req.body = data ? JSON.parse(data) : {};
        console.log("[BodyParser] Manually parsed body:", Object.keys(req.body || {}));
        next();
      } catch (err) {
        console.error("[BodyParser] Parse error:", err);
        req.body = {};
        next();
      }
    });
    
    req.on("error", (err) => {
      if (bodyRead) return;
      bodyRead = true;
      console.error("[BodyParser] Stream error:", err);
      req.body = {};
      next();
    });
    
    // If stream is already ended (body already consumed), parse empty body
    if (req.readableEnded) {
      req.body = {};
      next();
    }
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


// UI Routes - Register BEFORE MCP routes to ensure they're not intercepted
app.get("/ui", getRegisterForm);
app.get("/ui/docs", getDocsPage);
app.post("/ui/register", async (req: Request, res: Response) => {
  console.log("[UI Register] Route handler called");
  console.log("[UI Register] Method:", req.method);
  console.log("[UI Register] Path:", req.path);
  console.log("[UI Register] Body:", req.body);
  await registerClient(req, res);
});
app.get("/ui/success", getSuccessPage);
app.get("/ui/companies", getCompaniesPage);
app.post("/ui/companies", async (req: Request, res: Response) => {
  await addCompany(req, res);
});

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
            sessionStore.set(id, transport, clientToken, req.clientApiKey, req.companyId);
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
    const accept = (req.headers["accept"] || "").toLowerCase();
    if (accept.includes("text/html")) {
      res.status(400).type("text/html").send(`
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>MCP Endpoint</title></head>
<body style="font-family: sans-serif; max-width: 560px; margin: 40px auto; padding: 20px;">
  <h1>Endpoint MCP</h1>
  <p>Cette URL est le point d’entrée du <strong>Model Context Protocol</strong>. Elle ne s’ouvre pas directement dans le navigateur.</p>
  <p>Pour l’utiliser : configurez un client MCP (Dust, Cursor, script) avec cette URL, puis envoyez d’abord une requête <code>POST /mcp</code> avec la méthode <code>initialize</code> pour obtenir un identifiant de session.</p>
  <p><a href="/ui/docs">Voir la documentation</a> pour la configuration pas à pas.</p>
</body>
</html>`);
    } else {
      res.status(400).send("Invalid or missing session ID");
    }
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

const server = app.listen(PORT, HOST, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : PORT;
  const actualAddress = typeof address === "object" && address ? address.address : HOST;
  
  console.log(`✓ Spendesk MCP HTTP server listening on http://${actualAddress}:${actualPort}`);
  console.log(`✓ Healthcheck available at http://${actualAddress}:${actualPort}/health`);
  console.log(`✓ Process PID: ${process.pid}`);
  console.log(`✓ Node version: ${process.version}`);
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

server.on("error", (err: Error) => {
  console.error("❌ Server error:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await sessionStore.closeAll();
  server.close(() => process.exit(0));
});
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  await sessionStore.closeAll();
  server.close(() => process.exit(0));
});

// Handle uncaught errors
process.on("uncaughtException", (err: Error) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  console.error("❌ Unhandled Rejection:", reason);
  process.exit(1);
});
