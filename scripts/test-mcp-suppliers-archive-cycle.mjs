#!/usr/bin/env node
/**
 * E2E MCP (stdio) : même flux que test-suppliers-archive-cycle.mjs mais uniquement via outils MCP.
 *
 * 1) tools/call spendesk_get_suppliers — supplierFilters.isArchived=false (toutes les pages côté serveur)
 * 2) Tri client par createdAt décroissant → N premiers (défaut 10)
 * 3) spendesk_set_supplier_archive_status isArchived: true pour chacun
 * 4) spendesk_get_supplier pour vérifier isArchived
 * 5) Pause (rate limit)
 * 6) spendesk_set_supplier_archive_status isArchived: false
 * 7) spendesk_get_supplier — isArchived false
 *
 * En cas d’erreur après des archives réussies, rollback désarchive sur les IDs déjà archivés.
 *
 * Env :
 *   SUPPLIER_MCP_ARCHIVE_COUNT (défaut 10)
 *   SUPPLIER_MCP_ARCHIVE_PATCH_DELAY_MS (défaut 800)
 *   SUPPLIER_MCP_ARCHIVE_PAUSE_MS avant désarchive (défaut max(5000, 3*delay))
 *   SUPPLIER_MCP_ARCHIVE_DRY_RUN=1 — liste + sélection seulement (pas de PATCH)
 *
 * Usage : npm run test:mcp-suppliers-archive-cycle
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

const COUNT = Math.min(30, Math.max(1, Number(process.env.SUPPLIER_MCP_ARCHIVE_COUNT ?? 10)));
const PATCH_DELAY = Math.max(0, Number(process.env.SUPPLIER_MCP_ARCHIVE_PATCH_DELAY_MS ?? 800));
const PAUSE_UNARCHIVE = Math.max(
  5000,
  Number(process.env.SUPPLIER_MCP_ARCHIVE_PAUSE_MS ?? 0) || PATCH_DELAY * 3
);
const DRY = process.env.SUPPLIER_MCP_ARCHIVE_DRY_RUN === "1";
const useDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseToolResult(result) {
  const block = result?.content?.find((c) => c.type === "text");
  if (!block?.text) return { text: null, json: null };
  try {
    return { text: block.text, json: JSON.parse(block.text) };
  } catch {
    return { text: block.text, json: null };
  }
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

function supplierIsArchivedFromGet(json) {
  if (!json || typeof json !== "object") return undefined;
  const s = json.data?.id != null ? json.data : json.id != null ? json : null;
  return s?.isArchived;
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

  const kill = () => {
    try {
      server.kill();
    } catch {
      /* ignore */
    }
  };

  /** @type {string[]} */
  const archivedForRollback = [];

  try {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-mcp-suppliers-archive", version: "1.0.0" },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    console.log("→ spendesk_get_suppliers (isArchived=false, toutes pages — peut prendre du temps)…");
    const listRes = await rpc("tools/call", {
      name: "spendesk_get_suppliers",
      arguments: {
        perPage: 30,
        supplierFilters: { isArchived: false },
      },
    });
    const { json: listJson } = parseToolResult(listRes);
    const rows = Array.isArray(listJson?.data) ? listJson.data : [];
    console.log(`✓ Liste MCP : ${rows.length} fournisseur(s) actif(s).`);

    const picked = pickLatestCreated(rows, COUNT);
    if (picked.length === 0) {
      throw new Error("Aucun fournisseur actif.");
    }
    if (picked.length < COUNT) {
      console.warn(`Seulement ${picked.length} fournisseur(s) (demandé ${COUNT}).`);
    }

    console.log("\nSélection (createdAt desc) :");
    for (const p of picked) {
      console.log(`  - ${p.id}  ${String(p.name ?? "").slice(0, 42)}  ${p.createdAt ?? ""}`);
    }

    if (DRY) {
      console.log("\nDRY RUN — pas d’archive.");
      kill();
      return;
    }

    console.log("\n--- Archive (spendesk_set_supplier_archive_status isArchived: true) ---");
    for (const p of picked) {
      console.log("→ archive", p.id);
      await rpc("tools/call", {
        name: "spendesk_set_supplier_archive_status",
        arguments: { supplierId: p.id, isArchived: true },
      });
      archivedForRollback.push(p.id);
      console.log("✓ archivé", p.id);
      if (PATCH_DELAY) await sleep(PATCH_DELAY);
    }

    console.log("\n--- Vérification spendesk_get_supplier ---");
    for (const p of picked) {
      const gr = await rpc("tools/call", {
        name: "spendesk_get_supplier",
        arguments: { supplierId: p.id },
      });
      const { json } = parseToolResult(gr);
      const ar = supplierIsArchivedFromGet(json);
      console.log(`✓ GET ${p.id} isArchived=${ar}`);
      if (ar !== true) console.warn("  ⚠ attendu isArchived=true");
      if (PATCH_DELAY) await sleep(Math.min(250, PATCH_DELAY));
    }

    console.log(`\nPause ${PAUSE_UNARCHIVE / 1000}s avant désarchive…`);
    await sleep(PAUSE_UNARCHIVE);

    console.log("\n--- Désarchive (isArchived: false) ---");
    for (const p of picked) {
      console.log("→ unarchive", p.id);
      await rpc("tools/call", {
        name: "spendesk_set_supplier_archive_status",
        arguments: { supplierId: p.id, isArchived: false },
      });
      console.log("✓ désarchivé", p.id);
      if (PATCH_DELAY) await sleep(PATCH_DELAY);
    }
    archivedForRollback.length = 0;

    console.log("\n--- Vérification finale GET ---");
    for (const p of picked) {
      const gr = await rpc("tools/call", {
        name: "spendesk_get_supplier",
        arguments: { supplierId: p.id },
      });
      const { json } = parseToolResult(gr);
      const ar = supplierIsArchivedFromGet(json);
      console.log(`✓ GET ${p.id} isArchived=${ar}`);
      if (ar !== false) console.warn("  ⚠ attendu isArchived=false");
      if (PATCH_DELAY) await sleep(Math.min(250, PATCH_DELAY));
    }

    kill();
  } catch (e) {
    console.error("\n✗ Erreur:", e.message || e);
    if (archivedForRollback.length > 0) {
      console.log("\nRollback : désarchivage des IDs déjà archivés…");
      for (const id of archivedForRollback) {
        try {
          await rpc("tools/call", {
            name: "spendesk_set_supplier_archive_status",
            arguments: { supplierId: id, isArchived: false },
          });
          console.log("  rollback OK", id);
        } catch (err) {
          console.error("  rollback échoué", id, err.message?.slice(0, 120));
        }
        if (PATCH_DELAY) await sleep(PATCH_DELAY);
      }
    }
    kill();
    process.exit(1);
  }
}

console.log("MCP suppliers archive cycle — demo=", useDemo, " count=", COUNT);
if (DRY) console.log("Mode DRY RUN\n");

await runMcpSession();
console.log("\n✓ Flux MCP archive / désarchive terminé.");
