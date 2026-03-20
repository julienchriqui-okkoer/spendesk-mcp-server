#!/usr/bin/env node
/**
 * Teste les endpoints Suppliers sur l'environnement DEMO.
 *
 * Endpoints couverts (lecture uniquement, pas de mutation) :
 *   - GET /v1/suppliers
 *   - GET /v1/suppliers/:id (sur le premier supplier trouvé)
 *
 * Prérequis :
 *   - Node >= 18 (fetch global disponible)
 *   - Un token API Spendesk sur l'environnement DEMO
 *
 * Usage :
 *   SPENDESK_API_TOKEN=<demo_token> SPENDESK_USE_DEMO=true node scripts/test-suppliers-demo.mjs
 *
 * Options :
 *   - LIMIT : nombre max de suppliers à lister (défaut 5)
 */

const limit = Math.min(parseInt(process.env.LIMIT || "5", 10) || 5, 100);
const token = process.env.SPENDESK_API_TOKEN;

if (!token) {
  console.error("SPENDESK_API_TOKEN requis (token API Spendesk DEMO).");
  process.exit(1);
}

const isDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
if (!isDemo) {
  console.warn(
    "⚠️  SPENDESK_USE_DEMO n'est pas positionné à true. Ce script est prévu pour l'environnement DEMO."
  );
}

const baseUrl =
  process.env.SPENDESK_BASE_URL ||
  (isDemo ? "https://beta-sandbox.api.trunk.spendesk.services" : "https://public-api.spendesk.com");

async function request(method, path, body) {
  const url = `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const options = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  return { res, data, text };
}

async function testGetSuppliers() {
  console.log(`\n▶ GET /v1/suppliers (limit=${limit})`);
  const { res, data, text } = await request(
    "GET",
    `/v1/suppliers?per_page=${limit}&page=1`,
  );
  if (!res.ok) {
    console.error(`❌ /v1/suppliers a retourné ${res.status}`);
    console.error(String(text).slice(0, 400));
    process.exit(1);
  }
  const raw = data.suppliers ?? data.data ?? data;
  const suppliers = Array.isArray(raw) ? raw : raw?.data ?? [];
  console.log(`✅ ${suppliers.length} supplier(s) retourné(s).`);
  return suppliers;
}

async function testGetSupplierById(id) {
  console.log(`\n▶ GET /v1/suppliers/${id}`);
  const { res, data, text } = await request("GET", `/v1/suppliers/${encodeURIComponent(id)}`);
  if (!res.ok) {
    console.error(`❌ /v1/suppliers/${id} a retourné ${res.status}`);
    console.error(String(text).slice(0, 400));
    process.exit(1);
  }
  const name = data.name ?? data.legalName ?? data.companyName ?? "-";
  console.log(`✅ Supplier trouvé : ${name} (id: ${id})`);
}

async function main() {
  console.log("=== Test Suppliers (ENV DEMO) ===");
  console.log(`Base URL : ${baseUrl}`);

  const suppliers = await testGetSuppliers();
  if (suppliers.length === 0) {
    console.log("ℹ️  Aucun supplier trouvé, test GET /v1/suppliers/:id sauté.");
    return;
  }
  const first = suppliers[0];
  const id = first.id ?? first.supplierId ?? first.supplier_id;
  if (!id) {
    console.log("ℹ️  Impossible de déterminer un supplierId sur le premier résultat, test GET /:id sauté.");
    return;
  }
  await testGetSupplierById(String(id));

  console.log("\n✅ Tous les tests Suppliers DEMO ont réussi.\n");
}

main().catch((err) => {
  console.error("❌ Erreur inattendue pendant les tests Suppliers DEMO:", err);
  process.exit(1);
});

