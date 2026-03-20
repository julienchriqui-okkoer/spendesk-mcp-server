/**
 * Ephemeral in-memory SQLite for Spendesk MCP (Ramp-style pattern).
 * One DB per MCP session (when session id is set via request context) so sessions cannot read each other's data.
 */

import Database from "better-sqlite3";
import type { SpendeskClient } from "../spendesk-api/client.js";
import { SpendeskPaths } from "../spendesk-api/endpoints.js";
import { fetchAllPayables, type Payable } from "./fetch-all-payables.js";
import { fetchAllPages } from "./fetch-all-pages.js";
import { sanitizePurchaseOrder } from "./sanitize-purchase-order.js";
import { getMcpSessionId } from "./request-context.js";

const ALLOWED_SQL_PREFIXES = ["SELECT", "WITH"];
const MAX_ROWS_RETURNED = 1000;
const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "PRAGMA", "ATTACH", "DETACH",
];

/** Per-session in-memory DBs; key is mcp-session-id or "_default" when no session context. */
const sessionDbs = new Map<string, Database.Database>();

function getSessionKey(): string {
  const id = getMcpSessionId();
  return id ?? "_default";
}

/** Get or create the DB for the current request session (or default). */
function getSessionDb(): Database.Database {
  const key = getSessionKey();
  let db = sessionDbs.get(key);
  if (!db) {
    db = new Database(":memory:");
    sessionDbs.set(key, db);
  }
  return db;
}

/** Close and remove a session's DB (call on DELETE /mcp or session cleanup). */
export function closeSessionDb(sessionId: string): void {
  const db = sessionDbs.get(sessionId);
  if (db) {
    try {
      db.close();
    } catch (err) {
      console.error(`[ephemeral-sqlite] Error closing session DB ${sessionId}:`, err);
    }
    sessionDbs.delete(sessionId);
  }
}

function getPaymentStatusKey(p: Payable): "paid" | "unpaid" | "partial" {
  const allocated = (p.allocations ?? []).reduce((sum, a) => sum + a.allocatedAmount, 0);
  if ((p.allocations ?? []).length === 0) return "unpaid";
  return allocated >= p.functionalAmount ? "paid" : "partial";
}

function expenseAccountDisplay(acc: { code?: string; name?: string } | null | undefined): string {
  if (!acc) return "";
  const code = acc.code ?? "";
  const name = acc.name ?? "";
  if (code && name) return `${code} - ${name}`.trim();
  return name || code || "";
}

/** Return the DB for the current session (for tests: set request context or use _default). */
export function getOrCreateDb(_api?: SpendeskClient): Database.Database {
  return getSessionDb();
}

export type LoadDataset = "payables" | "settlements" | "suppliers" | "purchase_orders";

export interface LoadResult {
  tableName: string;
  rowCount: number;
  columns: Array<{ name: string; type: string }>;
}

function payablesTableSchema(): string {
  return `
CREATE TABLE IF NOT EXISTS payables (
  id TEXT PRIMARY KEY,
  supplier_name TEXT,
  supplier_id TEXT,
  amount_eur REAL,
  original_amount REAL,
  original_currency TEXT,
  payable_type TEXT,
  payable_date TEXT,
  due_date TEXT,
  bookkeeping_status TEXT,
  payment_status TEXT,
  cost_center TEXT,
  cost_center_id TEXT,
  counterparty_type TEXT,
  employee_name TEXT,
  expense_account TEXT,
  description TEXT,
  created_at TEXT,
  updated_at TEXT
)`;
}

function mapPayableToRow(p: Payable): Record<string, string | number | null> {
  const paymentStatus = getPaymentStatusKey(p);
  const costCenter = p.lineItems?.[0]?.costCenterName ?? (p as { costCenterName?: string }).costCenterName ?? null;
  const costCenterId = (p.lineItems?.[0] as { costCenterId?: string })?.costCenterId ?? (p as { costCenterId?: string }).costCenterId ?? null;
  const expenseAccount = expenseAccountDisplay(p.expenseAccount) || (p.lineItems?.[0]?.expenseAccount ? expenseAccountDisplay(p.lineItems[0].expenseAccount) : null);
  return {
    id: p.id,
    supplier_name: p.counterparty?.name ?? null,
    supplier_id: p.counterparty?.id ?? null,
    amount_eur: p.functionalAmount ?? 0,
    original_amount: p.amount ?? 0,
    original_currency: p.currency ?? null,
    payable_type: p.type ?? null,
    payable_date: p.payableDate ?? null,
    due_date: p.invoiceDueDate ?? null,
    bookkeeping_status: p.bookkeepingStatus ?? null,
    payment_status: paymentStatus,
    cost_center: costCenter ?? null,
    cost_center_id: costCenterId ?? null,
    counterparty_type: p.counterparty?.type ?? null,
    employee_name: null,
    expense_account: expenseAccount ?? null,
    description: p.description ?? null,
    created_at: (p as { createdAt?: string }).createdAt ?? (p as { created_at?: string }).created_at ?? null,
    updated_at: (p as { updatedAt?: string }).updatedAt ?? (p as { updated_at?: string }).updated_at ?? null,
  };
}

