#!/usr/bin/env node
import "dotenv/config";
/**
 * Spendesk MCP Server (Streamable HTTP)
 * Exposes the same MCP over HTTP for use with ChatGPT, etc.
 * @see https://developer.spendesk.com/reference/general
 */

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { SpendeskClient } from "./spendesk-api/client.js";
import { ClientCredentialsAuth } from "./spendesk-api/client-credentials-auth.js";
import { createMcpServer } from "./lib/create-server.js";
import { authenticateClient, type ClientCredentials } from "./middleware/auth.js";
import { SessionStore } from "./lib/session-store.js";
import { mcpSessionStorage } from "./lib/request-context.js";
import { closeSessionDb } from "./lib/ephemeral-sqlite.js";
import { logHttpRequestUsage } from "./lib/usage-logger.js";
import { getTopTools, getVolumeByDay, getRecentCalls } from "./lib/usage-stats.js";

/** Resolve client ID for env fallback: demo or prod according to useDemo. */
function getEnvClientId(useDemo: boolean): string | null {
  if (useDemo) {
    return process.env.SPENDESK_CLIENT_ID_DEMO?.trim() || null;
  }
  return process.env.SPENDESK_CLIENT_ID?.trim() || null;
}

/** Resolve client secret for env fallback: demo or prod according to useDemo. */
function getEnvClientSecret(useDemo: boolean): string | null {
  if (useDemo) {
    return process.env.SPENDESK_CLIENT_SECRET_DEMO?.trim() || null;
  }
  return process.env.SPENDESK_CLIENT_SECRET?.trim() || null;
}

let fallbackClientCredentialsProd: ClientCredentialsAuth | null = null;
let fallbackClientCredentialsDemo: ClientCredentialsAuth | null = null;

function getFallbackClientCredentials(baseUrl: string, useDemo: boolean): ClientCredentialsAuth | null {
  const id = getEnvClientId(useDemo);
  const secret = getEnvClientSecret(useDemo);
  if (!id || !secret) return null;
  if (useDemo) {
    if (!fallbackClientCredentialsDemo) {
      fallbackClientCredentialsDemo = new ClientCredentialsAuth({
        baseUrl,
        clientId: id,
        clientSecret: secret,
      });
    }
    return fallbackClientCredentialsDemo;
  }
  if (!fallbackClientCredentialsProd) {
    fallbackClientCredentialsProd = new ClientCredentialsAuth({
      baseUrl,
      clientId: id,
      clientSecret: secret,
    });
  }
  return fallbackClientCredentialsProd;
}

// Extended session store with client token support
const sessionStore = new SessionStore();

function buildApi(
  clientToken?: string,
  clientCredentials?: ClientCredentials,
  /** From X-Spendesk-Use-Demo on the initialize request (Dust / multi-tenant). */
  useDemoClientHint?: boolean
): SpendeskClient {
  const useDemoFromEnv = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
  const useDemo = useDemoClientHint !== undefined ? useDemoClientHint : useDemoFromEnv;
  const baseUrl =
    process.env.SPENDESK_BASE_URL ||
    (useDemo ? "https://beta-sandbox.api.trunk.spendesk.services" : "https://public-api.spendesk.com");

  // 1) Credentials provided by client at connection time (Dust/Claude)
  if (clientCredentials) {
    const cc = new ClientCredentialsAuth({
      baseUrl,
      clientId: clientCredentials.clientId,
      clientSecret: clientCredentials.clientSecret,
    });
    return new SpendeskClient({
      apiToken: "",
      useDemo,
      baseUrl,
      getToken: () => cc.getAccessToken(),
      on401Refresh: () => cc.refresh(),
    });
  }

  // 2) Bearer token supplied by the HTTP client (not read from SPENDESK_API_TOKEN in env)
  if (clientToken) {
    return new SpendeskClient({
      apiToken: clientToken,
      useDemo,
      baseUrl,
    });
  }

  // 3) Server env: OAuth2 client credentials only
  const cc = getFallbackClientCredentials(baseUrl, useDemo);
  if (cc) {
    return new SpendeskClient({
      apiToken: "",
      useDemo,
      baseUrl,
      getToken: () => cc.getAccessToken(),
      on401Refresh: () => cc.refresh(),
    });
  }

  throw new Error(
    useDemo
      ? "No Spendesk demo credentials. Set SPENDESK_USE_DEMO=true and SPENDESK_CLIENT_ID_DEMO + SPENDESK_CLIENT_SECRET_DEMO (or SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET), or have the client send Bearer client_credentials."
      : "No Spendesk API credentials. Use Bearer client_credentials:<base64(id:secret)>, headers X-Spendesk-Client-Id + X-Spendesk-Client-Secret, or set SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET in env."
  );
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

// Rate limiting: reduce abuse on public endpoint
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "MCP rate limit exceeded." },
});
app.use(globalLimiter);

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

