#!/usr/bin/env node
/**
 * Démo compte Spendesk (trunk sandbox / demo) :
 *  Scénario A — Créer 1 supplier → PATCH update → archiver
 *  Scénario B — Créer 2 suppliers avec le même VAT → GET filtre vatNumber → archiver le plus récent
 *
 * Prérequis : .env avec
 *   SPENDESK_USE_DEMO=true (recommandé trunk sandbox)
 *   SPENDESK_CLIENT_ID (+ SECRET) ou SPENDESK_CLIENT_ID_DEMO (+ SECRET_DEMO)
 *   Scope experimental:supplier:manage sur les credentials
 *
 * Usage : node scripts/demo-supplier-lifecycle.mjs
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
  console.error(
    "Définir SPENDESK_CLIENT_ID (+ SECRET) ou SPENDESK_CLIENT_ID_DEMO (+ SECRET_DEMO) selon SPENDESK_USE_DEMO."
  );
  process.exit(1);
}

async function getAccessToken() {
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
    console.error("Token KO:", res.status, JSON.stringify(data));
    process.exit(1);
  }
  if (!data.access_token) {
    console.error("Pas d'access_token:", data);
    process.exit(1);
  }
  return data.access_token;
}

async function api(method, path, { token, body, query } = {}) {
  const url = new URL(path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

function supplierPayload(nameSuffix, vatNumber) {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: `MCP Demo ${nameSuffix} ${tag}`,
    primaryEmail: `mcp-${tag}@example.invalid`,
    supplierDetails: {
      legalName: `MCP Demo Legal ${nameSuffix} ${tag}`,
      vatNumber,
      country: "FR",
      city: "Paris",
      zipcode: "75001",
      address: "1 rue Demo",
    },
  };
}

function extractCreatedIds(data) {
  if (data?.item?.id) return [data.item.id];
  const items = data?.items;
  if (!Array.isArray(items)) return [];
  const ids = [];
  for (const it of items) {
    if (it?.outcome === "created" && it?.supplier?.id) ids.push(it.supplier.id);
  }
  return ids;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Base URL:", baseUrl);
  const token = await getAccessToken();
  console.log("✓ Token OK\n");

  const sharedVat = `FR${String(Math.floor(1e10 + Math.random() * 9e10)).slice(0, 11)}`;

  // —— Scénario A
  console.log("=== Scénario A : créer → modifier → archiver ===");
  const create1 = await api("POST", "/v1/suppliers", {
    token,
    body: [supplierPayload("Solo", `FR${String(Math.floor(1e10 + Math.random() * 9e10)).slice(0, 11)}`)],
  });
  if (!create1.res.ok) {
    console.error("Création A échouée:", create1.res.status, JSON.stringify(create1.data));
    process.exit(1);
  }
  const [idA] = extractCreatedIds(create1.data);
  if (!idA) {
    console.error("Pas d’ID supplier après création A:", JSON.stringify(create1.data));
    process.exit(1);
  }
  console.log("Créé supplier A id:", idA);

  const patchA = await api("PATCH", `/v1/suppliers/${encodeURIComponent(idA)}`, {
    token,
    body: { name: `MCP Demo Solo (updated) ${Date.now()}` },
  });
  if (!patchA.res.ok) {
    console.error("PATCH update A échoué:", patchA.res.status, JSON.stringify(patchA.data));
    process.exit(1);
  }
  console.log("✓ Modifié (PATCH)");

  const archA = await api("PATCH", `/v1/experimental/suppliers/${encodeURIComponent(idA)}/status`, {
    token,
    body: { isArchived: true },
  });
  if (!archA.res.ok) {
    console.error("Archive A échouée:", archA.res.status, JSON.stringify(archA.data));
    process.exit(1);
  }
  console.log("✓ Archivé:", JSON.stringify(archA.data).slice(0, 500));
  console.log("");

  // —— Scénario B (même VAT)
  console.log("=== Scénario B : 2 suppliers même VAT → recherche → archiver le plus récent ===");
  console.log("VAT partagé:", sharedVat);

  const createB1 = await api("POST", "/v1/suppliers", {
    token,
    body: [supplierPayload("B-first", sharedVat)],
  });
  if (!createB1.res.ok) {
    console.error("Création B1 échouée:", createB1.res.status, JSON.stringify(createB1.data));
    process.exit(1);
  }
  const [idB1] = extractCreatedIds(createB1.data);
  console.log("Créé B1 id:", idB1);

  await sleep(1200);

  const createB2 = await api("POST", "/v1/suppliers", {
    token,
    body: [supplierPayload("B-second", sharedVat)],
  });
  if (!createB2.res.ok) {
    console.error("Création B2 échouée:", createB2.res.status, JSON.stringify(createB2.data));
    process.exit(1);
  }
  const [idB2] = extractCreatedIds(createB2.data);
  console.log("Créé B2 id:", idB2);

  const list = await api("GET", "/v1/suppliers", {
    token,
    query: {
      page: "1",
      pageSize: "30",
      vatNumber: sharedVat,
      isArchived: "false",
    },
  });
  if (!list.res.ok) {
    console.error("Liste par VAT échouée:", list.res.status, JSON.stringify(list.data));
    process.exit(1);
  }
  const rows = Array.isArray(list.data?.data) ? list.data.data : [];
  console.log(`Trouvé ${rows.length} supplier(s) actif(s) pour ce VAT`);

  const withDates = rows.map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt ? new Date(s.createdAt).getTime() : 0,
  }));
  withDates.sort((a, b) => b.createdAt - a.createdAt);
  const newest = withDates[0];
  if (!newest?.id) {
    console.error("Impossible de déterminer le plus récent:", rows);
    process.exit(1);
  }
  console.log("Plus récent (par createdAt):", newest.id, newest.name);

  const archB = await api("PATCH", `/v1/experimental/suppliers/${encodeURIComponent(newest.id)}/status`, {
    token,
    body: { isArchived: true },
  });
  if (!archB.res.ok) {
    console.error("Archive B échouée:", archB.res.status, JSON.stringify(archB.data));
    process.exit(1);
  }
  console.log("✓ Archivé le plus récent:", JSON.stringify(archB.data).slice(0, 500));

  console.log("\n✅ Démo terminée.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
