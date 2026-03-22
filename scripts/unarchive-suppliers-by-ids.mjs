#!/usr/bin/env node
/**
 * PATCH /v1/experimental/suppliers/:id/status { isArchived: false } pour une liste d’IDs.
 *
 * Usage:
 *   SUPPLIER_IDS=id1,id2,id3 node -r dotenv/config scripts/unarchive-suppliers-by-ids.mjs
 *
 * Optionnel : SUPPLIER_UNARCHIVE_DELAY_MS (défaut 900) entre chaque PATCH.
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

const DELAY = Math.max(0, Number(process.env.SUPPLIER_UNARCHIVE_DELAY_MS ?? 900));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const raw = process.env.SUPPLIER_IDS?.trim();
if (!raw) {
  console.error("Définis SUPPLIER_IDS=id1,id2,... (séparés par des virgules).");
  process.exit(1);
}
const ids = raw
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter(Boolean);

if (!clientId || !clientSecret) {
  console.error("Credentials manquants.");
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

async function patchUnarchive(token, id) {
  const url = `${baseUrl}/v1/experimental/suppliers/${encodeURIComponent(id)}/status`;
  const max = 8;
  for (let attempt = 1; attempt <= max; attempt++) {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isArchived: false }),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (res.status === 429 && attempt < max) {
      const ra = res.headers.get("retry-after");
      const sec = ra ? parseInt(ra, 10) : NaN;
      const wait =
        Number.isFinite(sec) && sec > 0
          ? Math.min(sec * 1000, 120_000)
          : Math.min(20_000 * attempt, 90_000);
      console.warn(`  429 ${id} — attente ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    return { status: res.status, ok: res.ok, data };
  }
  return { status: 429, ok: false, data: {} };
}

async function main() {
  console.log("Base URL:", baseUrl);
  console.log("Désarchivage de", ids.length, "supplier(s)\n");
  const token = await getToken();
  for (const id of ids) {
    const r = await patchUnarchive(token, id);
    console.log(r.ok ? `✓ ${id}` : `✗ ${id} HTTP ${r.status}`, r.ok ? "" : JSON.stringify(r.data).slice(0, 200));
    if (!r.ok) process.exitCode = 1;
    if (DELAY) await sleep(DELAY);
  }
  if (process.exitCode === 1) process.exit(1);
  console.log("\n✓ Terminé.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
