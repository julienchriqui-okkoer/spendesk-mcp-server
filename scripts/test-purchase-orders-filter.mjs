#!/usr/bin/env node
/**
 * Test du filtre createdFrom sur spendesk_get_purchase_orders.
 * Vérifie que la requête envoie bien "from" et que les résultats sont filtrés par date.
 * Usage: node scripts/test-purchase-orders-filter.mjs
 *        MCP_BASE_URL=http://localhost:3000 node scripts/test-purchase-orders-filter.mjs
 */
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;
const FROM_DATE = process.env.FROM_DATE || "2026-01-01";

function getHeaders(sessionId, protocolVersion) {
  const h = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) h["mcp-session-id"] = sessionId;
  if (protocolVersion) h["mcp-protocol-version"] = protocolVersion;
  if (process.env.X_CLIENT_TOKEN) h["X-Client-Token"] = process.env.X_CLIENT_TOKEN;
  if (process.env.X_COMPANY_ID) h["X-Company-Id"] = process.env.X_COMPANY_ID;
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

function mcpCall(sessionId, protocolVersion, method, params) {
  return fetch(MCP_URL, {
    method: "POST",
    headers: getHeaders(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e6),
      method: "tools/call",
      params: { name: method, arguments: params },
    }),
  }).then((r) => parseBody(r));
}

function getCreatedAt(po) {
  // Try various possible date fields
  return (
    po.created_at ??
    po.createdAt ??
    po.created ??
    po.date ??
    po.created_date ??
    po.createdDate ??
    po.creation_date ??
    po.creationDate ??
    ""
  );
}

async function main() {
  console.log("Test filtre purchase orders — createdFrom =", FROM_DATE);
  console.log("MCP URL:", MCP_URL, "\n");

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
        clientInfo: { name: "test-purchase-orders-filter", version: "1.0.0" },
      },
    }),
  });
  const sessionId = r1.headers.get("mcp-session-id");
  const protocolVersion = r1.headers.get("mcp-protocol-version");
  if (!sessionId) {
    console.error("Échec init MCP. Le serveur tourne ? (npm run start:http)");
    process.exit(1);
  }

  await fetch(MCP_URL, {
    method: "POST",
    headers: getHeaders(sessionId, protocolVersion),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const res = await mcpCall(sessionId, protocolVersion, "spendesk_get_purchase_orders", {
    page: 1,
    perPage: 30,
    createdFrom: FROM_DATE,
  });

  if (res?.result?.isError) {
    const errorText = res.result?.content?.[0]?.text ?? "";
    console.error("Erreur tools/call:", errorText);
    console.error("Réponse complète:", JSON.stringify(res, null, 2));
    process.exit(1);
  }

  const text = res?.result?.content?.[0]?.text;
  if (!text) {
    console.error("Réponse sans contenu:", JSON.stringify(res).slice(0, 300));
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("Réponse non JSON:", text.slice(0, 200));
    process.exit(1);
  }

  const list = data.data ?? data.purchaseOrders ?? data.purchase_orders ?? (Array.isArray(data) ? data : []);
  const items = Array.isArray(list) ? list : [];
  const total = data.total ?? data.totalCount ?? data.meta?.total ?? items.length;

  console.log("Total (réponse API):", total);
  console.log("Nombre d’éléments dans la page:", items.length);

  if (items.length === 0) {
    console.log("\nAucun PO dans la plage (normal si aucun PO créé depuis " + FROM_DATE + ").");
    console.log("Extrait réponse:", JSON.stringify(data).slice(0, 400));
    return;
  }

  const fromTime = new Date(FROM_DATE).getTime();
  const dates = items.map((po) => ({ id: po.id ?? "-", created: getCreatedAt(po) }));
  const allAfter = dates.every((d) => {
    const t = new Date(d.created || 0).getTime();
    return t >= fromTime;
  });
  const beforeCount = dates.filter((d) => new Date(d.created || 0).getTime() < fromTime).length;

  console.log("\n--- Structure du premier PO (pour debug) ---");
  if (items.length > 0) {
    console.log(JSON.stringify(items[0], null, 2).slice(0, 800));
  }
  console.log("\n--- Dates des 10 premiers POs ---");
  dates.slice(0, 10).forEach((d, i) => console.log(`  ${i + 1}. ${d.created || "(vide)"} (id: ${d.id})`));

  if (beforeCount > 0) {
    console.log("\n❌ ÉCHEC: " + beforeCount + " PO(s) ont une date de création avant " + FROM_DATE + " — le filtre n’est peut‑être pas appliqué par l’API.");
    process.exit(1);
  }
  console.log("\n✅ OK: tous les POs de la page sont créés à partir de " + FROM_DATE + ".");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
