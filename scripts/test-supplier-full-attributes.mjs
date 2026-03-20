#!/usr/bin/env node
/**
 * Test création + PATCH fournisseur avec tous les champs documentés (OpenAPI supplierToCreate / supplierToUpdateSingle).
 * Compare GET /v1/suppliers/:id avec les valeurs attendues et rapporte les écarts (noms API lecture vs écriture).
 *
 * Prérequis : .env comme scripts/demo-supplier-lifecycle.mjs (+ supplier:read + experimental:supplier:manage).
 *
 * Usage: node scripts/test-supplier-full-attributes.mjs
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
  console.error("Credentials manquants (client_id + client_secret / demo).");
  process.exit(1);
}

/** @param {string} a @param {string|undefined|null} b */
function normStr(a, b) {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  return { ok: x === y, expected: x, got: y };
}

/** Comparaison insensible à la casse (ex. SIRET normalisé en majuscules côté API). */
function normStrCi(a, b) {
  const x = String(a ?? "").trim().toUpperCase();
  const y = String(b ?? "").trim().toUpperCase();
  return { ok: x === y, expected: x, got: y };
}

/** IBAN de test valide (LU) + BIC cohérent pour éviter rejets de format sur sandbox */
const TEST_IBAN_CREATE = "LU280019400644750000";
const TEST_BIC_CREATE = "BCEELULL";
const TEST_IBAN_PATCH = "LU540019400644785000";
const TEST_BIC_PATCH = "BCEELULL";

function tag() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function vatFr() {
  return `FR${String(Math.floor(1e10 + Math.random() * 9e10)).slice(0, 11)}`;
}

/**
 * Tous les champs autorisés par l’OpenAPI `supplierToCreate` (pas d’additionalProperties).
 */
function buildFullCreateBody(runTag) {
  const vat = vatFr();
  return {
    name: `FullAttr Create ${runTag}`,
    primaryEmail: `full-attr-create-${runTag}@example.invalid`,
    supplierDetails: {
      legalName: `FullAttr Legal CREATE ${runTag}`,
      registrationNumber: `SIRET-CREATE-${runTag}`,
      vatNumber: vat,
      address: `12 rue Création\nBât. B`,
      city: "Créteil",
      zipcode: "94000",
      country: "FR",
    },
    bankInfo: {
      iban: TEST_IBAN_CREATE,
      bic: TEST_BIC_CREATE,
      bankCountry: "LU",
      accountNumber: "ACC-NUM-CREATE-001",
      routingNumber: "ROUTING-US-CREATE",
      sortCode: "12-34-56",
      accountHolderName: `Titulaire CREATE ${runTag}`,
    },
  };
}

/**
 * @param {boolean} changeIban Si true, utilise un nouvel IBAN (sur env trunk, PATCH changer l’IBAN → HTTP 500).
 */
function buildFullPatchBody(runTag, changeIban = false) {
  const vat = vatFr();
  const iban = changeIban ? TEST_IBAN_PATCH : TEST_IBAN_CREATE;
  const bic = changeIban ? TEST_BIC_PATCH : TEST_BIC_CREATE;
  return {
    name: `FullAttr PATCH ${runTag}`,
    primaryEmail: `full-attr-patch-${runTag}@example.invalid`,
    supplierDetails: {
      legalName: `FullAttr Legal PATCH ${runTag}`,
      registrationNumber: `SIRET-PATCH-${runTag}`,
      vatNumber: vat,
      address: `88 avenue Mise à jour`,
      city: "Lyon",
      zipcode: "69002",
      country: "FR",
    },
    // Sur trunk : `bankInfo.accountNumber` en PATCH → HTTP 500 (voir diagnosePatchFailure). Création peut l’accepter.
    // routingNumber / sortCode en PATCH → 500 dans nos tests (cohérence pays / format).
    bankInfo: {
      iban,
      bic,
      bankCountry: "LU",
      accountHolderName: `Titulaire PATCH ${runTag}`,
    },
  };
}

