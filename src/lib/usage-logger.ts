import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { createDatabase } from "../db/schema.js";

type UsageStatus = "success" | "error";

export type UsageCategory =
  | "spend_analysis"
  | "ap_aging"
  | "bookkeeping"
  | "cash_flow"
  | "reference_data"
  | "purchase_orders"
  | "raw_api"
  | "other";

export interface UsageEventInput {
  ts?: string;
  clientHash?: string | null;
  companyKey?: string | null;
  sessionId?: string | null;
  method?: string | null;
  toolName?: string | null;
  category?: UsageCategory | null;
  durationMs?: number | null;
  status?: UsageStatus | null;
  errorCode?: string | null;
  resultSize?: number | null;
  meta?: Record<string, unknown> | null;
}

let db: Database.Database | null = null;
let insertStmt: Database.Statement | null = null;

function getDb(): { db: Database.Database; insert: Database.Statement } | null {
  if (db && insertStmt) return { db, insert: insertStmt };
  try {
    db = createDatabase();
    insertStmt = db.prepare(`
      INSERT INTO mcp_usage_events (
        ts,
        client_hash,
        company_key,
        session_id,
        method,
        tool_name,
        category,
        duration_ms,
        status,
        error_code,
        result_size,
        meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return { db, insert: insertStmt };
  } catch (err) {
    // If DB initialization fails we should not break the MCP server – just log once.
    console.error("[UsageLogger] Failed to initialize database for usage events:", err);
    db = null;
    insertStmt = null;
    return null;
  }
}

/** Hash a client identifier (API key or credentials) with optional salt, to avoid storing raw IDs. */
export function hashClientIdentifier(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const salt = process.env.USAGE_LOG_SALT || "";
    return createHash("sha256").update(salt + ":" + value).digest("hex");
  } catch {
    return null;
  }
}

/** Low-level helper to persist a usage event. Safe to call in hot paths (synchronous DB write). */
export function logUsageEvent(event: UsageEventInput): void {
  const handle = getDb();
  if (!handle) return;
  const { insert } = handle;

  const ts = event.ts ?? new Date().toISOString();
  const metaJson =
    event.meta && Object.keys(event.meta).length > 0 ? JSON.stringify(event.meta).slice(0, 4000) : null;
  try {
    insert.run(
      ts,
      event.clientHash ?? null,
      event.companyKey ?? null,
      event.sessionId ?? null,
      event.method ?? null,
      event.toolName ?? null,
      event.category ?? null,
      event.durationMs ?? null,
      event.status ?? null,
      event.errorCode ?? null,
      event.resultSize ?? null,
      metaJson
    );
  } catch (err) {
    // Never throw from logger – just print once in console to avoid log loops.
    console.error("[UsageLogger] Failed to insert usage event:", err);
  }
}

/** Helper specifically for HTTP /mcp requests. */
export function logHttpRequestUsage(input: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  clientIdentifier?: string | null;
  companyKey?: string | null;
  sessionId?: string | null;
}): void {
  const status: UsageStatus = input.statusCode >= 200 && input.statusCode < 400 ? "success" : "error";
  const clientHash = hashClientIdentifier(input.clientIdentifier ?? null);
  logUsageEvent({
    method: input.method,
    toolName: null,
    category: null,
    status,
    durationMs: input.durationMs,
    errorCode: input.statusCode.toString(),
    clientHash,
    companyKey: input.companyKey ?? null,
    sessionId: input.sessionId ?? null,
    meta: {
      path: input.path,
      statusCode: input.statusCode,
    },
  });
}

/** Helper for MCP tool calls from registerTools. */
export function logToolCallUsage(input: {
  toolName: string;
  category?: UsageCategory | null;
  durationMs: number;
  status: UsageStatus;
  errorCode?: string | null;
  resultSize?: number | null;
  meta?: Record<string, unknown> | null;
}): void {
  logUsageEvent({
    method: "tools/call",
    toolName: input.toolName,
    category: input.category ?? "other",
    durationMs: input.durationMs,
    status: input.status,
    errorCode: input.errorCode ?? null,
    resultSize: input.resultSize ?? null,
    meta: input.meta ?? null,
  });
}

/** Static mapping of tool name to logical category for dashboards. */
export const TOOL_CATEGORY: Record<string, UsageCategory> = {
  spendesk_analyze_spend: "spend_analysis",
  spendesk_get_spend_dashboard: "spend_analysis",
  spendesk_get_top_suppliers_by_spend: "spend_analysis",
  spendesk_get_ap_aging: "ap_aging",
  spendesk_get_payment_status: "ap_aging",
  spendesk_get_cash_flow_forecast: "cash_flow",
  spendesk_get_cash_position: "cash_flow",
  spendesk_get_bookkeeping_pipeline: "bookkeeping",
  spendesk_get_accruals: "bookkeeping",
  spendesk_get_purchase_orders: "purchase_orders",
  spendesk_get_purchase_orders_and_payables_export: "purchase_orders",
  spendesk_get_filter_options: "reference_data",
  spendesk_load_sqlite_data: "reference_data",
  spendesk_execute_sql_query: "reference_data",
  spendesk_list_loaded_tables: "reference_data",
  spendesk_clear_sqlite_tables: "reference_data",
  // Fallback categories for other tools can be added over time.
};

