#!/usr/bin/env node
/**
 * Test du pattern load + query pour les purchase orders.
 * Vérifie: spendesk_load_purchase_orders → spendesk_query_purchase_orders → spendesk_clear_purchase_orders.
 *
 * Usage:
 *   npm run build && node scripts/test-load-query-purchase-orders.mjs
 *   MCP_BASE_URL=http://localhost:3000 node scripts/test-load-query-purchase-orders.mjs
 *
 * Prérequis: serveur MCP démarré (npm run start:http) ou MCP_BASE_URL pointant vers un déploiement.
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
  console.log("Test load + query purchase orders");
  console.log("MCP URL:", MCP_URL, "\n");

  // Initialize
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
        clientInfo: { name: "test-load-query-po", version: "1.0.0" },
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

  // 1) load
  console.log("1. spendesk_load_purchase_orders({}) ...");
  const loadRes = await mcpCall(sessionId, protocolVersion, "spendesk_load_purchase_orders", {});
  const loadText = getResultText(loadRes);
  if (!loadText) {
    const errMsg = loadRes?.result?.content?.[0]?.text ?? loadRes?.error?.message ?? JSON.stringify(loadRes).slice(0, 400);
    console.error("Erreur load:", errMsg);
    if (String(errMsg).includes("not found") || String(errMsg).includes("spendesk_load_purchase_orders")) {
      console.error("\n→ Redémarrer le serveur MCP pour charger les nouveaux tools: npm run start:http");
    }
    process.exit(1);
  }
  const loadData = parseResultText(loadText);
  const loaded = loadData?.loaded ?? 0;
  const columns = loadData?.columns ?? [];
  console.log("   loaded:", loaded);
  console.log("   message:", loadData?.message?.slice(0, 80) + (loadData?.message?.length > 80 ? "..." : ""));
  console.log("   columns:", columns.length, "→", columns.slice(0, 5).join(", "), columns.length > 5 ? "..." : "");
  if (!Array.isArray(columns) || columns.length === 0) {
    console.error("   ❌ Colonnes manquantes");
    process.exit(1);
  }
  console.log("   ✅ load OK\n");

  // 2) query — SELECT * FROM ? LIMIT 3
  console.log("2. spendesk_query_purchase_orders({ sql: 'SELECT * FROM ? LIMIT 3' }) ...");
  const query1Res = await mcpCall(sessionId, protocolVersion, "spendesk_query_purchase_orders", {
    sql: "SELECT * FROM ? LIMIT 3",
  });
  const query1Text = getResultText(query1Res);
  const query1Data = parseResultText(query1Text);
  if (query1Data?.error) {
    console.error("   Erreur query:", query1Data.error);
    process.exit(1);
  }
  const rows1 = query1Data?.rows ?? [];
  const count1 = query1Data?.count ?? 0;
  console.log("   rows:", count1);
  if (rows1.length > 0) {
    const first = rows1[0];
    console.log("   premier PO (clés):", Object.keys(first).join(", "));
    console.log("   taille réponse (approx):", JSON.stringify(query1Data).length, "octets");
  }
  console.log("   ✅ query LIMIT 3 OK\n");

  // 3) query — GROUP BY supplierName
  console.log("3. spendesk_query_purchase_orders({ sql: 'SELECT supplierName, SUM(remainingAmount) as total FROM ? GROUP BY supplierName ORDER BY total DESC LIMIT 5' }) ...");
  const query2Res = await mcpCall(sessionId, protocolVersion, "spendesk_query_purchase_orders", {
    sql: "SELECT supplierName, SUM(remainingAmount) as total FROM ? GROUP BY supplierName ORDER BY total DESC LIMIT 5",
  });
  const query2Text = getResultText(query2Res);
  const query2Data = parseResultText(query2Text);
  if (query2Data?.error) {
    console.error("   Erreur query:", query2Data.error);
    process.exit(1);
  }
  const rows2 = query2Data?.rows ?? [];
  console.log("   top 5 fournisseurs (remainingAmount):", rows2.length);
  rows2.forEach((r, i) => console.log("     ", i + 1, r.supplierName ?? "-", "→", r.total));
  console.log("   ✅ query GROUP BY OK\n");

  // 4) clear
  console.log("4. spendesk_clear_purchase_orders({}) ...");
  const clearRes = await mcpCall(sessionId, protocolVersion, "spendesk_clear_purchase_orders", {});
  const clearText = getResultText(clearRes);
  const clearData = parseResultText(clearText);
  if (!clearData?.cleared) {
    console.error("   Réponse clear inattendue:", clearData);
    process.exit(1);
  }
  console.log("   cleared: true");
  console.log("   ✅ clear OK\n");

  // 5) query après clear → doit retourner erreur
  console.log("5. spendesk_query_purchase_orders après clear (doit échouer) ...");
  const query3Res = await mcpCall(sessionId, protocolVersion, "spendesk_query_purchase_orders", {
    sql: "SELECT * FROM ? LIMIT 1",
  });
  const query3Text = getResultText(query3Res);
  const query3Data = parseResultText(query3Text);
  if (!query3Data?.error) {
    console.error("   Attendu: error 'No POs in memory'. Reçu:", query3Data);
    process.exit(1);
  }
  console.log("   error (attendu):", query3Data.error?.slice(0, 60) + "...");
  console.log("   ✅ query après clear OK\n");

  console.log("Tous les tests sont passés.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
