#!/usr/bin/env node
/**
 * Test: spendesk_get_purchase_orders avec perPage 10, affiche les 10 POs.
 * Usage: npm run start:http puis node scripts/test-get-purchase-orders.mjs
 */
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;
const SPENDESK_API_TOKEN = process.env.SPENDESK_API_TOKEN?.trim();

const headers = (sessionId, protocolVersion) => {
  const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) h["mcp-session-id"] = sessionId;
  if (protocolVersion) h["mcp-protocol-version"] = protocolVersion;
  if (SPENDESK_API_TOKEN) h["Authorization"] = `Bearer ${SPENDESK_API_TOKEN}`;
  return h;
};

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

async function main() {
  console.log("Test: spendesk_get_purchase_orders({ perPage: 10 })\n");
  console.log("MCP URL:", MCP_URL);

  const r1 = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-get-po", version: "1.0.0" },
      },
    }),
  });
  const sessionId = r1.headers.get("mcp-session-id");
  const protocolVersion = r1.headers.get("mcp-protocol-version");
  if (!sessionId) {
    console.error("Init MCP échoué. Démarrer le serveur: npm run start:http");
    process.exit(1);
  }

  await fetch(MCP_URL, {
    method: "POST",
    headers: headers(sessionId, protocolVersion),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "spendesk_get_purchase_orders", arguments: { perPage: 10 } },
    }),
  });
  const out = await parseBody(res);
  const text = out?.result?.content?.[0]?.text;
  if (!text) {
    console.error("Erreur:", out?.result?.content?.[0] ?? out?.error ?? out);
    process.exit(1);
  }
  const data = JSON.parse(text);
  if (data.error) {
    console.error("Erreur API:", data.error);
    process.exit(1);
  }

  const list = data.purchaseOrders ?? data.data ?? (Array.isArray(data) ? data : []);
  const items = Array.isArray(list) ? list : [];
  const meta = data.meta ?? data.pagination;

  const toShow = items.slice(0, 10);
  console.log("\nRésultat:");
  console.log("  Reçus:", items.length, "| Affichés: 10 premiers");
  if (meta) console.log("  Meta:", JSON.stringify(meta, null, 2));
  console.log("\n--- 10 POs ---\n");
  toShow.forEach((po, i) => {
    const p = po && typeof po === "object" ? po : {};
    console.log(`PO ${i + 1}:`, JSON.stringify(p, null, 2).slice(0, 500) + (JSON.stringify(p).length > 500 ? "..." : ""));
    console.log("");
  });
  console.log("✓ OK");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
