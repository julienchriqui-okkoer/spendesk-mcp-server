#!/usr/bin/env node
/**
 * Test des 5 endpoints Public API « Purchase Orders » :
 *   GET  /v1/purchase-orders
 *   POST /v1/purchase-orders
 *   GET  /v1/purchase-orders/:purchaseOrderId
 *   POST /v1/purchase-orders/:purchaseOrderId/cancel
 *   POST /v1/purchase-orders/:purchaseOrderId/close
 *
 * Génère purchase-orders-api-test-report.json (gitignored) + mettre à jour docs/purchase-orders-api-test.md via exécution manuelle.
 *
 * Prérequis : .env (client credentials) avec scopes experimental:purchase-order:read + experimental:purchase-order:write
 *             + données (user, cost center, supplier) sur l’environnement.
 *
 * Surcharges optionnelles :
 *   PO_TEST_USER_ID, PO_TEST_COST_CENTER_ID, PO_TEST_SUPPLIER_ID, PO_TEST_SUPPLIER_NAME
 *   SPENDESK_BASE_URL — même host que Postman `{{base_url}}` (sinon démo → trunk par défaut)
 *   PO_DEBUG=1 — affiche le 1er corps de création tenté (pour diff avec Postman)
 *   PO_TEST_SKIP_MUTATIONS=1 — seulement GET liste + GET détail si la liste retourne au moins un PO
 *   PO_TEST_CANCEL_PO_ID / PO_TEST_CLOSE_PO_ID — IDs d’OP **ouverts** à clôturer (annulation / clôture) si la création API échoue
 *
 * Usage: node scripts/test-purchase-orders-api.mjs
 */
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

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
  console.error("Credentials manquants.");
  process.exit(1);
}

function tag() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const tok = data.access_token;
  return tok != null ? String(tok).trim() : tok;
}

