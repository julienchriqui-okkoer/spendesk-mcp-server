#!/usr/bin/env node
/**
 * Teste la récupération des payables depuis une date (défaut: 1er janvier 2026).
 * Usage: node scripts/test-payables-from-date.mjs
 *        FROM_DATE=2026-01-01 node scripts/test-payables-from-date.mjs
 *        MCP_BASE_URL=https://... X_CLIENT_TOKEN=<apiKey> node scripts/test-payables-from-date.mjs
 */
const FROM_DATE = process.env.FROM_DATE || "2026-01-01";
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;

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
  if (payables.length === 0) return "(aucun)";
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
  const line = (r) =>
    "| " +
    cols
      .map((c, i) => {
        const v = String(r[c.key] ?? "").slice(0, w[i]);
        return (v + " ".repeat(w[i])).slice(0, w[i]);
      })
      .join(" | ") +
    " |";
  return [header, sep, ...rows.map(line)].join("\n");
}

async function main() {
  console.log("Payables depuis", FROM_DATE, "— MCP", BASE, "\n");

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
        clientInfo: { name: "test-payables-from-date", version: "1.0.0" },
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

  let payables = [];
  let source = "";

  // 1) GET /v1/payables avec filtre from
  const listRes = await mcpCall(sessionId, protocolVersion, "spendesk_get_payables", {
    page: 1,
    perPage: 100,
    filters: { from: FROM_DATE },
  });
  const listError = listRes?.result?.content?.[0]?.text ?? "";
  const is404 = listRes?.result?.isError && (listError.includes("404") || listError.includes("Not Found"));

  if (!listRes?.result?.isError && listRes?.result?.content?.[0]?.text) {
    try {
      const data = JSON.parse(listRes.result.content[0].text);
      payables = data.data ?? data.payables ?? (Array.isArray(data) ? data : []);
      if (Array.isArray(payables)) source = "GET /v1/payables (filters.from)";
    } catch {}
  }

  // 2) Sinon snapshot avec payload from
  if (payables.length === 0 && (listRes?.result?.isError || payables.length === 0)) {
    const createRes = await mcpCall(sessionId, protocolVersion, "spendesk_create_payables_snapshot", {
      payload: { from: FROM_DATE },
    });
    if (createRes?.result?.isError) {
      const errText = createRes?.result?.content?.[0]?.text ?? "";
      if (errText.includes("404") || errText.includes("Not Found")) {
        console.error("L’API Spendesk ne propose pas les payables sur ce compte (404).");
        console.error("Vérifiez le plan (Premium/Enterprise) et les scopes (payable:read).");
      } else {
        console.error("Erreur création snapshot:", errText);
      }
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
    source = "snapshot payables (payload.from)";
  }

  const sorted = [...payables].sort((a, b) => dateSortKey(b) - dateSortKey(a));

  console.log("Source:", source);
  console.log("Nombre de payables (depuis " + FROM_DATE + "):", sorted.length);
  console.log("\n--- Tableau ---\n");
  console.log(formatTable(sorted));
  if (sorted.length > 0 && process.argv.includes("--json")) {
    console.log("\n--- JSON (extrait) ---\n");
    console.log(JSON.stringify(sorted.slice(0, 3), null, 2));
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
