#!/usr/bin/env node
/**
 * Affiche les 5 premiers users via le MCP.
 * Usage: node -r dotenv/config scripts/list-first-users.mjs
 *       MCP_BASE_URL=https://... node scripts/list-first-users.mjs
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

function extractUsers(res) {
  const text = res?.result?.content?.[0]?.text;
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    const list = data.data ?? data.users ?? (Array.isArray(data) ? data : []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function rowCells(u) {
  const name = u.name ?? u.display_name ?? u.first_name + " " + (u.last_name ?? "") ?? "-";
  const email = u.email ?? "-";
  const id = u.id ?? "-";
  return {
    id: String(id).slice(0, 14),
    name: String(name).trim().slice(0, 28),
    email: String(email).slice(0, 32),
  };
}

function formatTable(users) {
  const rows = users.map(rowCells);
  const col = (key, label) => ({
    key,
    label,
    width: Math.max(label.length, ...rows.map((r) => String(r[key] ?? "").length), 4),
  });
  const cols = [col("id", "ID"), col("name", "Nom"), col("email", "Email")];
  const w = cols.map((c) => c.width);
  const sep = "| " + cols.map((c, i) => "-".repeat(w[i])).join(" | ") + " |";
  const header = "| " + cols.map((c, i) => (c.label + " ".repeat(w[i])).slice(0, w[i]).padEnd(w[i])).join(" | ") + " |";
  return [header, sep, ...rows.map((r) => "| " + cols.map((c, i) => (String(r[c.key] ?? "") + " ".repeat(w[i])).slice(0, w[i]).padEnd(w[i])).join(" | ") + " |")].join("\n");
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
        clientInfo: { name: "list-first-users", version: "1.0.0" },
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

  const listRes = await mcpCall(sessionId, protocolVersion, "spendesk_get_users", { page: 1, perPage: 5 });
  if (listRes?.result?.isError) {
    console.error("Erreur:", listRes.result?.content?.[0]?.text ?? listRes);
    process.exit(1);
  }

  const users = extractUsers(listRes);

  console.log("--- 5 premiers users ---\n");
  if (users.length === 0) {
    console.log("Aucun user trouvé.");
    return;
  }
  console.log(formatTable(users));
  console.log("\n--- Détail ---\n");
  users.forEach((u, i) => {
    console.log(`### User ${i + 1} (id: ${u.id ?? "-"})`);
    console.log(JSON.stringify(u, null, 2));
    console.log("");
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