/**
 * Dérive ce qu’on attend sur GET à partir du corps create/patch (conventions doc Spendesk).
 * @param {ReturnType<typeof buildFullCreateBody>} sent
 */
function expectedFromPayload(sent) {
  return {
    name: sent.name,
    primaryEmail: sent.primaryEmail,
    legalName: sent.supplierDetails.legalName,
    registrationNo: sent.supplierDetails.registrationNumber,
    vatNo: sent.supplierDetails.vatNumber,
    addressLine1: sent.supplierDetails.address,
    addressCity: sent.supplierDetails.city,
    addressPostalCode: sent.supplierDetails.zipcode,
    addressCountry: sent.supplierDetails.country,
    iban: sent.bankInfo.iban,
    bic: sent.bankInfo.bic,
    bankCountry: sent.bankInfo.bankCountry,
    bankInfoIban: sent.bankInfo.iban,
    bankInfoBic: sent.bankInfo.bic,
    bankInfoBankCountry: sent.bankInfo.bankCountry,
    bankInfoAccountNumber: sent.bankInfo.accountNumber,
    bankInfoRoutingNumber: sent.bankInfo.routingNumber,
    bankInfoSortCode: sent.bankInfo.sortCode,
    bankInfoAccountHolderName: sent.bankInfo.accountHolderName,
  };
}

/**
 * @param {Record<string, string>} expected
 * @param {Record<string, unknown>} supplier
 */
function analyzeGetVsExpected(_label, expected, supplier) {
  /** @type {{ field: string, detail: string }[]} */
  const mismatches = [];
  /** @type {{ field: string, note: string }[]} */
  const notes = [];

  const addr = supplier.address && typeof supplier.address === "object" ? supplier.address : {};
  const bank = supplier.bankInfo && typeof supplier.bankInfo === "object" ? supplier.bankInfo : {};

  // primaryEmail : souvent absent du GET public alors qu’accepté en POST/PATCH
  const pe = supplier.primaryEmail;
  if ((pe === undefined || pe === null || String(pe).trim() === "") && expected.primaryEmail) {
    notes.push({
      field: "primaryEmail",
      note: "Fourni en create/patch mais non renvoyé (ou vide) sur GET — limite du modèle de lecture public.",
    });
  }

  const strChecks = [
    ["name", expected.name, supplier.name],
    ["legalName", expected.legalName, supplier.legalName],
    ["vatNo ← vatNumber", expected.vatNo, supplier.vatNo],
    ["address.line1 ← supplierDetails.address", expected.addressLine1, addr.line1],
    ["address.city ← supplierDetails.city", expected.addressCity, addr.city],
    ["address.postalCode ← supplierDetails.zipcode", expected.addressPostalCode, addr.postalCode],
    ["address.country ← supplierDetails.country", expected.addressCountry, addr.country],
    ["iban (racine, rétrocompat GET)", expected.iban, supplier.iban],
    ["bic (racine, rétrocompat GET)", expected.bic, supplier.bic],
    ["bankCountry (racine, rétrocompat GET)", expected.bankCountry, supplier.bankCountry],
  ];

  for (const [field, exp, got] of strChecks) {
    const { ok, expected: e, got: g } = normStr(exp, got);
    if (!ok) mismatches.push({ field, detail: `attendu="${e}" reçu="${g}"` });
  }

  {
    const { ok, expected: e, got: g } = normStrCi(expected.registrationNo, supplier.registrationNo);
    if (!ok) mismatches.push({ field: "registrationNo ← registrationNumber", detail: `attendu≈"${e}" reçu≈"${g}"` });
  }

  const rootIbanOk = normStr(expected.iban, supplier.iban).ok;
  const nestedBankFields = [
    ["bankInfo.iban", expected.bankInfoIban, bank.iban],
    ["bankInfo.bic", expected.bankInfoBic, bank.bic],
    ["bankInfo.bankCountry", expected.bankInfoBankCountry, bank.bankCountry],
    ["bankInfo.accountNumber", expected.bankInfoAccountNumber, bank.accountNumber],
    ["bankInfo.routingNumber", expected.bankInfoRoutingNumber, bank.routingNumber],
    ["bankInfo.sortCode", expected.bankInfoSortCode, bank.sortCode],
    ["bankInfo.accountHolderName", expected.bankInfoAccountHolderName, bank.accountHolderName],
  ];
  for (const [field, exp, got] of nestedBankFields) {
    const { ok, expected: e, got: g } = normStr(exp, got);
    if (!ok) {
      const coreNested =
        field === "bankInfo.iban" || field === "bankInfo.bic" || field === "bankInfo.bankCountry";
      if (rootIbanOk && coreNested) {
        notes.push({
          field,
          note: `Valeur côté POST/PATCH "${e}" ; objet bankInfo vide sur GET — voir iban/bic/bankCountry à la racine.`,
        });
      } else if (rootIbanOk && e !== "" && g === "") {
        notes.push({
          field,
          note: `Envoyé "${e}" mais absent de l’objet bankInfo en GET — persistance non vérifiable via cet endpoint ; iban racine présent.`,
        });
      } else {
        mismatches.push({ field, detail: `attendu="${e}" reçu="${g}"` });
      }
    }
  }

  if (rootIbanOk && (!bank || Object.keys(bank).length === 0)) {
    notes.push({
      field: "bankInfo",
      note: "L’API GET expose souvent la banque en iban/bic/bankCountry à la racine ; l’objet `bankInfo` peut être vide.",
    });
  }

  return { mismatches, notes, rawSnapshot: supplier };
}

