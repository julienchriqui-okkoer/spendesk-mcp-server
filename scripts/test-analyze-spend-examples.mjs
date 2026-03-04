#!/usr/bin/env node
/**
 * Test spendesk_analyze_spend with filters and new groupBy (examples from the spec).
 * Usage: node scripts/test-analyze-spend-examples.mjs
 */
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;
const SPENDESK_API_TOKEN = process.env.SPENDESK_API_TOKEN?.trim();
const FROM = "2026-01-01";
const TO = "2026-03-31";

function getHeaders(sessionId, protocolVersion) {
  const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) h["mcp-session-id"] = sessionId;
  if (protocolVersion) h["mcp-protocol-version"] = protocolVersion;
  if (SPENDESK_API_TOKEN) h["Authorization"] = `Bearer ${SPENDESK_API_TOKEN}`;
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

function summary(out) {
  const r = out?.results ?? [];
  return `grandTotalEUR=${out?.grandTotalEUR ?? 0}, results=${r.length} | top: ${r[0]?.name ?? "-"} ${r[0]?.totalEUR ?? 0}€`;
}

async function main() {
  console.log("Testing spendesk_analyze_spend examples at", BASE);
  console.log("Period:", FROM, "→", TO);
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
        clientInfo: { name: "test-analyze-spend-examples", version: "1.0.0" },
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

  const examples = [
    {
      name: "[No filter] All suppliers (sanity check)",
      args: { from: FROM, to: TO, groupBy: "supplier", limit: 5 },
    },
    {
      name: "Top suppliers for Strat Ops only",
      args: { from: FROM, to: TO, groupBy: "supplier", filters: { costCenter: "Strat Ops" }, limit: 5 },
    },
    {
      name: "Cost centers that use AWS",
      args: { from: FROM, to: TO, groupBy: "costCenter", filters: { supplier: "AWS" }, limit: 10 },
    },
    {
      name: "Top employees by expense claims",
      args: { from: FROM, to: TO, groupBy: "employee", limit: 5 },
    },
    {
      name: "Spend by month (trend)",
      args: { from: FROM, to: TO, groupBy: "month", limit: 12 },
    },
    {
      name: "Suppliers in USD for Marketing",
      args: {
        from: FROM,
        to: TO,
        groupBy: "supplier",
        filters: { costCenter: "Marketing", currency: "USD" },
        limit: 5,
        includeDetails: true,
      },
    },
    {
      name: "Suppliers not yet exported to accounting",
      args: { from: FROM, to: TO, groupBy: "supplier", filters: { bookkeepingStatus: "created" }, limit: 5 },
    },
  ];

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    console.log(`${i + 1}) ${ex.name}`);
    console.log("   args:", JSON.stringify(ex.args));
    try {
      const out = await mcpCall(sessionId, protocolVersion, "spendesk_analyze_spend", ex.args);
      console.log("   ", summary(out));
      if (out?.results?.length && out.results[0]?.details?.length) {
        console.log("   details (first group):", out.results[0].details.length, "items");
      }
      if (out?.message) console.log("   message:", out.message);
      console.log("   ✓");
    } catch (e) {
      console.error("   ✗", e.message);
    }
    console.log("");
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log("✓ Analyze spend examples test done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
