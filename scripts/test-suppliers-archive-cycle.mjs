#!/usr/bin/env node
/**
 * Test flux fournisseurs (API directe, aligné MCP) :
 *   1) GET /v1/suppliers — plusieurs pages isArchived=false
 *   2) Tri client par createdAt décroissant (l’API ne documente pas de sort)
 *   3) Les N plus récemment créés parmi les actifs (défaut N=10)
 *   4) PATCH /v1/experimental/suppliers/:id/status { isArchived: true } pour chacun
 *   5) Vérification GET /v1/suppliers/:id (isArchived)
 *   6) PATCH { isArchived: false } pour chacun
 *
 * Scope : supplier:read + experimental:supplier:manage
 *
 * Env :
 *   SUPPLIER_ARCHIVE_TEST_COUNT — nombre de fournisseurs (défaut 10)
 *   SUPPLIER_ARCHIVE_TEST_MAX_PAGES — pages max à agréger pour le tri (défaut 15, pageSize 30)
 *   SUPPLIER_ARCHIVE_TEST_DRY_RUN=1 — liste + tri uniquement, pas d’archive
 *   SUPPLIER_ARCHIVE_TEST_PATCH_DELAY_MS — pause entre chaque PATCH status (défaut 600) pour limiter les 429
 *
 * Usage : npm run test:suppliers-archive-cycle
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const useDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
const clientId =
  (useDemo ? process.env.SPENDESK_CLIENT_ID_DEMO : null)?.trim() || process.env.SPENDESK_CLIENT_ID?.trim();
const clientSecret =
  (useDemo ? process.env.SPENDESK_CLIENT_SECRET_DEMO : null)?.trim() ||
  process.env.SPENDESK_CLIENT_SECRET?.trim();
const baseUrl =
  process.env.SPENDESK_BASE_URL?.replace(/\/$/, "") ||
  (useDemo ? "https://beta-sandbox.api.trunk.spendesk.services" : "https://public-api.spendesk.com");

const COUNT = Math.min(30, Math.max(1, Number(process.env.SUPPLIER_ARCHIVE_TEST_COUNT ?? 10)));
const MAX_PAGES = Math.min(50, Math.max(1, Number(process.env.SUPPLIER_ARCHIVE_TEST_MAX_PAGES ?? 15)));
const DRY = process.env.SUPPLIER_ARCHIVE_TEST_DRY_RUN === "1";
const PATCH_DELAY_MS = Math.max(0, Number(process.env.SUPPLIER_ARCHIVE_TEST_PATCH_DELAY_MS ?? 800));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!clientId || !clientSecret) {
  console.error("Credentials manquants (SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET ou _DEMO).");
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
  return String(data.access_token ?? "").trim();
}

async function api(method, path, token, { body, query } = {}) {
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const max = 8;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  for (let attempt = 1; attempt <= max; attempt++) {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (res.status === 429 && attempt < max) {
      const ra = res.headers?.get?.("retry-after");
      const sec = ra ? parseInt(ra, 10) : NaN;
      const wait =
        Number.isFinite(sec) && sec > 0
          ? Math.min(sec * 1000, 120_000)
          : Math.min(15_000 * attempt, 90_000);
      console.warn(`429 — retry dans ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    return { status: res.status, ok: res.ok, data };
  }
  return { status: 429, ok: false, data: {} };
}

function parseSupplierRows(payload) {
  const d = payload?.data;
  return Array.isArray(d) ? d : [];
}

async function fetchActiveSuppliersForSort(token) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await api("GET", "/v1/suppliers", token, {
      query: {
        page: String(page),
        pageSize: "30",
        isArchived: "false",
      },
    });
    if (!r.ok) {
      throw new Error(`GET /v1/suppliers page ${page}: ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
    }
    const rows = parseSupplierRows(r.data);
    all.push(...rows);
    const total = r.data?.meta?.pagination?.total;
    const pageSize = r.data?.meta?.pagination?.pageSize ?? 30;
    if (typeof total === "number" && page * pageSize >= total) break;
    if (rows.length === 0) break;
  }
  return all;
}

/** GET /v1/suppliers/:id may return the supplier as root JSON or under .data */
function supplierFromGetPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.data && typeof payload.data === "object" && payload.data.id != null) return payload.data;
  if (payload.id != null) return payload;
  return null;
}