function settlementsTableSchema(): string {
  return `
CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  type TEXT,
  state TEXT,
  amount REAL,
  currency TEXT,
  amount_eur REAL,
  paid_at TEXT,
  cleared_at TEXT,
  counterparty_name TEXT,
  description TEXT
)`;
}

function mapSettlementToRow(s: Record<string, unknown>): Record<string, string | number | null> {
  const amount = Number(s.amount ?? s.amountEur ?? s.functionalAmount ?? 0);
  const amountEur = Number(s.amountEur ?? s.functionalAmount ?? s.amount ?? 0);
  return {
    id: String(s.id ?? ""),
    type: s.type != null ? String(s.type) : null,
    state: s.state != null ? String(s.state) : null,
    amount: amount,
    currency: s.currency != null ? String(s.currency) : null,
    amount_eur: amountEur,
    paid_at: s.paidAt != null ? String(s.paidAt) : (s.paid_at != null ? String(s.paid_at) : null),
    cleared_at: s.clearedAt != null ? String(s.clearedAt) : (s.cleared_at != null ? String(s.cleared_at) : null),
    counterparty_name: s.counterpartyName != null ? String(s.counterpartyName) : (s.counterparty_name != null ? String(s.counterparty_name) : null),
    description: s.description != null ? String(s.description) : null,
  };
}

function suppliersTableSchema(): string {
  return `
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT,
  country TEXT,
  vat_number TEXT,
  iban TEXT,
  email TEXT,
  created_at TEXT
)`;
}

function mapSupplierToRow(s: Record<string, unknown>): Record<string, string | null> {
  return {
    id: String(s.id ?? ""),
    name: s.name != null ? String(s.name) : null,
    country: (s as { country?: string }).country != null ? String((s as { country?: string }).country) : null,
    vat_number: (s as { vatNumber?: string }).vatNumber != null ? String((s as { vatNumber?: string }).vatNumber) : (s as { vat_number?: string }).vat_number != null ? String((s as { vat_number?: string }).vat_number) : null,
    iban: s.iban != null ? String(s.iban) : null,
    email: s.email != null ? String(s.email) : null,
    created_at: (s as { createdAt?: string }).createdAt != null ? String((s as { createdAt?: string }).createdAt) : (s as { created_at?: string }).created_at != null ? String((s as { created_at?: string }).created_at) : null,
  };
}

function purchaseOrdersTableSchema(): string {
  return `
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT,
  supplier_name TEXT,
  supplier_id TEXT,
  status TEXT,
  total_amount REAL,
  currency TEXT,
  start_date TEXT,
  end_date TEXT,
  cost_center TEXT,
  description TEXT,
  created_at TEXT
)`;
}

function mapPurchaseOrderToRow(po: Record<string, unknown>): Record<string, string | number | null> {
  const s = sanitizePurchaseOrder(po);
  const totalAmount = Number(s.totalAmount ?? (s as { total_amount?: number }).total_amount ?? 0);
  const ccName = (s as { costCenterName?: string }).costCenterName ?? (s as { cost_center?: string }).cost_center ?? null;
  return {
    id: String(s.id ?? ""),
    number: s.number != null ? String(s.number) : null,
    supplier_name: (s as { supplierName?: string }).supplierName != null ? String((s as { supplierName?: string }).supplierName) : null,
    supplier_id: (s as { supplierId?: string }).supplierId != null ? String((s as { supplierId?: string }).supplierId) : null,
    status: s.status != null ? String(s.status) : null,
    total_amount: totalAmount,
    currency: s.currency != null ? String(s.currency) : null,
    start_date: (s as { startDate?: string }).startDate != null ? String((s as { startDate?: string }).startDate) : null,
    end_date: (s as { endDate?: string }).endDate != null ? String((s as { endDate?: string }).endDate) : null,
    cost_center: ccName != null ? String(ccName) : null,
    description: s.description != null ? String(s.description) : null,
    created_at: (s as { createdAt?: string }).createdAt != null ? String((s as { createdAt?: string }).createdAt) : null,
  };
}

