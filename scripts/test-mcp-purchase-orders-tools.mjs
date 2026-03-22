#!/usr/bin/env node
/**
 * E2E MCP (stdio): outils Purchase Order — création, lecture (get), annulation (cancel), clôture (close).
 *
 * L’API publique Spendesk documentée dans ce dépôt n’expose pas de PATCH « édition » de PO → pas de test « edition ».
 *
 * Règles Spendesk: cancel = OK seulement si aucune facture liée au PO ; close = OK seulement si toutes les factures liées sont payées.
 *   Les PO « open » sans facture conviennent pour cancel ; pour close il faut un PO dont toutes les factures sont payées.
 *
 * Prérequis: .env avec client credentials et scopes experimental:purchase-order:read + experimental:purchase-order:write.
 * Surcharges (comme scripts/test-purchase-orders-api.mjs):
 *   PO_TEST_USER_ID, PO_TEST_COST_CENTER_ID, PO_TEST_SUPPLIER_ID, PO_TEST_SUPPLIER_NAME
 *   PO_TEST_CANCEL_PO_ID, PO_TEST_CLOSE_PO_ID — deux OP **ouverts** si la création échoue
 *   PO_MCP_PO_TOOLS_ONLY=1 — skip création; exécute get + cancel + close sur PO_TEST_CANCEL_PO_ID / PO_TEST_CLOSE_PO_ID uniquement
 *
 * Usage: npm run test:mcp-po
 *        node -r dotenv/config scripts/test-mcp-purchase-orders-tools.mjs
 */
import { spawn } from "node:child_process";

const demoId = process.env.SPENDESK_CLIENT_ID_DEMO;
const demoSecret = process.env.SPENDESK_CLIENT_SECRET_DEMO;
const prodId = process.env.SPENDESK_CLIENT_ID;
const prodSecret = process.env.SPENDESK_CLIENT_SECRET;
if ((!demoId || !demoSecret) && (!prodId || !prodSecret)) {
  console.error("Set SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET (or _DEMO pair).");
  process.exit(1);
}

const useDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
const toolsOnly = process.env.PO_MCP_PO_TOOLS_ONLY === "1";

function tag() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function firstArray(obj, keys) {
  if (!obj || typeof obj !== "object") return [];
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v) && v.length) return v;
  }
  return [];
}

function parseToolResult(result) {
  const block = result?.content?.find((c) => c.type === "text");
  if (!block?.text) return { text: null, json: null };
  try {
    return { text: block.text, json: JSON.parse(block.text) };
  } catch {
    return { text: block.text, json: null };
  }
}

function extractCreatePoId(json) {
  if (!json || typeof json !== "object") return null;
  const d = json.data;
  if (d && typeof d === "object") {
    if (d.id != null) return String(d.id);
    if (d.data && typeof d.data === "object" && d.data.id != null) return String(d.data.id);
  }
  if (json.id != null) return String(json.id);
  return null;
}

function buildMinimalPayload({ userId, costCenterId, supplierId, supplierName, runTag, customFieldAssociations }) {
  const money = (cents) => ({ amount: cents, currency: "EUR", precision: 2 });
  const base = {
    userId,
    amount: money(50_000),
    netAmount: money(50_000),
    costCenterId,
    startDate: "2026-04-01T10:00:00.000Z",
    endDate: "2026-12-31T18:00:00.000Z",
    customFieldAssociations: Array.isArray(customFieldAssociations) ? customFieldAssociations : [],
    description: `MCP PO test ${runTag}`.slice(0, 250),
    items: [],
    deliveryNotesExpected: false,
  };
  if (supplierName && String(supplierName).trim()) base.supplierName = String(supplierName).trim();
  else if (supplierId) base.supplierId = supplierId;
  return base;
}

