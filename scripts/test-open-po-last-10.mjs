#!/usr/bin/env node
/**
 * Test: récupérer les 10 derniers purchase orders ouverts via load + query.
 * Utilise le serveur MCP (qui charge .env). Lance d'abord: npm run start:http
 *
 * Usage:
 *   node scripts/test-open-po-last-10.mjs
 *   MCP_BASE_URL=http://localhost:3000 node scripts/test-open-po-last-10.mjs
 */
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;
const SPENDESK_API_TOKEN = process.env.SPENDESK_API_TOKEN?.trim();

function getHeaders(sessionId, protocolVersion) {
  const h = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) h["mcp-session-id"] = sessionId;
  if (protocolVersion) h["mcp-protocol-version"] = protocolVersion;
  if (SPENDESK_API_TOKEN) h["Authorization"] = `Bearer ${SPENDESK_API_TOKEN}`;
  return h;
}

async function parseBody(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  if (ct.includes("text/event-stream")) {
    const reader = res.body.getReader();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    const m = text.match(/data:\s*(\{[\s\S]*?\})\s*(\n|$)/);
    return m ? JSON.parse(m[1]) : {};
  }
  return {};
}

async function mcpCall(sessionId, protocolVersion, method, params = {}) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: getHeaders(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e6),
      method: "tools/call",
      params: { name: method, arguments: params },
    }),
  });
  return parseBody(res);
}

function getResultText(res) {
  if (res?.result?.isError) return null;
  return res?.result?.content?.[0]?.text ?? null;
}

function parseResultText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function main() {
  console.log("Récupération des 10 derniers POs ouverts (status=open)\n");
  console.log("MCP URL:", MCP_URL);

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
        clientInfo: { name: "test-open-po-last-10", version: "1.0.0" },
      },
    }),
  });
  const sessionId = r1.headers.get("mcp-session-id");
  const protocolVersion = r1.headers.get("mcp-protocol-version");
  if (!sessionId) {
    console.error("Échec init MCP. Démarrer le serveur: npm run start:http");
    process.exit(1);
  }

  await fetch(MCP_URL, {
    method: "POST",
    headers: getHeaders(sessionId, protocolVersion),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  console.log("1. spendesk_load_purchase_orders({ status: 'open' }) ...");
  const loadRes = await mcpCall(sessionId, protocolVersion, "spendesk_load_purchase_orders", {
    status: "open",
  });
  const loadText = getResultText(loadRes);
  if (!loadText) {
    console.error("Erreur load:", loadRes?.result?.content?.[0]?.text ?? loadRes?.error?.message ?? "unknown");
    process.exit(1);
  }
  const loadData = parseResultText(loadText);
  if (loadData?.error) {
    console.error("   Erreur API:", loadData.error);
    process.exit(1);
  }
  console.log("   loaded:", loadData?.loaded ?? 0, "PO(s) ouverts\n");

  console.log("2. spendesk_query_purchase_orders({ sql: \"... WHERE status='open' ORDER BY createdAt DESC LIMIT 10\" }) ...");
  const queryRes = await mcpCall(sessionId, protocolVersion, "spendesk_query_purchase_orders", {
    sql: "SELECT * FROM ? WHERE status='open' ORDER BY createdAt DESC LIMIT 10",
  });
  const queryText = getResultText(queryRes);
  const queryData = parseResultText(queryText);
  if (queryData?.error) {
    console.error("Erreur query:", queryData.error);
    process.exit(1);
  }
  const rows = queryData?.rows ?? [];
  console.log("   count:", rows.length, "\n");

  console.log("--- 10 derniers POs ouverts ---");
  rows.forEach((po, i) => {
    console.log(
      `${i + 1}. ${po.number ?? po.id} | ${po.supplierName ?? "-"} | ${po.remainingAmount ?? 0} ${po.currency ?? ""} | ${po.createdAt ?? "-"}`
    );
  });
  console.log("\n✓ OK");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
