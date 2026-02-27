#!/usr/bin/env node
/**
 * Affiche les 10 derniers fournisseurs via le MCP.
 * Usage: node scripts/list-last-suppliers.mjs
 *       MCP_BASE_URL=https://... node scripts/list-last-suppliers.mjs
 */
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;

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

const headers = (sessionId, protocolVersion) => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  ...(sessionId && { "mcp-session-id": sessionId }),
  ...(protocolVersion && { "mcp-protocol-version": protocolVersion }),
});

function mcpCall(sessionId, protocolVersion, method, params) {
  return fetch(MCP_URL, {
    method: "POST",
    headers: headers(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e6),
      method: "tools/call",
      params: { name: method, arguments: params },
    }),
  }).then((r) => parseBody(r));
}

function extractSuppliers(res) {
  const text = res?.result?.content?.[0]?.text;
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    const list = data.data ?? data.suppliers ?? (Array.isArray(data) ? data : []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function dateSortKey(s) {
  const d = s.created_at ?? s.createdAt ?? s.updated_at ?? s.updatedAt ?? "";
  return new Date(d || 0).getTime();
}

function rowCells(s) {
  const name = s.name ?? s.supplier_name ?? s.companyName ?? "-";
  const email = s.email ?? s.contact_email ?? "-";
  const id = s.id ?? "-";
  const date = s.created_at ?? s.createdAt ?? s.updated_at ?? s.updatedAt ?? "-";
  return {
    id: String(id).slice(0, 12),
    name: String(name).slice(0, 32),
    email: String(email).slice(0, 28),
    date: typeof date === "string" ? date.slice(0, 10) : "-",
  };
}

function formatTable(suppliers) {
  const rows = suppliers.map(rowCells);
  const col = (key, label) => ({
    key,
    label,
    width: Math.max(label.length, ...rows.map((r) => String(r[key] ?? "").length), 4),
  });
  const cols = [col("id", "ID"), col("name", "Nom"), col("email", "Email"), col("date", "Créé le")];
  const w = cols.map((c) => c.width);
  const sep = "| " + cols.map((c, i) => "-".repeat(w[i])).join(" | ") + " |";
  const header = "| " + cols.map((c, i) => (c.label + " ".repeat(w[i] - c.label.length)).slice(0, w[i])).join(" | ") + " |";
  const line = (r) => "| " + cols.map((c, i) => (String(r[c.key] ?? "") + " ".repeat(w[i])).slice(0, w[i]).padEnd(w[i]).slice(0, w[i]).replace(/ +$/, "")).join(" | ") + " |";
  return [header, sep, ...rows.map((r) => "| " + cols.map((c, i) => String(r[c.key] ?? "").padEnd(w[i]).slice(0, w[i])).join(" | ") + " |")].join("\n");
}

async function main() {
  console.log("Connexion au MCP", BASE, "...\n");

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
        clientInfo: { name: "list-last-suppliers", version: "1.0.0" },
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
    headers: headers(sessionId, protocolVersion),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const listRes = await mcpCall(sessionId, protocolVersion, "spendesk_get_suppliers", { page: 1, perPage: 20 });
  if (listRes?.result?.isError) {
    console.error("Erreur:", listRes.result?.content?.[0]?.text ?? listRes);
    process.exit(1);
  }

  const suppliers = extractSuppliers(listRes);
  const sorted = [...suppliers].sort((a, b) => dateSortKey(b) - dateSortKey(a));
  const last10 = sorted.slice(0, 10);

  console.log("--- 10 derniers fournisseurs ---\n");
  if (last10.length === 0) {
    console.log("Aucun fournisseur trouvé.");
    return;
  }
  console.log(formatTable(last10));
  console.log("\n--- Détail complet ---\n");
  last10.forEach((s, i) => {
    console.log(`### Fournisseur ${i + 1} (id: ${s.id ?? "-"})`);
    console.log(JSON.stringify(s, null, 2));
    console.log("");
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
