#!/usr/bin/env node
/**
 * Test list tools with fetch-all-pages: settlements (Q1 2026), suppliers, purchase orders (Q1 2026).
 * Usage: node scripts/test-list-tools.mjs
 * Server must load .env (e.g. npm run start:http from project root).
 */
const Q1_2026 = { from: "2026-01-01", to: "2026-03-31" };
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;
const X_CLIENT_TOKEN = process.env.X_CLIENT_TOKEN?.trim();

function getHeaders(sessionId, protocolVersion) {
  const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) h["mcp-session-id"] = sessionId;
  if (protocolVersion) h["mcp-protocol-version"] = protocolVersion;
  if (X_CLIENT_TOKEN) h["x-client-token"] = X_CLIENT_TOKEN;
  return h;
}

async function mcpCall(sessionId, protocolVersion, toolName, args = {}) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: getHeaders(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e6),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const text = data.result?.content?.[0]?.text;
  if (!text) return data.result;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text);
  }
}

async function main() {
  console.log("Testing list tools (fetch-all-pages) at", BASE);
  console.log("");

  const r1 = await fetch(MCP_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-list-tools", version: "1.0.0" },
      },
    }),
  });
  if (!r1.ok) {
    console.error("✗ Initialize failed:", r1.status, await r1.text());
    process.exit(1);
  }
  const sessionId = r1.headers.get("mcp-session-id");
  const protocolVersion = r1.headers.get("mcp-protocol-version");
  if (!sessionId) {
    console.error("✗ No session ID.");
    process.exit(1);
  }

  await fetch(MCP_URL, {
    method: "POST",
    headers: getHeaders(sessionId, protocolVersion),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  console.log("1) spendesk_get_settlements (Q1 2026: clearedFrom/clearedTo)");
  try {
    const out = await mcpCall(sessionId, protocolVersion, "spendesk_get_settlements", {
      clearedFrom: Q1_2026.from,
      clearedTo: Q1_2026.to,
    });
    const data = Array.isArray(out?.data) ? out.data : out?.settlements ?? [];
    const total = out?.meta?.pagination?.total ?? data.length;
    console.log("   data.length:", data.length, "| meta.pagination.total:", total);
    if (data.length) console.log("   first:", data[0]?.id ?? data[0]?.key ?? "(see data)");
    console.log("   ✓");
  } catch (e) {
    console.error("   ✗", e.message);
  }

  console.log("\n2) spendesk_get_suppliers (all)");
  try {
    const out = await mcpCall(sessionId, protocolVersion, "spendesk_get_suppliers", {});
    const data = Array.isArray(out?.data) ? out.data : out?.suppliers ?? [];
    const total = out?.meta?.pagination?.total ?? data.length;
    console.log("   data.length:", data.length, "| meta.pagination.total:", total);
    if (data.length) console.log("   first:", data[0]?.name ?? data[0]?.id ?? "(see data)");
    console.log("   ✓");
  } catch (e) {
    console.error("   ✗", e.message);
  }

  console.log("\n3) spendesk_get_purchase_orders (Q1 2026: createdFrom/createdTo)");
  try {
    const out = await mcpCall(sessionId, protocolVersion, "spendesk_get_purchase_orders", {
      createdFrom: Q1_2026.from,
      createdTo: Q1_2026.to,
    });
    const data = Array.isArray(out?.data) ? out.data : out?.purchaseOrders ?? [];
    const total = out?.meta?.pagination?.total ?? data.length;
    console.log("   data.length:", data.length, "| meta.pagination.total:", total);
    if (data.length) console.log("   first:", data[0]?.id ?? data[0]?.number ?? "(see data)");
    console.log("   ✓");
  } catch (e) {
    console.error("   ✗", e.message);
  }

  console.log("\n✓ List tools test done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
