#!/usr/bin/env node
/**
 * Test the composite MCP tools (analyze_spend, bookkeeping_pipeline, payment_status, ap_aging, cash_flow_forecast).
 *
 * Usage:
 *   # Server must be running: npm run start:http
 *   node scripts/test-composite-tools.mjs
 *
 *   # With client credentials (no token in server .env)
 *   X_SPENDESK_CLIENT_ID=xxx X_SPENDESK_CLIENT_SECRET=yyy node scripts/test-composite-tools.mjs
 *
 *   # Against deployed server
 *   MCP_BASE_URL=https://your-app.railway.app node scripts/test-composite-tools.mjs
 */
const BASE = (process.env.MCP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const MCP_URL = `${BASE}/mcp`;
const SPENDESK_API_TOKEN = process.env.SPENDESK_API_TOKEN?.trim();
const CLIENT_ID = process.env.X_SPENDESK_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.X_SPENDESK_CLIENT_SECRET?.trim();

function getBearerAuth() {
  if (CLIENT_ID && CLIENT_SECRET) {
    const b64 = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64");
    return `client_credentials:${b64}`;
  }
  return null;
}

function getHeaders(sessionId, protocolVersion) {
  const h = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) h["mcp-session-id"] = sessionId;
  if (protocolVersion) h["mcp-protocol-version"] = protocolVersion;
  const bearer = getBearerAuth() || SPENDESK_API_TOKEN;
  if (bearer) h["Authorization"] = `Bearer ${bearer}`;
  return h;
}

async function mcpCall(sessionId, protocolVersion, toolName, args = {}) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: getHeaders(sessionId, protocolVersion),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e6),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });
  const ct = res.headers.get("content-type") || "";
  let data = {};
  if (ct.includes("application/json")) {
    data = await res.json().catch(() => ({}));
  } else {
    const text = await res.text();
    try {
      const match = text.match(/data:\s*(\{[\s\S]*?\})\s*(\n|$)/);
      data = match ? JSON.parse(match[1]) : {};
    } catch {
      data = { error: text };
    }
  }
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const text = data.result?.content?.[0]?.text;
  if (!text) return data.result;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text);
  }
}

async function main() {
  console.log("Testing composite tools at", BASE);
  if (CLIENT_ID && CLIENT_SECRET) console.log("  Auth: client credentials (X_SPENDESK_CLIENT_ID + X_SPENDESK_CLIENT_SECRET)");
  else if (SPENDESK_API_TOKEN) console.log("  Auth: Bearer SPENDESK_API_TOKEN (", SPENDESK_API_TOKEN.slice(0, 8) + "... )");
  else console.log("  Auth: none (server fallback env)");
  console.log("");

  // Initialize session
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
        clientInfo: { name: "test-composite-tools", version: "1.0.0" },
      },
    }),
  });
  if (!r1.ok) {
    console.error("✗ Initialize failed:", r1.status, await r1.text());
    console.error("  Make sure the server is running: npm run start:http");
    process.exit(1);
  }
  const sessionId = r1.headers.get("mcp-session-id");
  const protocolVersion = r1.headers.get("mcp-protocol-version");
  if (!sessionId) {
    console.error("✗ No session ID. Check server and token.");
    process.exit(1);
  }

  await fetch(MCP_URL, {
    method: "POST",
    headers: getHeaders(sessionId, protocolVersion),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const from = "2026-01-01";
  const to = "2026-01-31";

  console.log("1) spendesk_analyze_spend (groupBy: supplier, limit: 5)");
  try {
    const analyze = await mcpCall(sessionId, protocolVersion, "spendesk_analyze_spend", {
      from,
      to,
      groupBy: "supplier",
      limit: 5,
      excludeCredits: true,
    });
    console.log("   period:", analyze.period);
    console.log("   grandTotalEUR:", analyze.grandTotalEUR);
    console.log("   results:", analyze.results?.length ?? 0, "rows");
    if (analyze.results?.length) {
      console.log("   top:", analyze.results[0]?.name, "—", analyze.results[0]?.totalEUR, "EUR");
    }
    if (analyze.message) console.log("   message:", analyze.message);
    console.log("   ✓");
  } catch (e) {
    console.error("   ✗", e.message);
  }
  await new Promise((r) => setTimeout(r, 3000)); // pause to reduce 409/429 when running all tools

  console.log("\n2) spendesk_get_bookkeeping_pipeline (summary only)");
  try {
    const pipeline = await mcpCall(sessionId, protocolVersion, "spendesk_get_bookkeeping_pipeline", {
      from,
      to,
      includeVatBreakdown: false,
      includeJournalEntries: false,
    });
    console.log("   summary:", pipeline.summary);
    console.log("   payables count:", pipeline.payables?.length ?? 0);
    console.log("   ✓");
  } catch (e) {
    console.error("   ✗", e.message);
  }
  await new Promise((r) => setTimeout(r, 3000));

  console.log("\n3) spendesk_get_payment_status");
  try {
    const status = await mcpCall(sessionId, protocolVersion, "spendesk_get_payment_status", {
      from,
      to,
    });
    console.log("   period:", status.period);
    console.log("   payables count:", status.payables?.length ?? 0);
    console.log("   ✓");
  } catch (e) {
    console.error("   ✗", e.message);
  }
  await new Promise((r) => setTimeout(r, 3000));

  console.log("\n4) spendesk_get_ap_aging");
  try {
    const aging = await mcpCall(sessionId, protocolVersion, "spendesk_get_ap_aging", {
      includeUpcoming: false,
    });
    console.log("   asOfDate:", aging.asOfDate);
    console.log("   summary.totalOutstandingEUR:", aging.summary?.totalOutstandingEUR);
    console.log("   ✓");
  } catch (e) {
    console.error("   ✗", e.message);
  }
  await new Promise((r) => setTimeout(r, 3000));

  console.log("\n5) spendesk_get_cash_flow_forecast (days: 30)");
  try {
    const forecast = await mcpCall(sessionId, protocolVersion, "spendesk_get_cash_flow_forecast", {
      days: 30,
      groupBy: "week",
    });
    console.log("   forecastPeriod:", forecast.forecastPeriod);
    console.log("   totalForecastEUR:", forecast.totalForecastEUR);
    console.log("   byPeriod count:", forecast.byPeriod?.length ?? 0);
    console.log("   ✓");
  } catch (e) {
    console.error("   ✗", e.message);
  }

  console.log("\n✓ Composite tools test done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