async function api(method, path, token, { body, query } = {}) {
  const url = new URL(path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const max = 4;
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
      const wait = 8000 * attempt;
      console.warn(`429 — retry dans ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return { status: res.status, ok: res.ok, data };
  }
  return { status: 429, ok: false, data: {} };
}

function extractPoId(data) {
  if (!data || typeof data !== "object") return null;
  const d = data.data;
  if (d && typeof d === "object") {
    if (d.id != null) return String(d.id);
    if (d.data && typeof d.data === "object" && d.data.id != null) return String(d.data.id);
  }
  if (data.id) return String(data.id);
  if (data.purchaseOrderId) return String(data.purchaseOrderId);
  if (data.result && typeof data.result === "object" && data.result.id != null) return String(data.result.id);
  return null;
}

function poData(data) {
  if (data?.data?.id != null) return data.data;
  if (data?.data && typeof data.data === "object" && !Array.isArray(data.data)) return data.data;
  return data;
}

function buildMinimalCreatePayload({ userId, costCenterId, supplierId, supplierName, runTag }) {
  const money = (cents) => ({ amount: cents, currency: "EUR", precision: 2 });
  const base = {
    userId,
    amount: money(50_000),
    netAmount: money(50_000),
    costCenterId,
    startDate: "2026-04-01T10:00:00.000Z",
    endDate: "2026-12-31T18:00:00.000Z",
    customFieldAssociations: [],
    description: `API test PO minimal ${runTag}`.slice(0, 250),
    items: [],
    deliveryNotesExpected: false,
  };
  if (supplierName && String(supplierName).trim()) {
    base.supplierName = String(supplierName).trim();
  } else if (supplierId) {
    base.supplierId = supplierId;
  }
  return base;
}

function buildCreatePayload({ userId, costCenterId, supplierId, supplierName, runTag, customFieldAssociations }) {
  const money = (cents) => ({ amount: cents, currency: "EUR", precision: 2 });
  const base = {
    userId,
    amount: money(50_000),
    netAmount: money(50_000),
    costCenterId,
    startDate: "2026-04-01T10:00:00.000Z",
    endDate: "2026-12-31T18:00:00.000Z",
    customFieldAssociations,
    description: `API test PO ${runTag}`.slice(0, 250),
    items: [
      {
        name: `Item ${runTag}`.slice(0, 250),
        quantity: 1,
        unitPrice: money(50_000),
        vatRate: 0,
      },
    ],
    deliveryNotesExpected: false,
  };
  if (supplierName && String(supplierName).trim()) {
    base.supplierName = String(supplierName).trim();
  } else if (supplierId) {
    base.supplierId = supplierId;
  }
  return base;
}

/** N’envoie une association que si customFieldId + customFieldValueId (comme Postman après Discovery complet) ; sinon []. */
function normalizeCustomFieldAssociations(associations) {
  if (!Array.isArray(associations) || associations.length === 0) return [];
  const out = [];
  for (const a of associations) {
    if (!a || typeof a !== "object") continue;
    const fid = a.customFieldId != null ? String(a.customFieldId).trim() : "";
    const vid = a.customFieldValueId != null ? String(a.customFieldValueId).trim() : "";
    if (fid && vid) out.push({ customFieldId: fid, customFieldValueId: vid });
  }
  return out;
}

/**
 * Enchaîne des corps proches de la collection Postman : 05b (minimal) en premier, puis variantes.
 * @returns {{ res: Awaited<ReturnType<typeof api>>, label: string }}
 */
async function createPurchaseOrderWithRetries(token, ctx, rawCfa, runTag) {
  const cfaFull = normalizeCustomFieldAssociations(rawCfa);
  /** Contrepartie stricte « id seul » (OpenAPI : fournir supplierId OU supplierName, pas les deux). */
  const ctxById = { ...ctx, supplierName: null };
  const ctxByName = { ...ctx, supplierId: null };

  const attempts = [
    {
      label: "minimal + supplierId (05b)",
      body: buildMinimalCreatePayload({ ...ctxById, runTag }),
    },
    {
      label: "minimal + supplierName (OpenAPI anyOf)",
      body: buildMinimalCreatePayload({ ...ctxByName, runTag: `${runTag}-byname-min` }),
    },
    {
      label: "full + analytical + line items + supplierId",
      body: buildCreatePayload({ ...ctxById, runTag, customFieldAssociations: cfaFull }),
    },
    {
      label: "full + analytical + line items + supplierName",
      body: buildCreatePayload({ ...ctxByName, runTag: `${runTag}-byname-full`, customFieldAssociations: cfaFull }),
    },
    {
      label: "full + supplierId + items [] + CFA",
      body: { ...buildCreatePayload({ ...ctxById, runTag, customFieldAssociations: cfaFull }), items: [] },
    },
    {
      label: "full + supplierId + line items + CFA []",
      body: buildCreatePayload({ ...ctxById, runTag: `${runTag}-nocfa`, customFieldAssociations: [] }),
    },
  ];

  let last = { status: 0, ok: false, data: {} };
  let i = 0;
  for (const { label, body } of attempts) {
    if (i === 0 && process.env.PO_DEBUG === "1") {
      console.log("PO_DEBUG corps (1ère tentative):\n", JSON.stringify(body, null, 2));
    }
    i++;
    const res = await api("POST", "/v1/purchase-orders", token, { body });
    last = res;
    if (res.ok && extractPoId(res.data)) return { res, label };
    console.warn(`  ↳ échec (${res.status}) — ${label}`);
  }
  return { res: last, label: "all_attempts_failed" };
}

/** POST cancel/close : d’abord sans corps ; si 500, réessai avec `{}` (certains reverse-proxies). */
async function postPurchaseOrderAction(token, purchaseOrderId, action) {
  const path = `/v1/purchase-orders/${encodeURIComponent(purchaseOrderId)}/${action}`;
  let res = await api("POST", path, token, {});
  if (!res.ok && res.status >= 500) {
    const retry = await api("POST", path, token, { body: {} });
    if (retry.ok || retry.status < 500) res = retry;
  }
  return res;
}

/** Remplit customFieldAssociations à partir de l’API (souvent requis métier même si le tableau peut être vide dans le schéma). */
async function fetchCustomFieldAssociations(token) {
  const af = await api("GET", "/v1/analytical-fields", token, { query: { page: 1, pageSize: 30 } });
  const fields = firstList(af.data, ["data"]);
  const field = fields.find((f) => f && f.isArchived === false) ?? fields[0];
  if (!field?.id) return { associations: [], note: "Aucun analytical field — []" };

  const vals = await api("GET", `/v1/analytical-fields/${encodeURIComponent(field.id)}/values`, token, {
    query: { page: 1, pageSize: 30 },
  });
  const vrows = firstList(vals.data, ["data"]);
  const v = vrows[0];
  if (v?.id) {
    return {
      associations: [{ customFieldId: String(field.id), customFieldValueId: String(v.id) }],
      note: `field=${field.id} value=${v.id}`,
    };
  }
  return {
    associations: [{ customFieldId: String(field.id) }],
    note: `field=${field.id} sans valeur listée`,
  };
}

function firstList(payload, keys = ["data", "users", "costCenters", "suppliers"]) {
  if (!payload || typeof payload !== "object") return [];
  for (const k of keys) {
    const v = payload[k];
    if (Array.isArray(v) && v.length) return v;
  }
  if (Array.isArray(payload)) return payload;
  return [];
}

async function discoverContext(token) {
  let userId = process.env.PO_TEST_USER_ID?.trim() || null;
  let costCenterId = process.env.PO_TEST_COST_CENTER_ID?.trim() || null;
  let supplierId = process.env.PO_TEST_SUPPLIER_ID?.trim() || null;
  let supplierName = process.env.PO_TEST_SUPPLIER_NAME?.trim() ?? null;
  /** @type {"env"|"existing_po"|"users_list"|null} */
  let userIdSource = userId ? "env" : null;

  /**
   * Alignement Postman / prod : le 1er `GET /v1/users` n’est pas toujours un « requester » PO valide.
   * On complète userId / costCenter / supplier depuis le détail d’un PO existant quand les vars d’env sont absentes.
   */
  const needPoSnapshot = !userId || !costCenterId || !supplierId;
  if (needPoSnapshot) {
    const pol = await api("GET", "/v1/purchase-orders", token, { query: { page: 1, pageSize: 1 } });
    if (pol.ok) {
      const poRows = firstList(pol.data, ["data", "purchaseOrders"]);
      const pid = poRows[0]?.id ?? poRows[0]?.purchaseOrderId;
      if (pid) {
        const det = await api("GET", `/v1/purchase-orders/${encodeURIComponent(String(pid))}`, token, {
          query: { withItems: "false" },
        });
        if (det.ok) {
          const pd = poData(det.data);
          if (!userId && pd?.requesterId) {
            userId = String(pd.requesterId);
            userIdSource = "existing_po";
          }
          if (!costCenterId && pd?.costCenterId) costCenterId = String(pd.costCenterId);
          if (!supplierId && pd?.supplierId) supplierId = String(pd.supplierId);
        }
      }
    }
  }

  if (!userId) {
    const u = await api("GET", "/v1/users", token, { query: { page: 1, per_page: 30 } });
    const rows = firstList(u.data, ["data", "users"]);
    userId = rows[0]?.id ? String(rows[0].id) : null;
    if (userId) userIdSource = "users_list";
  }
  if (!costCenterId) {
    const c = await api("GET", "/v1/cost-centers", token, { query: { page: 1, per_page: 30 } });
    const rows = firstList(c.data, ["data", "costCenters"]);
    costCenterId = rows[0]?.id ? String(rows[0].id) : null;
  }
  if (!supplierId || !supplierName) {
    const s = await api("GET", "/v1/suppliers", token, {
      query: { page: 1, pageSize: 30, isArchived: false },
    });
    const rows = firstList(s.data, ["data", "suppliers"]);
    if (!supplierId && rows[0]?.id) supplierId = String(rows[0].id);
    if (!supplierName && rows[0]?.name) supplierName = String(rows[0].name);
  }

  return {
    userId,
    costCenterId,
    supplierId,
    supplierName,
    userIdSource,
    gaps: { userId: !userId, costCenterId: !costCenterId, supplierId: !supplierId && !supplierName },
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const runTag = tag();
  /** @type {Array<{ step: string, method: string, path: string, status: number, ok: boolean, note?: string, bodySample?: unknown }>} */
  const steps = [];

  console.log("Base URL:", baseUrl);
  const token = await getToken();
  console.log("✓ Token OK\n");

  const ctx = await discoverContext(token);
  console.log("Contexte (user / cost center / supplier):", ctx);
  if (ctx.userIdSource) console.log("userId source:", ctx.userIdSource, "(existing_po = requesterId d’un PO liste page 1)");
  if (ctx.gaps.userId || ctx.gaps.costCenterId || ctx.gaps.supplierId) {
    console.error("Contexte incomplet — définir PO_TEST_* ou vérifier les données Spendesk.");
  }

  // 1) List
  const list = await api("GET", "/v1/purchase-orders", token, { query: { page: 1, pageSize: 30 } });
  const listRows = firstList(list.data, ["data", "purchaseOrders"]);
  steps.push({
    step: "list_purchase_orders",
    method: "GET",
    path: "/v1/purchase-orders?page=1&pageSize=30",
    status: list.status,
    ok: list.ok,
    note: list.ok ? `OK, ${listRows.length} PO(s) sur la page` : JSON.stringify(list.data).slice(0, 400),
  });
  console.log("1. GET /v1/purchase-orders →", list.status, list.ok ? `OK (${listRows.length} sur page)` : "FAIL");

  const skipMutations = process.env.PO_TEST_SKIP_MUTATIONS === "1";
  if (list.ok && listRows.length > 0) {
    const sampleId = String(listRows[0].id ?? listRows[0].purchaseOrderId ?? "");
    if (sampleId) {
      const g0 = await api("GET", `/v1/purchase-orders/${encodeURIComponent(sampleId)}`, token, {
        query: { withItems: "false" },
      });
      steps.push({
        step: "get_purchase_order_existing_sample",
        method: "GET",
        path: `/v1/purchase-orders/${sampleId}`,
        status: g0.status,
        ok: g0.ok,
        note: g0.ok ? `status=${poData(g0.data)?.status}` : JSON.stringify(g0.data).slice(0, 400),
      });
      console.log("1b. GET PO existant (échantillon liste) →", g0.status, g0.ok ? poData(g0.data)?.status : "");
    }
  }

  let createOk = false;
  let idCancel = null;
  let idClose = null;

  if (skipMutations) {
    steps.push({
      step: "mutations_skipped",
      method: "-",
      path: "-",
      status: 0,
      ok: true,
      note: "PO_TEST_SKIP_MUTATIONS=1",
    });
    const reportPath = join(dirname(fileURLToPath(import.meta.url)), "..", "purchase-orders-api-test-report.json");
    writeFileSync(
      reportPath,
      JSON.stringify({ summary: { startedAt, baseUrl, listOk: list.ok, skipMutations: true }, steps }, null, 2),
      "utf8"
    );
    console.log("\nRapport:", reportPath);
    process.exit(list.ok ? 0 : 2);
  }

  if (!ctx.userId || !ctx.costCenterId || (!ctx.supplierId && !ctx.supplierName)) {
    steps.push({
      step: "create_skipped",
      method: "POST",
      path: "/v1/purchase-orders",
      status: 0,
      ok: false,
      note: "Création ignorée — userId, costCenterId ou supplierId/supplierName manquant",
    });
  } else {
    const { associations: cfa, note: cfaNote } = await fetchCustomFieldAssociations(token);
    console.log("customFieldAssociations (discovery):", cfaNote);

    const { res: createA, label: createALabel } = await createPurchaseOrderWithRetries(
      token,
      ctx,
      cfa,
      `${runTag}-A`
    );
    idCancel = extractPoId(createA.data);
    createOk = createA.ok && !!idCancel;
    steps.push({
      step: "create_purchase_order_A",
      method: "POST",
      path: "/v1/purchase-orders",
      status: createA.status,
      ok: createA.ok,
      note: idCancel ? `id=${idCancel} stratégie=${createALabel}` : JSON.stringify(createA.data).slice(0, 600),
    });
    console.log("2a. POST create PO_A →", createA.status, idCancel ?? "no id", createOk ? `(${createALabel})` : "");

    const envCancelId = process.env.PO_TEST_CANCEL_PO_ID?.trim();
    const envCloseId = process.env.PO_TEST_CLOSE_PO_ID?.trim();
    if (!idCancel && envCancelId) {
      idCancel = envCancelId;
      steps.push({
        step: "cancel_po_id_from_env",
        method: "-",
        path: "-",
        status: 0,
        ok: true,
        note: `Utilisation PO_TEST_CANCEL_PO_ID=${envCancelId}`,
      });
    }

    if (idCancel) {
      const getA1 = await api("GET", `/v1/purchase-orders/${encodeURIComponent(idCancel)}`, token, {
        query: { withItems: "false" },
      });
      const d1 = poData(getA1.data);
      steps.push({
        step: "get_purchase_order_before_cancel",
        method: "GET",
        path: `/v1/purchase-orders/${idCancel}`,
        status: getA1.status,
        ok: getA1.ok,
        note: getA1.ok ? `status=${d1?.status}` : JSON.stringify(getA1.data).slice(0, 400),
      });
      console.log("3a. GET PO (avant cancel) →", getA1.status, getA1.ok ? d1?.status : "FAIL");

      const cancel = await postPurchaseOrderAction(token, idCancel, "cancel");
      const co = cancel.data?.data;
      steps.push({
        step: "cancel_purchase_order",
        method: "POST",
        path: `/v1/purchase-orders/${idCancel}/cancel`,
        status: cancel.status,
        ok: cancel.ok,
        note: JSON.stringify(co ?? cancel.data).slice(0, 400),
      });
      console.log("4a. POST cancel →", cancel.status, cancel.ok ? JSON.stringify(co) : "");

      const getA2 = await api("GET", `/v1/purchase-orders/${encodeURIComponent(idCancel)}`, token, {
        query: { withItems: "false" },
      });
      const d2 = poData(getA2.data);
      steps.push({
        step: "get_purchase_order_after_cancel",
        method: "GET",
        path: `/v1/purchase-orders/${idCancel}`,
        status: getA2.status,
        ok: getA2.ok,
        note: getA2.ok ? `status=${d2?.status}` : JSON.stringify(getA2.data).slice(0, 400),
      });
      console.log("5a. GET PO après cancel →", getA2.status, getA2.ok ? d2?.status : "");
    }

    if (!idClose && envCloseId) {
      idClose = envCloseId;
      steps.push({
        step: "close_po_id_from_env",
        method: "-",
        path: "-",
        status: 0,
        ok: true,
        note: `Utilisation PO_TEST_CLOSE_PO_ID=${envCloseId}`,
      });
    }

    if (!idClose) {
      const { res: createB, label: createBLabel } = await createPurchaseOrderWithRetries(
        token,
        ctx,
        cfa,
        `${runTag}-B`
      );
      idClose = extractPoId(createB.data);
      steps.push({
        step: "create_purchase_order_B",
        method: "POST",
        path: "/v1/purchase-orders",
        status: createB.status,
        ok: createB.ok,
        note: idClose ? `id=${idClose} stratégie=${createBLabel}` : JSON.stringify(createB.data).slice(0, 600),
      });
      console.log("2b. POST create PO_B →", createB.status, idClose ?? "no id");
    }

    if (idClose) {
      const getB1 = await api("GET", `/v1/purchase-orders/${encodeURIComponent(idClose)}`, token, {
        query: { withItems: "false" },
      });
      steps.push({
        step: "get_purchase_order_B_before_close",
        method: "GET",
        path: `/v1/purchase-orders/${idClose}`,
        status: getB1.status,
        ok: getB1.ok,
        note: getB1.ok ? `status=${poData(getB1.data)?.status}` : JSON.stringify(getB1.data).slice(0, 400),
      });

      const close = await postPurchaseOrderAction(token, idClose, "close");
      const clo = close.data?.data;
      steps.push({
        step: "close_purchase_order_B",
        method: "POST",
        path: `/v1/purchase-orders/${idClose}/close`,
        status: close.status,
        ok: close.ok,
        note: JSON.stringify(clo ?? close.data).slice(0, 400),
      });
      console.log("4b. POST close →", close.status, close.ok ? JSON.stringify(clo) : "");

      const getB2 = await api("GET", `/v1/purchase-orders/${encodeURIComponent(idClose)}`, token, {
        query: { withItems: "false" },
      });
      steps.push({
        step: "get_purchase_order_B_after_close",
        method: "GET",
        path: `/v1/purchase-orders/${idClose}`,
        status: getB2.status,
        ok: getB2.ok,
        note: getB2.ok ? `status=${poData(getB2.data)?.status}` : JSON.stringify(getB2.data).slice(0, 400),
      });
      console.log("5b. GET PO_B after close →", getB2.status, getB2.ok ? poData(getB2.data)?.status : "");
    }
  }

  const openSamples = listRows
    .filter((r) => String(r.status ?? "").toLowerCase() === "open")
    .slice(0, 5)
    .map((r) => ({ id: r.id, status: r.status, purchaseOrderNumber: r.purchaseOrderNumber }));

  const summary = {
    startedAt,
    baseUrl,
    listOk: steps.find((s) => s.step === "list_purchase_orders")?.ok ?? false,
    createOk,
    cancelFlowOk: steps.some((s) => s.step === "cancel_purchase_order" && s.ok),
    closeFlowOk: steps.some((s) => s.step === "close_purchase_order_B" && s.ok),
    ids: { cancelledPoId: idCancel, closedPoId: idClose },
    context: ctx,
    openPurchaseOrdersSample: openSamples,
    hints: {
      invoiceRules:
        "Annulation: seulement si aucune facture n’est liée au PO. Clôture: seulement si toutes les factures liées sont payées — un PO « open » sans facture échouera souvent au close.",
      cancelCloseEnv:
        "Pour tester sans POST create (si 500): PO_TEST_CANCEL_PO_ID = PO sans facture liée ; PO_TEST_CLOSE_PO_ID = PO éligible à la clôture (ex. toutes factures payées). Voir openPurchaseOrdersSample pour des open.",
      baseUrl:
        "Utiliser le même host que Postman : SPENDESK_BASE_URL (sinon démo → beta-sandbox trunk). Si Postman obtient 201 et le script 500 sur le même POST, comparer le corps brut (PO_DEBUG=1) et les IDs (userId / cost center / supplier).",
      trunkMutations:
        "Sur beta-sandbox trunk, les POST create/cancel/close peuvent tous renvoyer 500 INTERNAL_SERVER_ERROR malgré un corps valide — à valider avec Spendesk ou sur public-api.spendesk.com / public-api.demo.spendesk.com selon tes clés.",
    },
  };

  const reportPath = join(dirname(fileURLToPath(import.meta.url)), "..", "purchase-orders-api-test-report.json");
  writeFileSync(reportPath, JSON.stringify({ summary, steps }, null, 2), "utf8");
  console.log("\nRapport:", reportPath);

  let exitCode = 0;
  if (!summary.listOk) exitCode = 2;
  else if (listRows.length > 0) {
    const sample = steps.find((s) => s.step === "get_purchase_order_existing_sample");
    if (sample && !sample.ok) exitCode = 2;
  }

  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
