#!/usr/bin/env node
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

function getApiToken(): string {
  const token = process.env.SPENDESK_API_TOKEN;
  if (!token) {
    console.error("SPENDESK_API_TOKEN is required. Set it in your environment or .env.");
    process.exit(1);
  }
  return token;
}

// Session store: sessionId -> transport (for GET SSE and subsequent POSTs)
const transports: Record<string, StreamableHTTPServerTransport> = {};

function buildApi(): SpendeskClient {
  const apiToken = getApiToken();
  const useDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
  const baseUrl = process.env.SPENDESK_BASE_URL;
  return new SpendeskClient({ apiToken, useDemo, baseUrl });
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Build allowedHosts: from ALLOWED_HOSTS (comma-separated) or default; when binding to 0.0.0.0/:: always allow those hostnames so requests to the bind address succeed
const allowedHostsRaw = process.env.ALLOWED_HOSTS;
const baseHosts =
  allowedHostsRaw?.trim()
    ? allowedHostsRaw.split(",").map((h) => h.trim()).filter(Boolean)
    : ["localhost", "127.0.0.1", "[::1]"];
const bindHosts = HOST === "0.0.0.0" || HOST === "::" ? ["0.0.0.0", "::"] : [];
const allowedHostsList = [...new Set([...baseHosts, ...bindHosts])];
const allowedHosts = allowedHostsList.length ? allowedHostsList : undefined;

const app = createMcpExpressApp({ host: HOST, ...(allowedHosts && { allowedHosts }) });

app.get("/", (_req: Request, res: Response) => {
  res.type("application/json").send(
    JSON.stringify({
      name: "spendesk-mcp-server",
      mcp: "/mcp",
      endpoints: { post: "POST /mcp (JSON-RPC)", get: "GET /mcp (SSE, send mcp-session-id)", delete: "DELETE /mcp (close session)" },
    })
  );
});

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined = sessionId ? transports[sessionId] : undefined;

    if (transport) {
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          if (transport) transports[id] = transport;
        },
      });
      const api = buildApi();
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
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && transports[sessionId]) {
    await transports[sessionId].close();
    delete transports[sessionId];
  }
  res.status(204).send();
});

const server = app.listen(PORT, () => {
  console.log(`Spendesk MCP HTTP server listening on http://${HOST}:${PORT}`);
  console.log("  POST /mcp — JSON-RPC (init and messages)");
  console.log("  GET  /mcp — SSE stream (send mcp-session-id header)");
  console.log("  DELETE /mcp — close session (send mcp-session-id header)");
});

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  for (const id of Object.keys(transports)) {
    await transports[id].close();
    delete transports[id];
  }
  server.close(() => process.exit(0));
});
process.on("SIGTERM", async () => {
  for (const id of Object.keys(transports)) {
    await transports[id].close();
    delete transports[id];
  }
  server.close(() => process.exit(0));
});