app.get("/", (_req: Request, res: Response) => {
  res.status(200).type("application/json").send(
    JSON.stringify({
      name: "spendesk-mcp-server",
      status: "ok",
      mcp: "/mcp",
      doc: "/doc",
      usage: "/usage",
      endpoints: {
        post: "POST /mcp (JSON-RPC)",
        get: "GET /mcp (SSE, send mcp-session-id)",
        delete: "DELETE /mcp (close session)",
        doc: "GET /doc (redirect to documentation)",
        usage: "GET /usage (MCP usage dashboard; if USAGE_UI_SECRET set, use Authorization: Bearer)",
      },
    })
  );
});

// GET /doc — redirect to Mintlify documentation (DOCS_URL) or show link
const DOCS_URL = process.env.DOCS_URL?.trim() || "";
app.get("/doc", (_req: Request, res: Response) => {
  if (DOCS_URL) {
    res.redirect(302, DOCS_URL);
    return;
  }
  res.status(200).type("text/html").send(`
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Documentation - Spendesk MCP</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 40px auto; padding: 24px;">
  <h1>Documentation</h1>
  <p>Pour afficher la documentation MCP (Mintlify), définissez la variable d'environnement <code>DOCS_URL</code> avec l'URL de votre doc (ex. https://votre-doc.mintlify.app).</p>
  <p>Une fois configurée, <code>GET /doc</code> redirigera automatiquement vers cette URL.</p>
</body>
</html>`);
});

// GET /usage — MCP usage dashboard (optional: set USAGE_UI_SECRET to require Authorization: Bearer; never use secret in URL)
const USAGE_UI_SECRET = process.env.USAGE_UI_SECRET?.trim() || "";
app.get("/usage", (req: Request, res: Response) => {
  if (USAGE_UI_SECRET) {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    if (token !== USAGE_UI_SECRET) {
      res.status(401).json({ error: "Unauthorized: missing or invalid Authorization header" });
      return;
    }
  }

  const topTools = getTopTools(20);
  const volumeByDay = getVolumeByDay(30);
  const recentCalls = getRecentCalls(50);

  const data = { topTools, volumeByDay, recentCalls };
  const dataJson = JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>");

  res.status(200).type("text/html").send(`
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MCP Usage — Spendesk</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #e2e8f0; }
    h1 { font-size: 1.5rem; margin-bottom: 24px; }
    h2 { font-size: 1.1rem; margin-top: 32px; margin-bottom: 12px; color: #94a3b8; }
    section { max-width: 900px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; font-weight: 600; }
    tr:hover { background: #1e293b; }
    .chart-wrap { max-width: 600px; height: 220px; margin-bottom: 24px; }
    .meta { font-size: 0.75rem; color: #64748b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  </style>
</head>
<body>
  <h1>MCP Usage</h1>
  <section>
    <h2>Volume par jour (30 derniers jours)</h2>
    <div class="chart-wrap"><canvas id="chart"></canvas></div>
  </section>
  <section>
    <h2>Top tools</h2>
    <table>
      <thead><tr><th>Tool</th><th>Catégorie</th><th>Appels</th></tr></thead>
      <tbody id="top-tools"></tbody>
    </table>
  </section>
  <section>
    <h2>Derniers appels</h2>
    <table>
      <thead><tr><th>Date</th><th>Méthode</th><th>Tool</th><th>Catégorie</th><th>Statut</th><th>Durée (ms)</th><th>Meta</th></tr></thead>
      <tbody id="recent-calls"></tbody>
    </table>
  </section>
  <script type="application/json" id="usage-data">${dataJson}</script>
  <script>
    var raw = document.getElementById('usage-data').textContent;
    var data = JSON.parse(raw);
    var labels = data.volumeByDay.map(function(r) { return r.day; });
    var values = data.volumeByDay.map(function(r) { return r.total; });
    new Chart(document.getElementById('chart'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{ label: 'Appels', data: values, borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.1)', fill: true }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
    var topToolsEl = document.getElementById('top-tools');
    data.topTools.forEach(function(r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escapeHtml(r.tool_name) + '</td><td>' + escapeHtml(r.category || '') + '</td><td>' + r.calls + '</td>';
      topToolsEl.appendChild(tr);
    });
    var recentEl = document.getElementById('recent-calls');
    data.recentCalls.forEach(function(r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escapeHtml(r.ts) + '</td><td>' + escapeHtml(r.method || '') + '</td><td>' + escapeHtml(r.tool_name || '') + '</td><td>' + escapeHtml(r.category || '') + '</td><td>' + escapeHtml(r.status || '') + '</td><td>' + (r.duration_ms != null ? r.duration_ms : '') + '</td><td class="meta" title="' + escapeAttr(r.meta || '') + '">' + escapeHtml((r.meta || '').slice(0, 60)) + '</td>';
      recentEl.appendChild(tr);
    });
    function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function escapeAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  </script>
</body>
</html>`);
});

