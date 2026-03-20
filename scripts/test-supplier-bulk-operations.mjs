#!/usr/bin/env node
/**
 * Tests API Spendesk (démo trunk) :
 * 1) POST /v1/suppliers — bulk create (tableau de N suppliers)
 * 2) PATCH /v1/suppliers — bulk update (min 2 items avec id)
 * 3) PATCH /v1/experimental/suppliers/status — bulk archive (supplierIds + isArchived)
 *
 * Usage: node scripts/test-supplier-bulk-operations.mjs
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const useDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
const clientId =
  (useDemo ? process.env.SPENDESK_CLIENT_ID_DEMO : null)?.trim() ||
  process.env.SPENDESK_CLIENT_ID?.trim();
const clientSecret =
  (useDemo ? process.env.SPENDESK_CLIENT_SECRET_DEMO : null)?.trim() ||
  process.env.SPENDESK_CLIENT_SECRET?.trim();
const baseUrl =
  process.env.SPENDESK_BASE_URL?.replace(/\/$/, "") ||
  (useDemo ? "https://beta-sandbox.api.trunk.spendesk.services" : "https://public-api.spendesk.com");

if (!clientId || !clientSecret) {
  console.error("Credentials manquants (voir demo-supplier-lifecycle.mjs)");
  process.exit(1);
}

async function getToken() {
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
  if (!res.ok) throw new Error(`Token ${res.status}: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function req(method, path, token, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

function tag() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSupplier(label, vat) {
  const t = tag();
  return {
    name: `BulkTest ${label} ${t}`,
    primaryEmail: `bulk-${t}@example.invalid`,
    supplierDetails: {
      legalName: `BulkTest Legal ${label} ${t}`,
      vatNumber: vat,
      country: "FR",
      city: "L Lyon",
      zipcode: "69001",
      address: "10 rue Test Bulk",
    },
  };
}

function extractCreatedIds(body) {
  const ids = [];
  if (body?.item?.id) ids.push(body.item.id);
  if (Array.isArray(body?.items)) {
    for (const it of body.items) {
      if (it?.outcome === "created" && it?.supplier?.id) ids.push(it.supplier.id);
    }
  }
  return ids;
}

async function main() {
  const token = await getToken();
  const runTag = tag();
  const vat1 = `FR${String(Math.floor(1e10 + Math.random() * 9e10)).slice(0, 11)}`;
  const vat2 = `FR${String(Math.floor(1e10 + Math.random() * 9e10)).slice(0, 11)}`;
  const vat3 = `FR${String(Math.floor(1e10 + Math.random() * 9e10)).slice(0, 11)}`;

  const bulkCreateBody = [
    makeSupplier(`A-${runTag}`, vat1),
    makeSupplier(`B-${runTag}`, vat2),
    makeSupplier(`C-${runTag}`, vat3),
  ];

  console.log("========== Étape 1 : POST /v1/suppliers (bulk create, 3 items) ==========");
  const create = await req("POST", "/v1/suppliers", token, bulkCreateBody);
  console.log("HTTP:", create.status, create.ok ? "OK" : "FAIL");
  console.log(JSON.stringify(create.data, null, 2));

  const ids = extractCreatedIds(create.data);
  console.log("IDs extraits:", ids);
  if (ids.length < 2) {
    console.error("Besoin d’au moins 2 IDs pour bulk PATCH /v1/suppliers — arrêt.");
    process.exit(1);
  }

  console.log("\n========== Étape 2 : PATCH /v1/suppliers (bulk update, 3 items) ==========");
  const bulkPatchBody = ids.map((id, i) => ({
    id,
    name: `BulkTest UPDATED-${i + 1} ${runTag}`,
  }));
  const patch = await req("PATCH", "/v1/suppliers", token, bulkPatchBody);
  console.log("HTTP:", patch.status, patch.ok ? "OK" : "FAIL");
  console.log(JSON.stringify(patch.data, null, 2));

  console.log("\n========== Étape 3 : PATCH /v1/experimental/suppliers/status (bulk archive) ==========");
  const bulkArchiveBody = {
    supplierIds: ids,
    isArchived: true,
  };
  const arch = await req("PATCH", "/v1/experimental/suppliers/status", token, bulkArchiveBody);
  console.log("HTTP:", arch.status, arch.ok ? "OK" : "FAIL");
  console.log(JSON.stringify(arch.data, null, 2));

  console.log("\n========== Fin ==========");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
