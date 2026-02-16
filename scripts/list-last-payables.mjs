#!/usr/bin/env node
/**
 * Liste les 5 derniers payables via le MCP, en tableau pour un comptable.
 * Usage: node scripts/list-last-payables.mjs
 *       MCP_BASE_URL=https://... node scripts/list-last-payables.mjs
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

function extractPayables(snapshotResponse) {
  const text = snapshotResponse?.result?.content?.[0]?.text;
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    const list = data.payables ?? data.data?.payables ?? data.data ?? (Array.isArray(data) ? data : []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function dateSortKey(p) {
  const d = p.created_at ?? p.createdAt ?? p.due_date ?? p.dueDate ?? p.date ?? p.updated_at ?? p.updatedAt ?? "";
  return new Date(d || 0).getTime();
}

// Colonnes utiles pour un comptable
function rowCells(p) {
  const amount = p.amount ?? p.total_amount ?? p.totalAmount ?? p.gross_amount ?? "";
  const currency = p.currency ?? p.amount_currency ?? "EUR";
  const supplier = p.supplier_name ?? p.supplierName ?? p.supplier?.name ?? p.vendor_name ?? "-";
  const ref = p.reference ?? p.invoice_number ?? p.invoiceNumber ?? p.document_number ?? p.id ?? "-";
  const date = p.due_date ?? p.dueDate ?? p.created_at ?? p.createdAt ?? p.date ?? "-";
  const status = p.status ?? p.state ?? "-";
  const bookkeeping = p.bookkeeping_status ?? p.bookkeepingStatus ?? p.exported ?? "-";
  return {
    id: p.id ?? "-",
    ref: String(ref).slice(0, 24),
    supplier: String(supplier).slice(0, 28),
    amount: typeof amount === "number" ? amount : amount,
    currency: String(currency).slice(0, 6),
    date: typeof date === "string" ? date.slice(0, 10) : "-",
    status: String(status).slice(0, 16),
    bookkeeping: String(bookkeeping).slice(0, 16),
  };
}

function formatTable(payables) {
  const rows = payables.map(rowCells);
  const col = (key, label) => ({
    key,
    label,
    width: Math.max(label.length, ...rows.map((r) => String(r[key] ?? "").length), 4),
  });
  const cols = [
    col("id", "ID"),
    col("ref", "Réf / N° facture"),
    col("supplier", "Fournisseur"),
    col("amount", "Montant"),
    col("currency", "Devise"),
    col("date", "Date"),
    col("status", "Statut"),
    col("bookkeeping", "Statut compta"),
  ];
  const w = cols.map((c) => c.width);
  const sep = "| " + cols.map((c, i) => "-".repeat(w[i])).join(" | ") + " |";
  const header = "| " + cols.map((c, i) => (c.label + " ".repeat(w[i] - c.label.length)).slice(0, w[i])).join(" | ") + " |";
  const line = (r) => "| " + cols.map((c, i) => {
    const v = String(r[c.key] ?? "").slice(0, w[i]);
    return (v + " ".repeat(w[i])).slice(0, w[i]);
  }).join(" | ") + " |";
  return [header, sep, ...rows.map(line)].join("\n");
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
        clientInfo: { name: "list-last-payables", version: "1.0.0" },
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

  let payables = [];

  // 1) Essayer GET /v1/payables (liste directe)
  const listRes = await mcpCall(sessionId, protocolVersion, "spendesk_get_payables", { page: 1, perPage: 10 });
  const listError = listRes?.result?.content?.[0]?.text ?? "";
  const is404 = listRes?.result?.isError && (listError.includes("404") || listError.includes("Not Found"));

  if (!listRes?.result?.isError && listRes?.result?.content?.[0]?.text) {
    try {
      const data = JSON.parse(listRes.result.content[0].text);
      payables = data.data ?? data.payables ?? (Array.isArray(data) ? data : []);
    } catch {}
  }

  // 2) Si liste directe 404 ou vide, essayer snapshot
  if (payables.length === 0 && (listRes?.result?.isError || payables.length === 0)) {
    const createRes = await mcpCall(sessionId, protocolVersion, "spendesk_create_payables_snapshot", { payload: {} });
    if (createRes?.result?.isError) {
      if (createRes?.result?.content?.[0]?.text?.includes("404") || createRes?.result?.content?.[0]?.text?.includes("Not Found")) {
        console.error("Erreur: l’API Spendesk ne propose pas les payables sur ce compte (404).");
        console.error("Vérifie ton plan (Premium/Enterprise) et les scopes du token (payable:read).");
        console.error("Détail:", createRes.result?.content?.[0]?.text ?? createRes);
        process.exit(1);
      }
      console.error("Erreur création snapshot:", createRes.result?.content?.[0]?.text ?? createRes);
      process.exit(1);
    }
    let snapshotId = null;
    try {
      const createData = JSON.parse(createRes?.result?.content?.[0]?.text ?? "{}");
      snapshotId = createData.id ?? createData.data?.id ?? createData.snapshotId;
    } catch {}
    if (!snapshotId) {
      console.error("Snapshot sans ID. Réponse:", JSON.stringify(createRes).slice(0, 400));
      process.exit(1);
    }
    const snapshotRes = await mcpCall(sessionId, protocolVersion, "spendesk_get_payables_snapshot", {
      snapshotId: String(snapshotId),
    });
    if (snapshotRes?.result?.isError) {
      console.error("Erreur récupération snapshot:", snapshotRes.result?.content?.[0]?.text ?? snapshotRes);
      process.exit(1);
    }
    payables = extractPayables(snapshotRes);
  }
  const sorted = [...payables].sort((a, b) => dateSortKey(b) - dateSortKey(a));
  const last5 = sorted.slice(0, 5);

  console.log("--- 5 derniers payables (données comptables) ---\n");
  if (last5.length === 0) {
    console.log("Aucun payable dans le snapshot (ou structure différente).");
    console.log("Réponse brute (extrait):", JSON.stringify(snapshotRes).slice(0, 500));
    return;
  }
  console.log(formatTable(last5));
  console.log("\n--- Détail complet (par payable, pour comptable) ---\n");
  last5.forEach((p, i) => {
    console.log(`### Payable ${i + 1} (id: ${p.id ?? "-"})`);
    console.log(JSON.stringify(p, null, 2));
    console.log("");
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
