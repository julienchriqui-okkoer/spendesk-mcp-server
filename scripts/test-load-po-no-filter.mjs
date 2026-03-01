#!/usr/bin/env node
/**
 * Appel simple : spendesk_load_purchase_orders sans filtre.
 * Usage: npm run start:http (dans un terminal), puis:
 *   node scripts/test-load-po-no-filter.mjs
 */
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;

const headers = (sessionId, protocolVersion) => {
  const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) h["mcp-session-id"] = sessionId;
  if (protocolVersion) h["mcp-protocol-version"] = protocolVersion;
  if (process.env.X_CLIENT_TOKEN) h["X-Client-Token"] = process.env.X_CLIENT_TOKEN;
  if (process.env.X_COMPANY_ID) h["X-Company-Id"] = process.env.X_COMPANY_ID;
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
  console.log("Appel simple: spendesk_load_purchase_orders({}) — sans filtre\n");
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
        clientInfo: { name: "test-load-po-no-filter", version: "1.0.0" },
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
      params: { name: "spendesk_load_purchase_orders", arguments: {} },
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
  console.log("\nRésultat:");
  console.log("  loaded:", data.loaded);
  console.log("  message:", data.message);
  console.log("  columns:", data.columns?.join(", "));

  if (data.loaded > 0) {
    const queryRes = await fetch(MCP_URL, {
      method: "POST",
      headers: headers(sessionId, protocolVersion),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "spendesk_query_purchase_orders", arguments: { sql: "SELECT * FROM ? LIMIT 5" } },
      }),
    });
    const queryOut = await parseBody(queryRes);
    const queryText = queryOut?.result?.content?.[0]?.text;
    if (queryText) {
      const queryData = JSON.parse(queryText);
      const rows = queryData?.rows ?? [];
      console.log("\nContenu (5 premiers POs):");
      if (rows.length === 0) {
        console.log("  (aucune ligne)");
      } else {
        rows.forEach((row, i) => {
          console.log(`  --- PO ${i + 1} ---`);
          Object.entries(row).forEach(([k, v]) => console.log(`    ${k}: ${v ?? "(null)"}`));
        });
      }
    }
  }
  console.log("\n✓ OK");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