// Apply authentication middleware and stricter rate limit to MCP routes
app.use("/mcp", mcpLimiter);
app.post("/mcp", authenticateClient, async (req: Request, res: Response) => {
  const start = Date.now();
  const sessionId = (req.headers["mcp-session-id"] as string) ?? null;
  await mcpSessionStorage.run(sessionId, async () => {
    try {
      const sid = req.headers["mcp-session-id"] as string | undefined;
      const sessionInfo = sid ? sessionStore.get(sid) : undefined;
      let transport: StreamableHTTPServerTransport | undefined = sessionInfo?.transport;

      if (transport) {
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sid && isInitializeRequest(req.body)) {
        const clientToken = req.clientToken;
        const clientCredentials = req.clientCredentials;

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            if (transport) {
              sessionStore.set(id, transport, clientToken, clientCredentials);
            }
          },
        });

        const api = buildApi(clientToken, clientCredentials, req.spendeskUseDemoHint);
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
  } finally {
    try {
      const durationMs = Date.now() - start;
      const authHeader = req.headers.authorization;
      const bearer =
        authHeader && authHeader.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7).trim()
          : undefined;

      logHttpRequestUsage({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
          clientIdentifier: bearer ?? null,
          companyKey: null,
        sessionId: (req.headers["mcp-session-id"] as string | undefined) ?? null,
      });
    } catch (logErr) {
      console.error("[UsageLogger] Failed to log /mcp HTTP request:", logErr);
    }
  }
  });
});

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = (req.headers["mcp-session-id"] as string) ?? null;
  await mcpSessionStorage.run(sessionId, async () => {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  const sessionInfo = sid ? sessionStore.get(sid) : undefined;
  if (!sid || !sessionInfo) {
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
  <p><a href="/doc">Voir la documentation</a> pour la configuration pas à pas.</p>
</body>
</html>`);
    } else {
      res.status(400).send("Invalid or missing session ID");
    }
    return;
  }
  await sessionInfo.transport.handleRequest(req, res);
  });
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId) {
    const sessionInfo = sessionStore.get(sessionId);
    if (sessionInfo) {
      await sessionInfo.transport.close();
      sessionStore.delete(sessionId);
      closeSessionDb(sessionId);
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
  console.log("  GET  /doc — Documentation (redirect if DOCS_URL set)");
  console.log("  GET  /usage — MCP usage dashboard");
  
  const useDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
  const pair = (a?: string, b?: string) => Boolean(a?.trim() && b?.trim());
  const hasEnvCc = useDemo
    ? pair(process.env.SPENDESK_CLIENT_ID_DEMO, process.env.SPENDESK_CLIENT_SECRET_DEMO) ||
      pair(process.env.SPENDESK_CLIENT_ID, process.env.SPENDESK_CLIENT_SECRET)
    : pair(process.env.SPENDESK_CLIENT_ID, process.env.SPENDESK_CLIENT_SECRET);
  if (hasEnvCc) {
    console.log("✓ Spendesk client credentials in env (server fallback for /mcp when request has no auth)");
  } else {
    console.warn(
      "⚠ No SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET in env — each /mcp client must send Bearer client_credentials (or X-Spendesk-Client-Id / Secret)"
    );
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