/** Load a dataset into the ephemeral DB. Replaces table if it already exists. */
export async function loadDataset(
  api: SpendeskClient,
  dataset: LoadDataset,
  fromDate?: string,
  toDate?: string
): Promise<LoadResult> {
  const from = fromDate ?? "";
  const to = toDate ?? "";

  const db = getSessionDb();
  if (dataset === "payables") {
    if (!from || !to) throw new Error("Payables require from_date and to_date (ISO YYYY-MM-DD).");
    const payables = await fetchAllPayables(api, from, to);
    db.exec("DROP TABLE IF EXISTS payables;");
    db.exec(payablesTableSchema());
    const cols = ["id", "supplier_name", "supplier_id", "amount_eur", "original_amount", "original_currency", "payable_type", "payable_date", "due_date", "bookkeeping_status", "payment_status", "cost_center", "cost_center_id", "counterparty_type", "employee_name", "expense_account", "description", "created_at", "updated_at"];
    const ins = db.prepare(
      `INSERT INTO payables (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
    );
    const runMany = db.transaction((rows: Record<string, string | number | null>[]) => {
      for (const r of rows) {
        ins.run(...cols.map((c) => r[c] ?? null));
      }
    });
    runMany(payables.map(mapPayableToRow));
    return {
      tableName: "payables",
      rowCount: payables.length,
      columns: cols.map((c) => ({ name: c, type: c === "amount_eur" || c === "original_amount" ? "REAL" : "TEXT" })),
    };
  }

  if (dataset === "settlements") {
    const params: Record<string, string> = {};
    if (from) params.clearedFrom = from;
    if (to) params.clearedTo = to;
    const { data } = await fetchAllPages(api, SpendeskPaths.getSettlements, params, { listKey: "settlements" });
    const list = Array.isArray(data) ? data : [];
    db.exec("DROP TABLE IF EXISTS settlements;");
    db.exec(settlementsTableSchema());
    const cols = ["id", "type", "state", "amount", "currency", "amount_eur", "paid_at", "cleared_at", "counterparty_name", "description"];
    const ins = db.prepare(
      `INSERT INTO settlements (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
    );
    const runMany = db.transaction((rows: Record<string, string | number | null>[]) => {
      for (const r of rows) {
        ins.run(...cols.map((c) => r[c] ?? null));
      }
    });
    runMany(list.map((s) => mapSettlementToRow(s as Record<string, unknown>)));
    return {
      tableName: "settlements",
      rowCount: list.length,
      columns: cols.map((c) => ({ name: c, type: c === "amount" || c === "amount_eur" ? "REAL" : "TEXT" })),
    };
  }

  if (dataset === "suppliers") {
    const { data } = await fetchAllPages(api, SpendeskPaths.getSuppliers, {}, { listKey: "suppliers" });
    const list = Array.isArray(data) ? data : [];
    db.exec("DROP TABLE IF EXISTS suppliers;");
    db.exec(suppliersTableSchema());
    const cols = ["id", "name", "country", "vat_number", "iban", "email", "created_at"];
    const ins = db.prepare(
      `INSERT INTO suppliers (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
    );
    const runMany = db.transaction((rows: Record<string, string | null>[]) => {
      for (const r of rows) {
        ins.run(...cols.map((c) => r[c] ?? null));
      }
    });
    runMany(list.map((s) => mapSupplierToRow(s as Record<string, unknown>)));
    return {
      tableName: "suppliers",
      rowCount: list.length,
      columns: cols.map((c) => ({ name: c, type: "TEXT" })),
    };
  }

  if (dataset === "purchase_orders") {
    const params: Record<string, string> = {};
    if (from) params.createdFrom = from;
    if (to) params.createdTo = to;
    const { data } = await fetchAllPages(api, SpendeskPaths.getPurchaseOrders, params, {
      listKey: "purchaseOrders",
      pageSizeParam: "pageSize",
      requestedPerPage: 30,
    });
    const list = Array.isArray(data) ? data : [];
    db.exec("DROP TABLE IF EXISTS purchase_orders;");
    db.exec(purchaseOrdersTableSchema());
    const cols = ["id", "number", "supplier_name", "supplier_id", "status", "total_amount", "currency", "start_date", "end_date", "cost_center", "description", "created_at"];
    const ins = db.prepare(
      `INSERT INTO purchase_orders (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
    );
    const runMany = db.transaction((rows: Record<string, string | number | null>[]) => {
      for (const r of rows) {
        ins.run(...cols.map((c) => r[c] ?? null));
      }
    });
    runMany(list.map((p) => mapPurchaseOrderToRow(p as Record<string, unknown>)));
    return {
      tableName: "purchase_orders",
      rowCount: list.length,
      columns: cols.map((c) => ({ name: c, type: c === "total_amount" ? "REAL" : "TEXT" })),
    };
  }

  throw new Error(`Unknown dataset: ${dataset}. Valid: payables, settlements, suppliers, purchase_orders.`);
}

/** Validate that the SQL is read-only (SELECT or WITH). */
export function isAllowedQuery(sql: string): { allowed: boolean; message?: string } {
  const trimmed = sql.trim();
  if (!trimmed) return { allowed: false, message: "Empty query." };
  const upper = trimmed.toUpperCase();
  const ok = ALLOWED_SQL_PREFIXES.some((prefix) => upper === prefix || upper.startsWith(prefix + " "));
  if (!ok) {
    return {
      allowed: false,
      message: `Only SELECT and WITH (CTE) queries are allowed. Got: ${trimmed.slice(0, 50)}...`,
    };
  }
  for (const f of FORBIDDEN_KEYWORDS) {
    if (upper.includes(f)) {
      return { allowed: false, message: `Query must not contain ${f}.` };
    }
  }
  return { allowed: true };
}

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

/** Execute a read-only SQL query. Returns at most MAX_ROWS_RETURNED rows. */
export function executeQuery(api: SpendeskClient, sql: string): ExecuteResult {
  const check = isAllowedQuery(sql);
  if (!check.allowed) throw new Error(check.message);

  const db = getSessionDb();
  let stmt: Database.Statement;
  try {
    stmt = db.prepare(sql);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid SQL: ${msg}`);
  }
  const raw = stmt.all() as unknown[];
  const rows = raw.slice(0, MAX_ROWS_RETURNED).map((row) => {
    const r = row as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] = v;
    }
    return out;
  });
  return {
    rows,
    rowCount: rows.length,
    truncated: raw.length > MAX_ROWS_RETURNED,
  };
}

export interface TableInfo {
  name: string;
  columns: Array<{ name: string; type: string }>;
  rowCount: number;
}

/** List all user-created tables with schema and row count. */
export function listLoadedTables(api: SpendeskClient): TableInfo[] {
  const db = getSessionDb();
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all() as { name: string }[];
  const result: TableInfo[] = [];
  for (const { name } of names) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;
    const info = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string; type: string }>;
    const cols = info ?? [];
    const countRow = db.prepare(`SELECT count(*) as c FROM ${name}`).get() as { c: number };
    result.push({
      name,
      columns: cols.map((c) => ({ name: c.name, type: c.type })),
      rowCount: countRow?.c ?? 0,
    });
  }
  return result;
}

/** Drop one or more tables. If tableNames is empty, drop all user tables. */
export function clearTables(api: SpendeskClient, tableNames?: string[]): { dropped: string[] } {
  const db = getSessionDb();
  const dropped: string[] = [];
  if (!tableNames || tableNames.length === 0) {
    const names = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[];
    for (const { name } of names) {
      db.exec(`DROP TABLE IF EXISTS ${name}`);
      dropped.push(name);
    }
    return { dropped };
  }
  const safeNames = tableNames.filter((n) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n));
  for (const name of safeNames) {
    db.exec(`DROP TABLE IF EXISTS ${name}`);
    dropped.push(name);
  }
  return { dropped };
}

/** Smoke test: verify per-session DB is created and used (run at load, uses _default when no context). */
function _smokeTest(): void {
  const db = getSessionDb();
  db.exec("CREATE TABLE IF NOT EXISTS _test (id INTEGER)");
  db.prepare("INSERT INTO _test VALUES (1)").run();
  const row = db.prepare("SELECT COUNT(*) as c FROM _test").get() as { c: number };
  if (row.c !== 1) {
    throw new Error("SQLite session DB is broken - connection not working");
  }
  db.exec("DROP TABLE IF EXISTS _test");
  console.log("✅ SQLite session DB OK");
}
_smokeTest();
