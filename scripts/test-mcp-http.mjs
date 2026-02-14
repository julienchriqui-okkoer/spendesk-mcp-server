#!/usr/bin/env node
/**
 * Test the deployed (or local) MCP HTTP server.
 * Performs: GET / (info) → POST /mcp (initialize) → POST /mcp (tools/list) → POST /mcp (tools/call).
 *
 * Usage:
 *   node scripts/test-mcp-http.mjs
 *   MCP_BASE_URL=https://your-app.up.railway.app node scripts/test-mcp-http.mjs
 *
 * Default MCP_BASE_URL: http://localhost:3000
 */
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;

/** Parse first JSON-RPC result from SSE stream (data: {...} lines). */
async function parseSSEJson(body) {
  const text = await body.getReader().then((r) => readStream(r));
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const data = line.slice(5).trim();
      if (data === "[DONE]" || !data) continue;
      try {
        return JSON.parse(data);
      } catch (_) {}
    }
  }
  return {};
}
function readStream(reader) {
  const chunks = [];
  return (function read() {
    return reader.read().then(({ value, done }) => {
      if (done) return Buffer.concat(chunks).toString("utf8");
      chunks.push(value);
      return read();
    });
  })();
}

const headers = (sessionId, protocolVersion) => {
  const h = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) h["mcp-session-id"] = sessionId;
  if (protocolVersion) h["mcp-protocol-version"] = protocolVersion;
  return h;
};

async function main() {
  console.log("Testing MCP at", BASE, "\n");

  // 1) GET / — info (and check server is reachable)
  try {
    const r0 = await fetch(BASE + "/");
    const info = await r0.json().catch(() => ({}));
    console.log("✓ GET / —", info.name || "OK", info.mcp ? `(${info.mcp})` : "");
  } catch (e) {
    const msg = e.cause?.code === "ECONNREFUSED" ? "Server not reachable (start it with npm run start:http)." : e.message;
    console.error("✗ GET / failed:", msg);
    process.exit(1);
  }

  // 2) Initialize
  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-mcp-http", version: "1.0.0" },
    },
  };

  const r1 = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(initBody),
  });

  if (!r1.ok) {
    const text = await r1.text();
    console.error("✗ initialize failed:", r1.status, text || r1.statusText);
    process.exit(1);
  }

  const sessionId = r1.headers.get("mcp-session-id");
  const protocolVersion = r1.headers.get("mcp-protocol-version");
  if (!sessionId) {
    console.error("✗ No mcp-session-id in initialize response");
    process.exit(1);
  }

  const ct = r1.headers.get("content-type") || "";
  let initResult = {};
  if (ct.includes("application/json")) {
    initResult = await r1.json().catch(() => ({}));
  } else if (ct.includes("text/event-stream")) {
    initResult = await parseSSEJson(r1.body);
  }
  const serverName = initResult?.result?.serverInfo?.name;
  console.log("✓ initialize — session:", sessionId?.slice(0, 8) + "...", serverName ? `(${serverName})` : "");

  // 3) notifications/initialized (required after initialize)
  await fetch(MCP_URL, {
    method: "POST",
    headers: headers(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  // 4) tools/list
  const r2 = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }),
  });

  if (!r2.ok) {
    console.error("✗ tools/list failed:", r2.status, await r2.text());
    process.exit(1);
  }

  const ct2 = r2.headers.get("content-type") || "";
  let listResult = {};
  if (ct2.includes("application/json")) {
    listResult = await r2.json().catch(() => ({}));
  } else if (ct2.includes("text/event-stream")) {
    listResult = await parseSSEJson(r2.body);
  }
  const tools = listResult?.result?.tools ?? [];
  console.log("✓ tools/list —", tools.length, "tools");

  // 5) tools/call — spendesk_get_wallet_summary (read-only, safe)
  const r3 = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "spendesk_get_wallet_summary",
        arguments: {},
      },
    }),
  });

  if (!r3.ok) {
    console.error("✗ tools/call failed:", r3.status, await r3.text());
    process.exit(1);
  }

  const ct3 = r3.headers.get("content-type") || "";
  let callResult = {};
  if (ct3.includes("application/json")) {
    callResult = await r3.json().catch(() => ({}));
  } else if (ct3.includes("text/event-stream")) {
    callResult = await parseSSEJson(r3.body);
  }
  if (callResult?.error) {
    console.error("✗ tools/call error:", callResult.error.message || callResult.error);
    process.exit(1);
  }
  const content = callResult?.result?.content;
  console.log("✓ tools/call (spendesk_get_wallet_summary) —", Array.isArray(content) ? content.length : 1, "content block(s)");

  console.log("\n✓ MCP HTTP test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
