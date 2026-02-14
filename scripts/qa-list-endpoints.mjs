#!/usr/bin/env node
/**
 * QA des endpoints de liste : 5 derniers éléments via API directe et via MCP.
 * Usage: SPENDESK_API_TOKEN=xxx SPENDESK_USE_DEMO=true node scripts/qa-list-endpoints.mjs
 * Génère: qa-report.md
 */
import { spawn } from "child_process";

const LIMIT = 5;
const token = process.env.SPENDESK_API_TOKEN;
const baseUrl = process.env.SPENDESK_BASE_URL || (process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1"
  ? "https://beta-sandbox.api.trunk.spendesk.services"
  : "https://public-api.spendesk.com");

if (!token) {
  console.error("SPENDESK_API_TOKEN requis.");
  process.exit(1);
}

const LIST_ENDPOINTS = [
  { path: "/v1/settlements", tool: "spendesk_get_settlements", key: "settlements" },
  { path: "/v1/bank-fees", tool: "spendesk_get_bank_fees", key: "bankFees" },
  { path: "/v1/wallet-loads", tool: "spendesk_get_wallet_loads", key: "walletLoads" },
  { path: "/v1/analytical-fields", tool: "spendesk_get_analytical_fields", key: "data" },
  { path: "/v1/analytical-fields/{fieldId}/values", tool: "spendesk_get_analytical_values", key: "values", needFieldId: true, noPagination: true },
  { path: "/v1/cost-centers", tool: "spendesk_get_cost_centers", key: "costCenters" },
  { path: "/v1/expense-categories", tool: "spendesk_get_expense_categories", key: "expenseCategories" },
  { path: "/v1/suppliers", tool: "spendesk_get_suppliers", key: "suppliers" },
  { path: "/v1/users", tool: "spendesk_get_users", key: "users" },
  { path: "/v1/webhooks/instances", tool: "spendesk_get_webhooks", key: "webhooks" },
  { path: "/v1/purchase-orders", tool: "spendesk_get_purchase_orders", key: "purchaseOrders" },
];

function countItems(data, key) {
  if (!data || typeof data !== "object") return 0;
  const raw = data[key] ?? data.data ?? data.items ?? data.instances ?? data;
  const arr = Array.isArray(raw) ? raw : (raw?.data ?? raw?.items ?? raw?.instances ?? []);
  return Array.isArray(arr) ? arr.length : 0;
}

async function getFirstAnalyticalFieldId() {
  const url = `${baseUrl}/v1/analytical-fields`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const raw = data.data ?? data.fields ?? data.analyticalFields ?? data;
  const arr = Array.isArray(raw) ? raw : (raw?.data ?? raw?.items ?? []);
  const first = arr[0];
  return first?.id ?? first?.fieldId ?? null;
}

async function testApiDirect(endpoint) {
  let path = endpoint.path;
  if (endpoint.needFieldId) {
    const fieldId = await getFirstAnalyticalFieldId();
    if (!fieldId) return { ok: false, status: null, count: 0, error: "Aucun analytical field trouvé" };
    path = path.replace("{fieldId}", fieldId);
  }
  const url = endpoint.noPagination ? `${baseUrl}${path}` : `${baseUrl}${path}?per_page=${LIMIT}&page=1`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, status: res.status, count: 0, error: "Réponse non-JSON" };
    }
    if (!res.ok) return { ok: false, status: res.status, count: 0, error: data.message || data.errors?.[0]?.detail || data.error || text.slice(0, 100) };
    const count = countItems(data, endpoint.key) || countItems(data, "data") || countItems(data, "values");
    return { ok: true, status: res.status, count, data };
  } catch (err) {
    return { ok: false, status: null, count: 0, error: err.message };
  }
}

async function testMcp(endpoint, extraArgs = {}) {
  const toolArgs = { perPage: LIMIT, page: 1, ...extraArgs };
  return new Promise((resolve) => {
    const server = spawn("node", ["dist/index.js"], {
      env: { ...process.env, SPENDESK_USE_DEMO: process.env.SPENDESK_USE_DEMO || "true", SPENDESK_API_TOKEN: token },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let initDone = false;
    const timeout = setTimeout(() => {
      server.kill();
      resolve({ ok: false, count: 0, error: "Timeout" });
    }, 12000);
    function send(msg) {
      server.stdin.write(JSON.stringify(msg) + "\n");
    }
    function onLine(line) {
      try {
        const msg = JSON.parse(line);
        if (msg.result?.serverInfo && !initDone) {
          initDone = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: endpoint.tool, arguments: toolArgs },
          });
          return;
        }
        if (msg.result?.content?.[0]?.text) {
          clearTimeout(timeout);
          server.kill();
          let count = 0;
          try {
            const data = JSON.parse(msg.result.content[0].text);
            count = countItems(data, endpoint.key) || countItems(data, "data") || countItems(data, "values");
          } catch (_) {}
          resolve({ ok: true, count });
          return;
        }
        if (msg.error) {
          clearTimeout(timeout);
          server.kill();
          resolve({ ok: false, count: 0, error: msg.error.message || JSON.stringify(msg.error) });
        }
      } catch (_) {}
    }
    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(onLine);
      if (buffer.trim() && buffer.startsWith("{") && buffer.includes("jsonrpc")) {
        onLine(buffer);
        buffer = "";
      }
    });
    server.stderr.on("data", () => {});
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "qa", version: "1.0.0" } },
    });
  });
}

async function main() {
  const report = [];
  report.push("# Rapport QA – Endpoints de liste (5 derniers éléments)");
  report.push("");
  report.push(`- **Date:** ${new Date().toISOString().slice(0, 19)}`);
  report.push(`- **Base URL:** ${baseUrl}`);
  report.push(`- **Limit:** ${LIMIT}`);
  report.push("");
  report.push("| Endpoint | API directe | Count API | MCP | Count MCP |");
  report.push("|---------|-------------|-----------|-----|-----------|");

  for (const ep of LIST_ENDPOINTS) {
    process.stderr.write(`Testing ${ep.path} ... `);
    let fieldId = null;
    if (ep.needFieldId) fieldId = await getFirstAnalyticalFieldId();
    const apiResult = await testApiDirect(ep);
    const mcpResult = await testMcp(ep, fieldId ? { fieldId } : {});
    process.stderr.write(`API ${apiResult.ok ? "✓" : "✗"} MCP ${mcpResult.ok ? "✓" : "✗"}\n`);
    report.push(`| \`${ep.path}\` | ${apiResult.ok ? "✅ OK" : "❌ " + (apiResult.error || apiResult.status)} | ${apiResult.count} | ${mcpResult.ok ? "✅ OK" : "❌ " + (mcpResult.error || "")} | ${mcpResult.count} |`);
  }

  report.push("");
  report.push("---");
  report.push("Légende: ✅ OK = succès, ❌ = erreur (status ou message). Count = nombre d’éléments retournés (max 5).");

  const reportPath = "qa-report.md";
  const fs = await import("fs");
  fs.writeFileSync(reportPath, report.join("\n"), "utf8");
  console.log("\nRapport écrit dans", reportPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