async function runMcpSession() {
  const server = spawn("node", ["dist/index.js"], {
    env: {
      ...process.env,
      SPENDESK_API_TOKEN: "",
      SPENDESK_REFRESH_TOKEN: "",
    },
    stdio: ["pipe", "pipe", "inherit"],
  });

  let buffer = "";
  let nextId = 1;
  const pending = new Map();

  function send(obj) {
    server.stdin.write(JSON.stringify(obj) + "\n");
  }

  function rpc(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  function handleMessage(msg) {
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else {
        const r = msg.result;
        // SDK: tool exceptions become { content, isError: true } (not jsonrpc error)
        if (r?.isError) {
          const text = r.content?.find((c) => c.type === "text")?.text || "Tool error";
          reject(new Error(text));
        } else resolve(r);
      }
    }
  }

  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleMessage(JSON.parse(line));
      } catch {
        /* ignore */
      }
    }
  });

  const fail = (err) => {
    server.kill();
    throw err;
  };

  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-mcp-po", version: "1.0.0" },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    const runTag = tag();
    let userId = process.env.PO_TEST_USER_ID?.trim() || null;
    let costCenterId = process.env.PO_TEST_COST_CENTER_ID?.trim() || null;
    let supplierId = process.env.PO_TEST_SUPPLIER_ID?.trim() || null;
    let supplierName = process.env.PO_TEST_SUPPLIER_NAME?.trim() || null;

    if (toolsOnly) {
      const cancelId = process.env.PO_TEST_CANCEL_PO_ID?.trim();
      const closeId = process.env.PO_TEST_CLOSE_PO_ID?.trim();
      if (!cancelId || !closeId) {
        fail(new Error("PO_MCP_PO_TOOLS_ONLY=1 requires PO_TEST_CANCEL_PO_ID and PO_TEST_CLOSE_PO_ID"));
      }
      console.log("→ spendesk_get_purchase_order (cancel target)", cancelId);
      let r = await rpc("tools/call", {
        name: "spendesk_get_purchase_order",
        arguments: { purchaseOrderId: cancelId, withItems: false },
      });
      console.log("✓ get (cancel target) —", parseToolResult(r).json?.status ?? "ok");

      let cancelOk = false;
      let closeOk = false;

      console.log("→ spendesk_cancel_purchase_order", cancelId);
      try {
        r = await rpc("tools/call", {
          name: "spendesk_cancel_purchase_order",
          arguments: { purchaseOrderId: cancelId, withItems: false },
        });
        console.log("✓ cancel —", parseToolResult(r).text?.slice(0, 120) ?? "ok");
        cancelOk = true;
      } catch (e) {
        console.error("✗ cancel —", e.message?.slice(0, 280));
      }

      console.log("→ spendesk_get_purchase_order (close target)", closeId);
      r = await rpc("tools/call", {
        name: "spendesk_get_purchase_order",
        arguments: { purchaseOrderId: closeId, withItems: false },
      });
      console.log("✓ get (close target) —", parseToolResult(r).json?.status ?? "ok");

      console.log("→ spendesk_close_purchase_order", closeId);
      try {
        r = await rpc("tools/call", {
          name: "spendesk_close_purchase_order",
          arguments: { purchaseOrderId: closeId, withItems: false },
        });
        console.log("✓ close —", parseToolResult(r).text?.slice(0, 120) ?? "ok");
        closeOk = true;
      } catch (e) {
        console.error("✗ close —", e.message?.slice(0, 280));
      }

      server.kill();
      if (!cancelOk || !closeOk) {
        console.log(
          "\n⚠ Les deux outils ont bien été invoqués via MCP. Si cancel/close échouent avec 500, c’est souvent la sandbox trunk ; vérifie aussi les règles métier (factures liées)."
        );
        process.exit(1);
      }
      return;
    }

    if (!userId || !costCenterId || (!supplierId && !supplierName)) {
      console.log("→ spendesk_get_users (discovery)");
      const ur = await rpc("tools/call", {
        name: "spendesk_get_users",
        arguments: { page: 1, perPage: 20 },
      });
      const uj = parseToolResult(ur).json;
      const urows = firstArray(uj, ["users", "data"]);
      if (!userId && urows[0]?.id) userId = String(urows[0].id);

      console.log("→ spendesk_get_cost_centers (discovery)");
      const cr = await rpc("tools/call", {
        name: "spendesk_get_cost_centers",
        arguments: { page: 1, perPage: 20 },
      });
      const cj = parseToolResult(cr).json;
      const crows = firstArray(cj, ["costCenters", "data"]);
      if (!costCenterId && crows[0]?.id) costCenterId = String(crows[0].id);

      console.log("→ spendesk_get_suppliers (discovery)");
      const sr = await rpc("tools/call", {
        name: "spendesk_get_suppliers",
        arguments: { page: 1, perPage: 15, supplierFilters: { isArchived: false } },
      });
      const sj = parseToolResult(sr).json;
      const srows = firstArray(sj, ["suppliers", "data"]);
      if (!supplierId && srows[0]?.id) supplierId = String(srows[0].id);
      if (!supplierName && srows[0]?.name) supplierName = String(srows[0].name);
    }

    if (!userId || !costCenterId || (!supplierId && !supplierName)) {
      fail(
        new Error(
          "Contexte incomplet (userId, costCenterId, supplier). Définis PO_TEST_* ou vérifie les données Spendesk."
        )
      );
    }

    let cfa = [];
    try {
      console.log("→ spendesk_get_analytical_fields");
      const af = await rpc("tools/call", { name: "spendesk_get_analytical_fields", arguments: {} });
      const afj = parseToolResult(af).json;
      const fields = firstArray(afj, ["data"]);
      const field = fields.find((f) => f && f.isArchived === false) ?? fields[0];
      if (field?.id) {
        console.log("→ spendesk_get_analytical_values");
        const vr = await rpc("tools/call", {
          name: "spendesk_get_analytical_values",
          arguments: { fieldId: String(field.id), page: 1, perPage: 10 },
        });
        const vj = parseToolResult(vr).json;
        const vals = firstArray(vj, ["data"]);
        const v = vals[0];
        if (v?.id) cfa = [{ customFieldId: String(field.id), customFieldValueId: String(v.id) }];
      }
    } catch (e) {
      console.warn("  (analytical fields skip)", e.message);
    }

    const ctxById = { userId, costCenterId, supplierId, supplierName: null };
    const ctxByName = { userId, costCenterId, supplierId: null, supplierName };
    const attempts = [
      { label: "minimal+supplierId", ctx: ctxById },
      { label: "minimal+supplierName", ctx: ctxByName },
    ];

    let idCancel = null;
    for (const { label, ctx } of attempts) {
      const payload = buildMinimalPayload({ ...ctx, runTag: `${runTag}-A`, customFieldAssociations: cfa });
      console.log("→ spendesk_create_purchase_order (" + label + ")");
      try {
        const cr = await rpc("tools/call", {
          name: "spendesk_create_purchase_order",
          arguments: { payload },
        });
        const cj = parseToolResult(cr).json;
        idCancel = extractCreatePoId(cj);
        if (idCancel) {
          console.log("✓ create PO_A —", idCancel, "(" + label + ")");
          break;
        }
        console.warn("  ↳ pas d'id dans la réponse:", cr?.content?.[0]?.text?.slice(0, 200));
      } catch (e) {
        console.warn("  ↳ échec create (" + label + "):", e.message?.slice(0, 220));
      }
    }

    const envCancel = process.env.PO_TEST_CANCEL_PO_ID?.trim();
    const envClose = process.env.PO_TEST_CLOSE_PO_ID?.trim();
    if (!idCancel && envCancel) idCancel = envCancel;

    if (!idCancel) {
      fail(new Error("Création PO échouée — définis PO_TEST_CANCEL_PO_ID / PO_TEST_CLOSE_PO_ID ou compare avec scripts/test-purchase-orders-api.mjs"));
    }

    console.log("→ spendesk_get_purchase_order (PO_A)", idCancel);
    let gr = await rpc("tools/call", {
      name: "spendesk_get_purchase_order",
      arguments: { purchaseOrderId: idCancel, withItems: false },
    });
    console.log("✓ get PO_A — status", parseToolResult(gr).json?.status);

    console.log("→ spendesk_cancel_purchase_order", idCancel);
    await rpc("tools/call", {
      name: "spendesk_cancel_purchase_order",
      arguments: { purchaseOrderId: idCancel, withItems: false },
    });
    console.log("✓ cancel PO_A");

    let idClose = envClose || null;
    if (!idClose) {
      for (const { label, ctx } of attempts) {
        const payload = buildMinimalPayload({ ...ctx, runTag: `${runTag}-B`, customFieldAssociations: cfa });
        console.log("→ spendesk_create_purchase_order PO_B (" + label + ")");
        try {
          const cr = await rpc("tools/call", {
            name: "spendesk_create_purchase_order",
            arguments: { payload },
          });
          idClose = extractCreatePoId(parseToolResult(cr).json);
          if (idClose) {
            console.log("✓ create PO_B —", idClose);
            break;
          }
        } catch (e) {
          console.warn("  ↳ échec create B:", e.message);
        }
      }
    }

    if (!idClose) {
      fail(new Error("Pas de PO_B pour close — définis PO_TEST_CLOSE_PO_ID"));
    }

    console.log("→ spendesk_close_purchase_order", idClose);
    await rpc("tools/call", {
      name: "spendesk_close_purchase_order",
      arguments: { purchaseOrderId: idClose, withItems: false },
    });
    console.log("✓ close PO_B");

    server.kill();
  } catch (e) {
    server.kill();
    throw e;
  }
}

console.log("MCP PO tools test — demo=", useDemo);
console.log("(Édition PO: non couverte — pas d’endpoint PATCH documenté dans ce dépôt.)\n");

await runMcpSession();
console.log("\n✓ MCP purchase order tools test passed.");