/**
 * @param {string} id
 * @param {string} token
 * @param {Record<string, unknown>} body
 */
async function tryPatch(id, token, body) {
  const label = JSON.stringify(body).slice(0, 120);
  const res = await api("PATCH", `/v1/suppliers/${encodeURIComponent(id)}`, token, body);
  return { ...res, label };
}

/** @param {string} id @param {string} token @param {ReturnType<typeof buildFullCreateBody>["bankInfo"]} createBank */
async function diagnosePatchFailure(id, token, patchBody, createBank) {
  console.log("\n--- Diagnostic PATCH (incrémental) — le corps complet a échoué ---");
  const steps = [
    { label: "name seul", body: { name: patchBody.name } },
    { label: "primaryEmail seul", body: { primaryEmail: patchBody.primaryEmail } },
    { label: "supplierDetails seul", body: { supplierDetails: patchBody.supplierDetails } },
    {
      label: "bankInfo : même IBAN qu’à la création, seul accountHolderName change",
      body: {
        bankInfo: {
          iban: createBank.iban,
          bic: createBank.bic,
          bankCountry: createBank.bankCountry,
          accountHolderName: `Holder-only-patch ${Date.now()}`,
        },
      },
    },
    {
      label: "bankInfo minimal (nouvel IBAN + bic + bankCountry + accountHolderName)",
      body: {
        bankInfo: {
          iban: patchBody.bankInfo.iban,
          bic: patchBody.bankInfo.bic,
          bankCountry: patchBody.bankInfo.bankCountry,
          accountHolderName: patchBody.bankInfo.accountHolderName,
        },
      },
    },
    {
      label: "bankInfo + accountNumber",
      body: { bankInfo: { ...patchBody.bankInfo, accountNumber: patchBody.bankInfo.accountNumber } },
    },
    {
      label: "routingNumber seul (US) sur bankInfo",
      body: { bankInfo: { iban: patchBody.bankInfo.iban, bic: patchBody.bankInfo.bic, bankCountry: patchBody.bankInfo.bankCountry, routingNumber: "021000021" } },
    },
    {
      label: "sortCode seul (UK) sur bankInfo",
      body: { bankInfo: { iban: patchBody.bankInfo.iban, bic: patchBody.bankInfo.bic, bankCountry: patchBody.bankInfo.bankCountry, sortCode: "123456" } },
    },
  ];
  const results = [];
  for (const s of steps) {
    const r = await tryPatch(id, token, s.body);
    results.push({ step: s.label, status: r.status, ok: r.ok });
    console.log(r.ok ? "  ✓" : "  ✗", s.label, "→", r.status);
    if (!r.ok && r.data) console.log("    ", JSON.stringify(r.data).slice(0, 200));
  }
  return results;
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

async function api(method, path, token, body) {
  const max = 4;
  for (let attempt = 1; attempt <= max; attempt++) {
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
    if (res.status === 429 && attempt < max) {
      const wait = 8000 * attempt;
      console.warn(`429 rate limit — nouvel essai dans ${wait / 1000}s (${attempt}/${max})`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return { status: res.status, ok: res.ok, data };
  }
  return { status: 429, ok: false, data: { errors: [{ detail: "too many retries" }] } };
}

function extractCreatedId(data) {
  if (data?.item?.id) return data.item.id;
  const items = data?.items;
  if (!Array.isArray(items)) return null;
  for (const it of items) {
    if (it?.outcome === "created" && it?.supplier?.id) return it.supplier.id;
  }
  return null;
}

async function main() {
  const runTag = tag();
  console.log("Base URL:", baseUrl);
  const tokenManage = await getToken();

  const createBody = buildFullCreateBody(runTag);
  console.log("\n========== POST /v1/suppliers (corps complet OpenAPI) ==========");
  const post = await api("POST", "/v1/suppliers", tokenManage, [createBody]);
  console.log("HTTP:", post.status, post.ok ? "OK" : "FAIL");
  if (!post.ok) {
    console.error(JSON.stringify(post.data, null, 2));
    process.exit(1);
  }
  const id = extractCreatedId(post.data);
  if (!id) {
    console.error("Pas d’ID créé:", JSON.stringify(post.data, null, 2));
    process.exit(1);
  }
  console.log("Supplier ID:", id);

  // GET nécessite souvent un token avec supplier:read — même client credentials si scopes cumulés
  console.log("\n========== GET /v1/suppliers/:id (après création) ==========");
  const get1 = await api("GET", `/v1/suppliers/${encodeURIComponent(id)}`, tokenManage);
  console.log("HTTP:", get1.status, get1.ok ? "OK" : "FAIL");
  if (!get1.ok) {
    console.error(JSON.stringify(get1.data, null, 2));
    process.exit(1);
  }
  const supplier1 = get1.data;
  const exp1 = expectedFromPayload(createBody);
  const report1 = analyzeGetVsExpected("after_create", exp1, supplier1);

  console.log("\n--- Écarts création vs GET ---");
  if (report1.mismatches.length === 0) console.log("✓ Aucun écart sur les champs comparés.");
  else report1.mismatches.forEach((m) => console.log("✗", m.field, "—", m.detail));
  report1.notes.forEach((n) => console.log("ℹ️", n.field, "—", n.note));

  const tryChangeIban = process.env.FULL_SUPPLIER_TEST_CHANGE_IBAN_PATCH === "1";
  const patchBody = buildFullPatchBody(runTag, tryChangeIban);
  if (!tryChangeIban) {
    console.log(
      "\nℹ️  PATCH : IBAN identique à la création par défaut. `FULL_SUPPLIER_TEST_CHANGE_IBAN_PATCH=1` pour tester changement d’IBAN. Sur trunk, `bankInfo.accountNumber` en PATCH → souvent HTTP 500 (hors de ce scénario)."
    );
  }
  console.log("\n========== PATCH /v1/suppliers/:id (champs OpenAPI ; IBAN inchangé sauf env ci-dessus) ==========");
  let patch = await api("PATCH", `/v1/suppliers/${encodeURIComponent(id)}`, tokenManage, patchBody);
  console.log("HTTP:", patch.status, patch.ok ? "OK" : "FAIL");
  let patchDiag = [];
  if (!patch.ok) {
    console.error(JSON.stringify(patch.data, null, 2));
    patchDiag = await diagnosePatchFailure(id, tokenManage, patchBody, createBody.bankInfo);
  }

  let supplier2 = supplier1;
  let report2 = { mismatches: [], notes: [], rawSnapshot: {} };

  if (patch.ok) {
    console.log("\n========== GET /v1/suppliers/:id (après PATCH) ==========");
    const get2 = await api("GET", `/v1/suppliers/${encodeURIComponent(id)}`, tokenManage);
    console.log("HTTP:", get2.status, get2.ok ? "OK" : "FAIL");
    if (!get2.ok) {
      console.error(JSON.stringify(get2.data, null, 2));
    } else {
      supplier2 = get2.data;
      const exp2 = expectedFromPayload(patchBody);
      report2 = analyzeGetVsExpected("after_patch", exp2, supplier2);
      console.log("\n--- Écarts PATCH vs GET ---");
      if (report2.mismatches.length === 0) console.log("✓ Aucun écart sur les champs comparés.");
      else report2.mismatches.forEach((m) => console.log("✗", m.field, "—", m.detail));
      report2.notes.forEach((n) => console.log("ℹ️", n.field, "—", n.note));
    }
  } else {
    console.log("\n(GET après PATCH ignoré : PATCH en échec)");
  }

  const criticalCreate = report1.mismatches.filter((m) => !m.field.startsWith("bankInfo."));
  const criticalPatch = report2.mismatches.filter((m) => !m.field.startsWith("bankInfo."));

  const out = {
    baseUrl,
    supplierId: id,
    runTag,
    openapiFieldsCovered: {
      create: Object.keys(createBody).concat(["supplierDetails.*", "bankInfo.*"]),
      patch: Object.keys(patchBody).concat(["supplierDetails.*", "bankInfo.* (sans routing/sortCode sur patch plein)"]),
    },
    afterCreate: {
      mismatches: report1.mismatches,
      notes: report1.notes,
      responseSample: supplier1,
    },
    afterPatch: patch.ok
      ? {
          mismatches: report2.mismatches,
          notes: report2.notes,
          responseSample: supplier2,
        }
      : { skipped: true, reason: "PATCH failed", patchError: patch.data, patchDiagnosticSteps: patchDiag },
    analysis: {
      primaryEmail:
        "Souvent non renvoyé par GET /v1/suppliers/:id malgré POST/PATCH — ne pas s’en servir pour valider la persistance via GET seul.",
      registrationNo:
        "Numéro d’enregistrement : envoi `supplierDetails.registrationNumber`, lecture `registrationNo` ; normalisation casse possible (majuscules).",
      bank:
        "Banque : lecture souvent via `iban` / `bic` / `bankCountry` à la racine ; objet `bankInfo` souvent vide dans la réponse GET.",
      patchTrunkNote:
        "Trunk sandbox (2026-03) : PATCH `bankInfo.accountNumber` → HTTP 500. PATCH `routingNumber` / `sortCode` → 500. Changer d’IBAN seul peut marcher si le corps ne contient pas d’autres champs problématiques. name / primaryEmail / supplierDetails → 200.",
    },
    summary: [
      patch.ok ? "PATCH OK." : "PATCH KO — voir patchError et patchDiagnosticSteps.",
      criticalCreate.length === 0 ? "Création : pas d’écart critique (hors bankInfo imbriqué)." : `${criticalCreate.length} écart(s) critique(s) après création.`,
      patch.ok && criticalPatch.length === 0
        ? "Patch : pas d’écart critique."
        : patch.ok
          ? `${criticalPatch.length} écart(s) critique(s) après patch.`
          : "",
    ]
      .filter(Boolean)
      .join(" "),
  };

  const reportPath = join(dirname(fileURLToPath(import.meta.url)), "..", "supplier-full-attributes-report.json");
  writeFileSync(reportPath, JSON.stringify(out, null, 2), "utf8");
  console.log("\nRapport JSON:", reportPath);
  console.log("\n========== Synthèse ==========");
  console.log(out.summary);

  const arch = await api(
    "PATCH",
    `/v1/experimental/suppliers/${encodeURIComponent(id)}/status`,
    tokenManage,
    { isArchived: true }
  );
  console.log("\nArchivage test supplier:", arch.status, arch.ok ? "OK" : "SKIP/KO");

  const exitBad = !patch.ok || criticalCreate.length > 0 || (patch.ok && criticalPatch.length > 0);
  process.exit(exitBad ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
