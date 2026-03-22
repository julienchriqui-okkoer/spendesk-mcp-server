#!/usr/bin/env node
/**
 * Quick test: spawn the MCP server with SPENDESK_USE_DEMO=true, send initialize + tools/list + one tool call.
 * Requires: SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET (or _DEMO pair; e.g. from .env).
 * SPENDESK_API_TOKEN is cleared so the server uses client_credentials only (same idea as test:sandbox-api).
 * Usage: npm run test:mcp   or   node scripts/test-mcp.mjs
 */
import { spawn } from "child_process";

const demoId = process.env.SPENDESK_CLIENT_ID_DEMO;
const demoSecret = process.env.SPENDESK_CLIENT_SECRET_DEMO;
const prodId = process.env.SPENDESK_CLIENT_ID;
const prodSecret = process.env.SPENDESK_CLIENT_SECRET;
if ((!demoId || !demoSecret) && (!prodId || !prodSecret)) {
  console.error("Set SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET (or SPENDESK_CLIENT_ID_DEMO + SPENDESK_CLIENT_SECRET_DEMO).");
  process.exit(1);
}

const server = spawn("node", ["dist/index.js"], {
  env: { ...process.env, SPENDESK_USE_DEMO: "true", SPENDESK_API_TOKEN: "", SPENDESK_REFRESH_TOKEN: "" },
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
let resolved = false;

function send(msg) {
  const line = JSON.stringify(msg) + "\n";
  server.stdin.write(line);
}

function resolve(result) {
  if (resolved) return;
  resolved = true;
  server.kill();
  if (!result) process.exit(1);
  return result;
}

server.stdout.setEncoding("utf8");
let initDone = false;
function processLine(line) {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
      if (msg.result?.serverInfo && !initDone) {
        initDone = true;
        console.log("✓ initialize OK — server:", msg.result.serverInfo.name);
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        return;
      }
      if (msg.result?.tools?.length) {
        console.log("✓ tools/list OK —", msg.result.tools.length, "tools");
        send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "spendesk_get_wallet_summary", arguments: {} },
        });
        return;
      }
      if (msg.result?.content) {
        console.log("✓ tools/call OK — wallet summary response received");
        resolve(true);
        return;
      }
      if (msg.error) {
        console.error("✗ MCP error:", msg.error.message || msg.error);
        resolve(false);
        return;
      }
  } catch (_) {}
}

server.stdout.on("data", (chunk) => {
  if (process.env.DEBUG) process.stderr.write("[recv] " + chunk);
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) processLine(line);
  if (buffer.trim() && (buffer.startsWith("{") && buffer.includes('"jsonrpc"'))) {
    processLine(buffer);
    buffer = "";
  }
});

server.on("error", (err) => {
  console.error("Failed to start server:", err.message);
  resolve(false);
});
server.on("exit", (code, signal) => {
  if (!resolved) resolve(false);
});

// Send initialize — then we send initialized + tools/list when we receive init result
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-mcp", version: "1.0.0" },
  },
});

// Timeout
setTimeout(() => {
  if (!resolved) {
    resolved = true;
    server.kill();
    console.error("✗ Test timeout (no response from server)");
    process.exit(1);
  }
}, 15000);

process.on("exit", (code) => {
  if (code === 0) console.log("\n✓ MCP test passed (demo URL in use).");
});
