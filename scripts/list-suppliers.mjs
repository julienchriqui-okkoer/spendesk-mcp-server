#!/usr/bin/env node
/**
 * Liste les N derniers fournisseurs Spendesk (API demo par défaut).
 * Usage: SPENDESK_API_TOKEN=xxx node scripts/list-suppliers.mjs [limit]
 */
const limit = Math.min(parseInt(process.env.LIMIT || process.argv[2] || "5", 10) || 5, 100);
const token = process.env.SPENDESK_API_TOKEN;
const baseUrl = process.env.SPENDESK_BASE_URL || (process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1"
  ? "https://beta-sandbox.api.trunk.spendesk.services"
  : "https://public-api.spendesk.com");

if (!token) {
  console.error("SPENDESK_API_TOKEN requis.");
  process.exit(1);
}

const url = `${baseUrl}/v1/suppliers?per_page=${limit}&page=1`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
const text = await res.text();
if (!res.ok) {
  console.error("Erreur API:", res.status, text.slice(0, 200));
  if (res.status === 404) {
    console.error("\nL’endpoint /v1/suppliers peut être indisponible sur cet environnement (ex. API démo/trunk).");
    console.error("Vérifiez SPENDESK_USE_DEMO et le token, ou utilisez l’API de production.");
  }
  process.exit(1);
}
let data;
try {
  data = JSON.parse(text);
} catch {
  console.error("Réponse non-JSON:", text.slice(0, 200));
  process.exit(1);
}
const raw = data.suppliers ?? data.data ?? data;
const suppliers = Array.isArray(raw) ? raw : (raw?.data ?? raw?.items ?? []);
const list = suppliers.slice(0, limit);
console.log(`\n${list.length} fournisseur(s) Spendesk (${limit} demandé(s)):\n`);
list.forEach((s, i) => {
  const name = s.name ?? s.legalName ?? s.companyName ?? "-";
  const id = s.id ?? s.supplierId ?? "-";
  console.log(`${i + 1}. ${name} (id: ${id})`);
});
console.log("");
