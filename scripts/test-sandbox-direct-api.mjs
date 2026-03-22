#!/usr/bin/env node
/**
 * Quelques appels API directs sur la sandbox Spendesk (trunk).
 * Utilise SPENDESK_BASE_URL ou, si absent, https://beta-sandbox.api.trunk.spendesk.services
 * quand SPENDESK_USE_DEMO=true.
 *
 * Auth (priorité) :
 *   1) SPENDESK_API_TOKEN → Bearer direct
 *   2) SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET → POST /v1/auth/token (client_credentials)
 *
 * Usage : node scripts/test-sandbox-direct-api.mjs
 *         SUPPLIER_IDS=id1,id2 node scripts/test-sandbox-direct-api.mjs
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const useDemo =
  process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
const baseUrl = (
  process.env.SPENDESK_BASE_URL?.replace(/\/$/, "") ||
  (useDemo ? "https://beta-sandbox.api.trunk.spendesk.services" : "https://public-api.spendesk.com")
).replace(/\/$/, "");

const apiToken = process.env.SPENDESK_API_TOKEN?.trim();
const clientId = process.env.SPENDESK_CLIENT_ID?.trim();
const clientSecret = process.env.SPENDESK_CLIENT_SECRET?.trim();

async function getBearer() {
  if (apiToken) return apiToken;
  if (!clientId || !clientSecret) {
    console.error(
      "Définis SPENDESK_API_TOKEN ou SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET dans .env"
    );
    process.exit(1);
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const res = await fetch(`${baseUrl}/v1/auth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Token:", res.status, JSON.stringify(data).slice(0, 300));
    process.exit(1);
  }
  return data.access_token;
}

async function req(method, path, token, { search = "", body } = {}) {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}${search}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, data, retryAfter: res.headers.get("retry-after") };
}

function summarizeSuppliers(data) {
  const list = data?.suppliers ?? data?.data ?? [];
  const arr = Array.isArray(list) ? list : [];
  return {
    count: arr.length,
    firstId: arr[0]?.id ?? null,
    firstName: arr[0]?.name ?? arr[0]?.legalName ?? null,
  };
}

function summarizePO(data) {
  const list = data?.purchaseOrders ?? data?.data ?? [];
  const arr = Array.isArray(list) ? list : [];
  return {
    count: arr.length,
    firstId: arr[0]?.id ?? null,
    firstStatus: arr[0]?.status ?? null,
  };
}

async function main() {
  console.log("Base URL:", baseUrl);
  console.log("Auth:", apiToken ? "SPENDESK_API_TOKEN (Bearer)" : "client_credentials");

  let token;
  try {
    token = await getBearer();
  } catch (e) {
    console.error("Échec auth / réseau:", e?.message || e);
    process.exit(1);
  }

  // 1) GET suppliers (liste courte)
  console.log("\n--- GET /v1/suppliers?page=1&pageSize=5 ---");
  let r = await req("GET", "/v1/suppliers", token, { search: "?page=1&pageSize=5" });
  console.log("HTTP", r.status, r.ok ? "OK" : "FAIL", r.retryAfter ? `retry-after=${r.retryAfter}` : "");
  if (r.ok) {
    console.log("Résumé:", JSON.stringify(summarizeSuppliers(r.data)));
  } else {
    console.log("Body:", JSON.stringify(r.data).slice(0, 400));
  }

  // 2) GET suppliers avec ids= (comme Postman) si fourni
  const idsEnv = process.env.SUPPLIER_IDS?.trim();
  if (idsEnv && r.ok) {
    const q = new URLSearchParams({ page: "1", pageSize: "10", ids: idsEnv.split(",")[0].trim() });
    console.log("\n--- GET /v1/suppliers (filtre ids) ---");
    r = await req("GET", "/v1/suppliers", token, { search: `?${q.toString()}` });
    console.log("HTTP", r.status, r.ok ? "OK" : "FAIL");
    if (r.ok) console.log("Résumé:", JSON.stringify(summarizeSuppliers(r.data)));
    else console.log("Body:", JSON.stringify(r.data).slice(0, 400));
  }

  // 3) GET purchase-orders
  console.log("\n--- GET /v1/purchase-orders?page=1&pageSize=5 ---");
  r = await req("GET", "/v1/purchase-orders", token, { search: "?page=1&pageSize=5" });
  console.log("HTTP", r.status, r.ok ? "OK" : "FAIL", r.retryAfter ? `retry-after=${r.retryAfter}` : "");
  if (r.ok) {
    console.log("Résumé:", JSON.stringify(summarizePO(r.data)));
  } else {
    console.log("Body:", JSON.stringify(r.data).slice(0, 400));
  }

  // 4) GET users (1 page)
  console.log("\n--- GET /v1/users?page=1&perPage=1 ---");
  r = await req("GET", "/v1/users", token, { search: "?page=1&perPage=1" });
  console.log("HTTP", r.status, r.ok ? "OK" : "FAIL", r.retryAfter ? `retry-after=${r.retryAfter}` : "");
  if (r.ok) {
    const u = r.data?.data?.[0] ?? r.data?.users?.[0];
    console.log("Premier user id:", u?.id ?? "(non trouvé)");
  } else {
    console.log("Body:", JSON.stringify(r.data).slice(0, 300));
  }

  // 5) GET cost-centers
  console.log("\n--- GET /v1/cost-centers?page=1&perPage=1 ---");
  r = await req("GET", "/v1/cost-centers", token, { search: "?page=1&perPage=1" });
  console.log("HTTP", r.status, r.ok ? "OK" : "FAIL");
  if (r.ok) {
    const cc = r.data?.data?.[0] ?? r.data?.costCenters?.[0];
    console.log("Premier cost center id:", cc?.id ?? "(non trouvé)");
  } else {
    console.log("Body:", JSON.stringify(r.data).slice(0, 300));
  }

  console.log("\n--- Fin ---");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
