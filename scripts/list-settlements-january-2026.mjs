#!/usr/bin/env node
/**
 * Affiche les settlements de janvier 2026 via le MCP avec les nouveaux filtres.
 * Usage: node -r dotenv/config scripts/list-settlements-january-2026.mjs
 *       MCP_BASE_URL=https://... node scripts/list-settlements-january-2026.mjs
 */
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;

/** Parse first JSON-RPC result from SSE stream (data: {...} lines). */
async function parseSSEJson(body) {
  const reader = body.getReader();
  const text = await readStream(reader);
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

async function parseBody(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json().catch(() => ({}));
  }
  if (ct.includes("text/event-stream")) {
    return parseSSEJson(res.body);
  }
  return {};
}

const headers = (sessionId, protocolVersion) => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  ...(sessionId && { "mcp-session-id": sessionId }),
  ...(protocolVersion && { "mcp-protocol-version": protocolVersion }),
});

async function initialize() {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(null, "2024-11-05"),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-script", version: "1.0.0" },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Initialize failed: ${res.status} ${text || res.statusText}`);
  }

  const sessionId = res.headers.get("mcp-session-id");
  const protocolVersion = res.headers.get("mcp-protocol-version") || "2024-11-05";
  if (!sessionId) {
    throw new Error("No mcp-session-id in initialize response");
  }

  const data = await parseBody(res);
  return { sessionId, protocolVersion, data };
}

async function notifyInitialized(sessionId, protocolVersion) {
  await fetch(MCP_URL, {
    method: "POST",
    headers: headers(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "notifications/initialized",
    }),
  });
}

async function mcpCall(sessionId, protocolVersion, method, params) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: headers(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e6),
      method: "tools/call",
      params: { name: method, arguments: params },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP call failed: ${res.status} ${text || res.statusText}`);
  }

  return parseBody(res);
}

function extractSettlements(res) {
  const text = res?.result?.content?.[0]?.text;
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    // L'API peut retourner directement un tableau ou un objet avec une propriété data/items
    if (Array.isArray(data)) return data;
    if (data.data && Array.isArray(data.data)) return data.data;
    if (data.items && Array.isArray(data.items)) return data.items;
    if (data.settlements && Array.isArray(data.settlements)) return data.settlements;
    return [];
  } catch {
    return [];
  }
}

function formatTable(settlements) {
  if (!settlements.length) {
    console.log("Aucun settlement trouvé pour janvier 2026.");
    return;
  }

  const rows = settlements.map((s) => {
    const id = s.id || s.settlement_id || "N/A";
    const amount = s.amount != null ? `${s.amount} ${s.currency || ""}`.trim() : "N/A";
    const state = s.state || s.status || "N/A";
    const date = s.created_at || s.date || s.settlement_date || "N/A";
    const supplier = s.supplier?.name || s.supplier_name || s.supplier_id || "N/A";
    return { id, amount, state, date, supplier };
  });

  const cols = [
    { key: "id", label: "ID", width: 20 },
    { key: "amount", label: "Montant", width: 15 },
    { key: "state", label: "État", width: 15 },
    { key: "date", label: "Date", width: 20 },
    { key: "supplier", label: "Fournisseur", width: 30 },
  ];

  const header = cols.map((c) => c.label.padEnd(c.width)).join(" | ");
  const separator = cols.map((c) => "-".repeat(c.width)).join("-|-");
  console.log("\n" + header);
  console.log(separator);

  for (const row of rows) {
    const line = cols.map((c) => String(row[c.key] || "").padEnd(c.width)).join(" | ");
    console.log(line);
  }

  console.log(`\nTotal: ${settlements.length} settlement(s) trouvé(s) pour janvier 2026.\n`);
}

async function main() {
  try {
    console.log("🔌 Initialisation de la session MCP...");
    const { sessionId, protocolVersion } = await initialize();
    console.log(`✅ Session créée: ${sessionId?.substring(0, 8)}...`);

    await notifyInitialized(sessionId, protocolVersion);
    console.log("✅ Session initialisée\n");

    console.log("\n📋 Récupération des settlements de janvier 2026...");
    console.log("   Filtres: from='2026-01-01', to='2026-01-31'\n");

    const res = await mcpCall(sessionId, protocolVersion, "spendesk_get_settlements", {
      page: 1,
      perPage: 100,
      filters: {
        from: "2026-01-01",
        to: "2026-01-31",
      },
    });

    if (res.error) {
      console.error("❌ Erreur:", res.error);
      process.exit(1);
    }

    const settlements = extractSettlements(res);
    formatTable(settlements);

    if (settlements.length > 0) {
      console.log("📄 Détails complets (JSON):\n");
      console.log(JSON.stringify(settlements, null, 2));
    }
  } catch (err) {
    console.error("❌ Erreur:", err.message);
    if (err.cause) console.error("   Cause:", err.cause);
    process.exit(1);
  }
}

main();