function pickLatestCreated(suppliers, n) {
  const withTs = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    ts: s.createdAt ? new Date(s.createdAt).getTime() : 0,
  }));
  withTs.sort((a, b) => b.ts - a.ts);
  const seen = new Set();
  const out = [];
  for (const x of withTs) {
    if (!x.id || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

async function main() {
  console.log("Base URL:", baseUrl);
  console.log("Cible:", COUNT, "fournisseur(s) les plus récents (actifs), max pages agrégées:", MAX_PAGES);
  if (DRY) console.log("Mode DRY RUN — pas de PATCH archive.\n");

  const token = await getToken();
  console.log("✓ Token OK\n");

  const allActive = await fetchActiveSuppliersForSort(token);
  console.log(`Collecté ${allActive.length} fournisseur(s) actif(s) sur ${MAX_PAGES} page(s) max.`);

  const picked = pickLatestCreated(allActive, COUNT);
  if (picked.length === 0) {
    console.error("Aucun fournisseur actif trouvé.");
    process.exit(2);
  }
  if (picked.length < COUNT) {
    console.warn(`Seulement ${picked.length} fournisseur(s) disponibles (demandé ${COUNT}).`);
  }

  console.log("\nSélection (createdAt desc) :");
  for (const p of picked) {
    console.log(`  - ${p.id}  ${p.name?.slice(0, 40) ?? ""}  createdAt=${p.createdAt ?? "?"}`);
  }

  const report = {
    baseUrl,
    count: picked.length,
    ids: picked.map((p) => p.id),
    steps: [],
  };

  if (DRY) {
    const reportPath = join(dirname(fileURLToPath(import.meta.url)), "..", "suppliers-archive-cycle-report.json");
    writeFileSync(reportPath, JSON.stringify({ ...report, dryRun: true }, null, 2), "utf8");
    console.log("\nRapport:", reportPath);
    process.exit(0);
  }

  console.log("\n--- Archive (PATCH .../status isArchived: true) ---");
  for (const p of picked) {
    const path = `/v1/experimental/suppliers/${encodeURIComponent(p.id)}/status`;
    const r = await api("PATCH", path, token, { body: { isArchived: true } });
    report.steps.push({ action: "archive", id: p.id, status: r.status, ok: r.ok });
    console.log(r.ok ? `✓ archive ${p.id}` : `✗ archive ${p.id} → ${r.status}`, r.ok ? "" : JSON.stringify(r.data).slice(0, 200));
    if (!r.ok) {
      console.error("Arrêt sur erreur archive.");
      writeFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "suppliers-archive-cycle-report.json"),
        JSON.stringify(report, null, 2),
        "utf8"
      );
      process.exit(1);
    }
    if (PATCH_DELAY_MS) await sleep(PATCH_DELAY_MS);
  }

  console.log("\n--- Vérification GET /v1/suppliers/:id ---");
  for (const p of picked) {
    const r = await api("GET", `/v1/suppliers/${encodeURIComponent(p.id)}`, token, {});
    const s = supplierFromGetPayload(r.data);
    const archived = s?.isArchived;
    report.steps.push({ action: "get_after_archive", id: p.id, status: r.status, isArchived: archived });
    console.log(
      r.ok ? `✓ GET ${p.id} isArchived=${archived}` : `✗ GET ${p.id} ${r.status}`,
      r.ok ? "" : JSON.stringify(r.data).slice(0, 150)
    );
    if (PATCH_DELAY_MS) await sleep(Math.min(250, PATCH_DELAY_MS));
  }

  const pauseBeforeUnarchive = Math.max(5000, PATCH_DELAY_MS * 3);
  console.log(`\nPause ${pauseBeforeUnarchive / 1000}s avant désarchivage (rate limit)…`);
  await sleep(pauseBeforeUnarchive);

  console.log("\n--- Désarchivage (isArchived: false) ---");
  for (const p of picked) {
    const path = `/v1/experimental/suppliers/${encodeURIComponent(p.id)}/status`;
    const r = await api("PATCH", path, token, { body: { isArchived: false } });
    report.steps.push({ action: "unarchive", id: p.id, status: r.status, ok: r.ok });
    console.log(r.ok ? `✓ unarchive ${p.id}` : `✗ unarchive ${p.id} → ${r.status}`, r.ok ? "" : JSON.stringify(r.data).slice(0, 200));
    if (!r.ok) {
      console.error("Erreur désarchivage — IDs encore archivés:", picked.map((x) => x.id).join(", "));
      writeFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "suppliers-archive-cycle-report.json"),
        JSON.stringify(report, null, 2),
        "utf8"
      );
      process.exit(1);
    }
    if (PATCH_DELAY_MS) await sleep(PATCH_DELAY_MS);
  }

  console.log("\n--- Vérification finale GET ---");
  for (const p of picked) {
    const r = await api("GET", `/v1/suppliers/${encodeURIComponent(p.id)}`, token, {});
    const s = supplierFromGetPayload(r.data);
    const archived = s?.isArchived;
    report.steps.push({ action: "get_after_unarchive", id: p.id, status: r.status, isArchived: archived });
    console.log(r.ok ? `✓ GET ${p.id} isArchived=${archived}` : `✗ GET ${p.id}`, r.ok ? "" : String(r.status));
  }

  const reportPath = join(dirname(fileURLToPath(import.meta.url)), "..", "suppliers-archive-cycle-report.json");
  writeFileSync(reportPath, JSON.stringify({ ...report, success: true }, null, 2), "utf8");
  console.log("\n✓ Cycle archive / désarchive terminé.");
  console.log("Rapport:", reportPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
