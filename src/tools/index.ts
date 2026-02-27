import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SpendeskClient } from "../spendesk-api/client.js";
import { SpendeskPaths } from "../spendesk-api/endpoints.js";
import {
  fetchPayablesForPeriod,
  aggregateByCostCenter,
  aggregateByExpenseCategory,
  aggregateByChargeAccount,
  aggregateBySupplier,
} from "../lib/aggregate-payables.js";
import { getApiReference } from "../lib/api-reference.js";
import { z } from "zod";

const paginationSchema = {
  page: z.number().int().min(1).optional().describe("Page number (1-based)"),
  perPage: z.number().int().min(1).max(100).optional().describe("Items per page"),
};

const filtersSchema = z
  .record(z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe("Additional API query parameters (dates, statuses, IDs, etc.)");

const listSchema = {
  ...paginationSchema,
  filters: filtersSchema,
};

// Specific schema for settlements with dedicated parameters
const settlementsSchema = {
  ...paginationSchema,
  type: z.string().optional().describe("Filter settlements by type"),
  state: z.string().optional().describe("Filter settlements by state"),
  paidFrom: z
    .string()
    .optional()
    .describe("Filter settlements paid from this date (ISO 8601 format, bank account filter)"),
  clearedFrom: z.string().optional().describe("Filter settlements cleared from this date (ISO 8601 format)"),
  clearedTo: z.string().optional().describe("Filter settlements cleared until this date (ISO 8601 format)"),
  exportedAfter: z.string().optional().describe("Filter settlements exported after this date (ISO 8601 format)"),
  ids: z.union([z.string(), z.array(z.string())]).optional().describe("Filter by settlement ID(s). Can be a single ID string or array of IDs"),
  filters: filtersSchema, // Keep filters for any additional parameters
};

// Specific schema for purchase orders with dedicated parameters
const purchaseOrdersSchema = {
  ...paginationSchema,
  status: z.string().optional().describe("Filter purchase orders by status"),
  state: z.string().optional().describe("Filter purchase orders by state"),
  supplierId: z.string().optional().describe("Filter purchase orders by supplier ID"),
  userId: z.string().optional().describe("Filter purchase orders by user ID (requester)"),
  from: z.string().optional().describe("Filter purchase orders created from this date (ISO 8601 format)"),
  to: z.string().optional().describe("Filter purchase orders created until this date (ISO 8601 format)"),
  createdFrom: z.string().optional().describe("Filter purchase orders created from this date (ISO 8601 format)"),
  createdTo: z.string().optional().describe("Filter purchase orders created until this date (ISO 8601 format)"),
  updatedFrom: z.string().optional().describe("Filter purchase orders updated from this date (ISO 8601 format)"),
  updatedTo: z.string().optional().describe("Filter purchase orders updated until this date (ISO 8601 format)"),
  ids: z.union([z.string(), z.array(z.string())]).optional().describe("Filter by purchase order ID(s). Can be a single ID string or array of IDs"),
  filters: filtersSchema, // Keep filters for any additional parameters
};

const dateYMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// Public API payables snapshot query (publicPayableQuerySchema)
const payablesSnapshotSchema = {
  bookkeepingStatus: z
    .array(z.string())
    .optional()
    .describe("Filter payables by bookkeeping status(es)."),
  exportedAfter: z
    .string()
    .optional()
    .describe("Returns payables exported after the given date (ISO 8601)."),
  ids: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("List of payable IDs to filter by."),
  sortBy: z
    .enum(["payableDate"])
    .optional()
    .default("payableDate")
    .describe("Sort field (default: payableDate)."),
  sortOrder: z
    .enum(["asc", "desc"])
    .optional()
    .default("desc")
    .describe("Sort order (default: desc)."),
  fromPayableDate: dateYMD.optional().describe("Period start date (YYYY-MM-DD). Requires toPayableDate; max 31 days range."),
  toPayableDate: dateYMD.optional().describe("Period end date (YYYY-MM-DD). Required when fromPayableDate is set."),
  createdFrom: dateYMD.optional().describe("Period start for creation date (YYYY-MM-DD)."),
  createdTo: dateYMD.optional().describe("Period end for creation date (YYYY-MM-DD), end of day (T23:59:59)."),
  updatedFrom: dateYMD.optional().describe("Returns payables modified after this date (YYYY-MM-DD)."),
  filters: filtersSchema,
  payload: z.record(z.unknown()).optional().describe("Optional extra body fields (legacy: { from, to } are mapped to fromPayableDate, toPayableDate)."),
};

function paginate(args: { page?: number; perPage?: number }): Record<string, string> {
  const p: Record<string, string> = {};
  if (args.page != null) p.page = String(args.page);
  if (args.perPage != null) p.per_page = String(args.perPage);
  return p;
}

/**
 * Build query params from pagination + optional filters.
 * Filters can contain any API query parameters (dates, statuses, IDs, etc.).
 */
function buildQueryParams(args: {
  page?: number;
  perPage?: number;
  filters?: Record<string, unknown>;
}): Record<string, string> {
  const params = paginate(args);
  if (args.filters) {
    for (const [key, value] of Object.entries(args.filters)) {
      if (value != null) {
        params[key] = String(value);
      }
    }
  }
  return params;
}

/**
 * Build query params specifically for settlements with dedicated parameters.
 */
function buildSettlementsQueryParams(args: {
  page?: number;
  perPage?: number;
  type?: string;
  state?: string;
  paidFrom?: string;
  clearedFrom?: string;
  clearedTo?: string;
  exportedAfter?: string;
  ids?: string | string[];
  filters?: Record<string, unknown>;
}): Record<string, string> {
  const params = paginate(args);
  
  // Add dedicated settlement parameters (sent to the API in camelCase)
  if (args.type != null) params.type = String(args.type);
  if (args.state != null) params.state = String(args.state);
  if (args.paidFrom != null) params.paidFrom = String(args.paidFrom);
  if (args.clearedFrom != null) params.clearedFrom = String(args.clearedFrom);
  if (args.clearedTo != null) params.clearedTo = String(args.clearedTo);
  if (args.exportedAfter != null) params.exportedAfter = String(args.exportedAfter);
  
  // Handle ids parameter (can be string or array)
  if (args.ids != null) {
    if (Array.isArray(args.ids)) {
      // If array, join with comma (common API pattern)
      params.ids = args.ids.join(",");
    } else {
      params.ids = String(args.ids);
    }
  }
  
  // Add any additional filters
  if (args.filters) {
    for (const [key, value] of Object.entries(args.filters)) {
      if (value != null && !params[key]) { // Don't override dedicated params
        params[key] = String(value);
      }
    }
  }
  
  return params;
}

/**
 * Build query params for purchase orders. The Spendesk API expects creation date
 * as "from" / "to" (not createdFrom/createdTo) and snake_case for some params.
 * We map tool args (createdFrom, supplierId, etc.) to the API query param names.
 */
function buildPurchaseOrdersQueryParams(args: {
  page?: number;
  perPage?: number;
  status?: string;
  state?: string;
  supplierId?: string;
  userId?: string;
  from?: string;
  to?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  ids?: string | string[];
  filters?: Record<string, unknown>;
}): Record<string, string> {
  const params = paginate(args);

  // All query parameters are sent to the API in camelCase, matching the MCP tool argument names.
  if (args.status != null) params.status = String(args.status);
  if (args.state != null) params.state = String(args.state);
  if (args.supplierId != null) params.supplierId = String(args.supplierId);
  if (args.userId != null) params.userId = String(args.userId);

  // Date filters are also sent in camelCase
  if (args.from != null) params.from = String(args.from);
  if (args.to != null) params.to = String(args.to);
  if (args.createdFrom != null) params.createdFrom = String(args.createdFrom);
  if (args.createdTo != null) params.createdTo = String(args.createdTo);
  if (args.updatedFrom != null) params.updatedFrom = String(args.updatedFrom);
  if (args.updatedTo != null) params.updatedTo = String(args.updatedTo);

  if (args.ids != null) {
    if (Array.isArray(args.ids)) {
      params.ids = args.ids.join(",");
    } else {
      params.ids = String(args.ids);
    }
  }

  if (args.filters) {
    for (const [key, value] of Object.entries(args.filters)) {
      if (value != null && !params[key]) {
        params[key] = String(value);
      }
    }
  }

  return params;
}

/**
 * Build request body for create payables snapshot (Public API).
 *
 * The Public API snapshot endpoint expects a **flat JSON body** whose fields
 * match the publicPayableQuerySchema (no extra wrapper). Example:
 *
 * {
 *   "fromPayableDate": "2026-02-26",
 *   "toPayableDate": "2026-02-26"
 * }
 *
 * Tool params (fromPayableDate, toPayableDate, ids, etc.) are mapped directly
 * to the body. The optional "payload" param is only used for backwards
 * compatibility (mapping { from, to } or payload.query.* to these same fields)
 * and never introduces unknown properties.
 */
function buildPayablesSnapshotPayload(args: {
  bookkeepingStatus?: string[];
  exportedAfter?: string;
  ids?: string | string[];
  sortBy?: "payableDate";
  sortOrder?: "asc" | "desc";
  fromPayableDate?: string;
  toPayableDate?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  filters?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  // Explicit tool parameters (only fields allowed by the public schema)
  if (args.bookkeepingStatus != null && args.bookkeepingStatus.length > 0) {
    body.bookkeepingStatus = args.bookkeepingStatus;
  }
  if (args.exportedAfter != null) body.exportedAfter = args.exportedAfter;
  if (args.ids != null) {
    body.ids = Array.isArray(args.ids) ? args.ids : [args.ids];
  }
  if (args.sortBy != null) body.sortBy = args.sortBy;
  if (args.sortOrder != null) body.sortOrder = args.sortOrder;
  if (args.fromPayableDate != null) body.fromPayableDate = args.fromPayableDate;
  if (args.toPayableDate != null) body.toPayableDate = args.toPayableDate;
  if (args.createdFrom != null) body.createdFrom = args.createdFrom;
  if (args.createdTo != null) body.createdTo = args.createdTo;
  if (args.updatedFrom != null) body.updatedFrom = args.updatedFrom;

  // Backwards compatibility: use payload to populate allowed fields only
  if (args.payload && typeof args.payload === "object") {
    const p = args.payload as Record<string, unknown>;

    // Legacy: payload.query.{field} → allowed snapshot fields
    const pq = p.query;
    if (pq && typeof pq === "object" && !Array.isArray(pq)) {
      const q = pq as Record<string, unknown>;
      const allowedKeys = [
        "bookkeepingStatus",
        "exportedAfter",
        "ids",
        "sortBy",
        "sortOrder",
        "fromPayableDate",
        "toPayableDate",
        "createdFrom",
        "createdTo",
        "updatedFrom",
      ] as const;
      for (const key of allowedKeys) {
        const value = q[key];
        if (value != null && body[key] === undefined) {
          if (key === "ids" && !Array.isArray(value)) {
            body.ids = [value as string];
          } else {
            body[key] = value;
          }
        }
      }
    }

    // Legacy: payload.{from,to} → fromPayableDate/toPayableDate
    if (p.from != null && body.fromPayableDate === undefined) {
      body.fromPayableDate = p.from;
    }
    if (p.to != null && body.toPayableDate === undefined) {
      body.toPayableDate = p.to;
    }

    // If only fromPayableDate is set, mirror it into toPayableDate to satisfy the API constraint.
    if (body.fromPayableDate != null && body.toPayableDate === undefined) {
      body.toPayableDate = body.fromPayableDate;
    }

    // Any other keys in payload are ignored on purpose to avoid sending
    // additional properties that the Public API would reject.
  }

  // Do not forward generic "filters" to the snapshot endpoint: it only accepts the explicit fields above.
  return body;
}

export function registerTools(mcp: McpServer, api: SpendeskClient): void {
  const run = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case "spendesk_get_settlements":
        return api.get(
          SpendeskPaths.getSettlements,
          buildSettlementsQueryParams(args as {
            page?: number;
            perPage?: number;
            type?: string;
            state?: string;
            paidFrom?: string;
            clearedFrom?: string;
            clearedTo?: string;
            exportedAfter?: string;
            ids?: string | string[];
            filters?: Record<string, unknown>;
          })
        );
      case "spendesk_update_settlement_state":
        return api.put(SpendeskPaths.updateSettlementState(args.settlementId as string), { state: args.state });
      case "spendesk_get_bank_fees":
        return api.get(
          SpendeskPaths.getBankFees,
          buildQueryParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> })
        );
      case "spendesk_create_payables_snapshot": {
        const body = buildPayablesSnapshotPayload(args as Parameters<typeof buildPayablesSnapshotPayload>[0]);
        try {
          return await api.post(SpendeskPaths.createPayablesSnapshot, body);
        } catch (err) {
          const e = err as { statusCode?: number; body?: unknown; message?: string };
          if (e.statusCode && e.body) {
            throw new Error(
              `${e.message ?? "Spendesk API error"} — body: ${JSON.stringify(e.body)}`
            );
          }
          throw err;
        }
      }
      case "spendesk_get_payables_snapshot":
        return api.get(SpendeskPaths.getPayablesSnapshot(args.snapshotId as string));
      case "spendesk_get_payable":
        return api.get(SpendeskPaths.getPayableById(args.payableId as string));
      case "spendesk_get_payable_attachments":
        return api.get(SpendeskPaths.getPayableAttachments(args.payableId as string));
      case "spendesk_update_payable_bookkeeping":
        return api.put(SpendeskPaths.updatePayableBookkeeping, {
          payableId: args.payableId,
          ...(args.payload as Record<string, unknown>),
        });
      case "spendesk_get_wallet_loads":
        return api.get(
          SpendeskPaths.getWalletLoads,
          buildQueryParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> })
        );
      case "spendesk_get_wallet_summary":
        return api.get(SpendeskPaths.getWalletSummary);

      case "spendesk_get_analytical_fields":
        return api.get(SpendeskPaths.getAnalyticalFields);
      case "spendesk_get_analytical_values":
        return api.get(
          SpendeskPaths.getAnalyticalValuesByFieldId(args.fieldId as string),
          buildQueryParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> })
        );
      case "spendesk_get_cost_centers":
        return api.get(
          SpendeskPaths.getCostCenters,
          buildQueryParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> })
        );
      case "spendesk_get_expense_categories":
        return api.get(
          SpendeskPaths.getExpenseCategories,
          buildQueryParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> })
        );
      case "spendesk_create_cost_center":
        return api.post(SpendeskPaths.createCostCenter, args.payload);
      case "spendesk_update_cost_center":
        return api.put(SpendeskPaths.updateCostCenter(args.costCenterId as string), args.payload);
      case "spendesk_delete_cost_center":
        return api.delete(SpendeskPaths.deleteCostCenter(args.costCenterId as string));

      case "spendesk_get_journal_csv":
        return api.get(SpendeskPaths.getJournalCsv(args.exportId as string));
      case "spendesk_create_accounting_export":
        return api.post(SpendeskPaths.createAccountingExport, args.payload);
      case "spendesk_get_journal_templates":
        return api.get(SpendeskPaths.getJournalTemplates);

      case "spendesk_get_suppliers":
        return api.get(
          SpendeskPaths.getSuppliers,
          buildQueryParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> })
        );
      case "spendesk_get_supplier":
        return api.get(SpendeskPaths.getSupplierById(args.supplierId as string));
      case "spendesk_get_users":
        return api.get(
          SpendeskPaths.getUsers,
          buildQueryParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> })
        );
      case "spendesk_get_user":
        return api.get(SpendeskPaths.getUserById(args.userId as string));

      case "spendesk_create_webhook":
        return api.post(SpendeskPaths.createWebhook, args.payload);
      case "spendesk_get_webhooks":
        return api.get(SpendeskPaths.getWebhooks);
      case "spendesk_get_webhook":
        return api.get(SpendeskPaths.getWebhookById(args.webhookId as string));
      case "spendesk_update_webhook":
        return api.put(SpendeskPaths.updateWebhook(args.webhookId as string), args.payload);
      case "spendesk_delete_webhook":
        return api.delete(SpendeskPaths.deleteWebhook(args.webhookId as string));

      case "spendesk_get_purchase_orders":
        return api.get(
          SpendeskPaths.getPurchaseOrders,
          buildPurchaseOrdersQueryParams(args as {
            page?: number;
            perPage?: number;
            status?: string;
            state?: string;
            supplierId?: string;
            userId?: string;
            from?: string;
            to?: string;
            createdFrom?: string;
            createdTo?: string;
            updatedFrom?: string;
            updatedTo?: string;
            ids?: string | string[];
            filters?: Record<string, unknown>;
          })
        );
      case "spendesk_create_purchase_order":
        return api.post(SpendeskPaths.createPurchaseOrder, args.payload);

      case "spendesk_get_top_suppliers_by_spend": {
        const from = String(args.from ?? "");
        const to = String(args.to ?? "");
        const limit = Math.min(100, Math.max(1, Number(args.limit ?? 10)));
        const { payables, error } = await fetchPayablesForPeriod(api, from, to);
        const bySupplier = aggregateBySupplier(payables).slice(0, limit);
        return { period: { from, to }, topSuppliers: bySupplier, error };
      }

      case "spendesk_get_spend_dashboard": {
        const from = String(args.from ?? "");
        const to = String(args.to ?? "");
        const groupBy = args.groupBy as "costCenter" | "expenseCategory" | "chargeAccount" | undefined;
        const { payables, error } = await fetchPayablesForPeriod(api, from, to);
        const totalAmount = payables.reduce((sum, p) => sum + (p.functionalAmount || p.amount), 0);
        const currency = payables[0]?.currency ?? "EUR";
        const base = { period: { from, to }, totalAmount, currency, error };
        if (groupBy === "costCenter") return { ...base, byCostCenter: aggregateByCostCenter(payables) };
        if (groupBy === "expenseCategory") return { ...base, byExpenseCategory: aggregateByExpenseCategory(payables) };
        if (groupBy === "chargeAccount") return { ...base, byChargeAccount: aggregateByChargeAccount(payables) };
        return {
          ...base,
          byCostCenter: aggregateByCostCenter(payables),
          byExpenseCategory: aggregateByExpenseCategory(payables),
          byChargeAccount: aggregateByChargeAccount(payables),
        };
      }

      case "spendesk_get_purchase_orders_and_payables_export": {
        const from = String(args.from ?? "");
        const to = String(args.to ?? "");
        const purchaseOrders: unknown[] = [];
        for (let page = 1; page <= 50; page++) {
          const params = buildPurchaseOrdersQueryParams({
            from,
            to,
            page,
            perPage: 100,
          });
          const res = await api.get<{ data?: unknown[]; purchaseOrders?: unknown[] }>(
            SpendeskPaths.getPurchaseOrders,
            params
          );
          const list = (res as Record<string, unknown>)?.data ?? (res as Record<string, unknown>)?.purchaseOrders ?? [];
          const items = Array.isArray(list) ? list : [];
          if (items.length === 0) break;
          purchaseOrders.push(...items);
          if (items.length < 100) break;
        }
        const { payables } = await fetchPayablesForPeriod(api, from, to);
        const bySupplierMap = new Map<
          string,
          { supplierName: string; purchaseOrders: unknown[]; payables: unknown[] }
        >();
        for (const po of purchaseOrders) {
          const p = po as Record<string, unknown>;
          const supplierId = String(p.supplierId ?? p.supplier_id ?? "_unknown");
          const supplierName = String(p.supplierName ?? p.supplier_name ?? "Unknown");
          if (!bySupplierMap.has(supplierId)) {
            bySupplierMap.set(supplierId, { supplierName, purchaseOrders: [], payables: [] });
          }
          bySupplierMap.get(supplierId)!.purchaseOrders.push(po);
        }
        for (const pay of payables) {
          const supplierId = String(pay.supplierId ?? pay.supplierName ?? "_unknown");
          const supplierName = pay.supplierName ?? pay.supplierId ?? "Unknown";
          if (!bySupplierMap.has(supplierId)) {
            bySupplierMap.set(supplierId, { supplierName, purchaseOrders: [], payables: [] });
          }
          bySupplierMap.get(supplierId)!.payables.push(pay.raw);
        }
        const bySupplier = Array.from(bySupplierMap.entries()).map(([supplierId, v]) => ({
          supplierId,
          supplierName: v.supplierName,
          purchaseOrders: v.purchaseOrders,
          payables: v.payables,
        }));
        return { period: { from, to }, purchaseOrders, payables: payables.map((p) => p.raw), bySupplier };
      }

      case "spendesk_get_api_reference": {
        const mcpTool = args.mcpTool as string | undefined;
        const path = args.path as string | undefined;
        return getApiReference(mcpTool ? { mcpTool } : path ? { path } : undefined);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  const toContent = (result: unknown) => ({
    content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
  });

  // —— Spend Data ———————————————————————————————————————————————————————————
  mcp.tool(
    "spendesk_get_settlements",
    "Get settlements list. Useful for ERP sync and reporting. Supports dedicated parameters (type, state, paidFrom, clearedFrom, clearedTo, exportedAfter, ids) and 'filters' for any additional API query parameters.",
    settlementsSchema,
    async (args) => toContent(await run("spendesk_get_settlements", args))
  );
  mcp.tool(
    "spendesk_update_settlement_state",
    "Update a settlement state (e.g. for workflow automation).",
    {
      settlementId: z.string().describe("Settlement ID"),
      state: z.string().describe("New state value"),
    },
    async (args) => toContent(await run("spendesk_update_settlement_state", args))
  );
  mcp.tool(
    "spendesk_get_bank_fees",
    "Get bank fees. Useful for accounting and dashboards. Use 'filters' to pass any API query parameters.",
    listSchema,
    async (args) => toContent(await run("spendesk_get_bank_fees", args))
  );
  mcp.tool(
    "spendesk_create_payables_snapshot",
    "Create a snapshot of payables (invoices, credit notes, etc.). Uses Public API filters: bookkeepingStatus, exportedAfter, ids, sortBy, sortOrder, fromPayableDate (requires toPayableDate, max 31 days), toPayableDate, createdFrom, createdTo, updatedFrom. Use 'filters' for any extra query params.",
    payablesSnapshotSchema,
    async (args) => toContent(await run("spendesk_create_payables_snapshot", args))
  );
  mcp.tool(
    "spendesk_get_payables_snapshot",
    "Get a payables snapshot by ID.",
    { snapshotId: z.string().describe("Snapshot ID") },
    async (args) => toContent(await run("spendesk_get_payables_snapshot", args))
  );
  mcp.tool(
    "spendesk_get_payable",
    "Get a single payable by ID (invoice, expense, etc.).",
    { payableId: z.string().describe("Payable ID") },
    async (args) => toContent(await run("spendesk_get_payable", args))
  );
  mcp.tool(
    "spendesk_get_payable_attachments",
    "Get attachments for a payable.",
    { payableId: z.string().describe("Payable ID") },
    async (args) => toContent(await run("spendesk_get_payable_attachments", args))
  );
  mcp.tool(
    "spendesk_update_payable_bookkeeping",
    "Update bookkeeping status of a payable (ERP sync).",
    {
      payableId: z.string().describe("Payable ID"),
      payload: z.record(z.unknown()).describe("Bookkeeping status payload"),
    },
    async (args) => toContent(await run("spendesk_update_payable_bookkeeping", args))
  );

  // —— Report (key answers) ———————————————————————————————————————————————————
  mcp.tool(
    "spendesk_get_spend_dashboard",
    "Use when the user asks for a spend dashboard, spend breakdown by cost center / expense category / charge account for a given period (e.g. Q1 2026, January 2026). Returns aggregated data ready to display as tables.",
    {
      from: z.string().describe("Start date ISO (e.g. 2026-01-01)"),
      to: z.string().describe("End date ISO (e.g. 2026-03-31 or 2026-01-31)"),
      groupBy: z
        .enum(["costCenter", "expenseCategory", "chargeAccount"])
        .optional()
        .describe("Optional: return only this aggregation"),
    },
    async (args) => toContent(await run("spendesk_get_spend_dashboard", args))
  );
  mcp.tool(
    "spendesk_get_top_suppliers_by_spend",
    "Use when the user asks for top N suppliers by spend for a period, with associated payables or settlements. Returns ranked list with details.",
    {
      from: z.string().describe("Start date ISO (e.g. 2026-01-01)"),
      to: z.string().describe("End date ISO (e.g. 2026-03-31)"),
      limit: z.number().min(1).max(100).optional().describe("Number of top suppliers (default 10)"),
    },
    async (args) => toContent(await run("spendesk_get_top_suppliers_by_spend", args))
  );
  mcp.tool(
    "spendesk_get_purchase_orders_and_payables_export",
    "Use when the user asks for an export of all purchase orders created in a period with their associated payables. Returns POs and payables linked by supplier.",
    {
      from: z.string().describe("Start date ISO (e.g. 2026-01-01)"),
      to: z.string().describe("End date ISO (e.g. 2026-03-31)"),
    },
    async (args) => toContent(await run("spendesk_get_purchase_orders_and_payables_export", args))
  );

  mcp.tool(
    "spendesk_get_wallet_loads",
    "Get wallet loads (card top-ups, etc.). Use 'filters' to pass any API query parameters.",
    listSchema,
    async (args) => toContent(await run("spendesk_get_wallet_loads", args))
  );
  mcp.tool("spendesk_get_wallet_summary", "Get wallet summary for dashboards.", {}, async () =>
    toContent(await run("spendesk_get_wallet_summary", {}))
  );

  // —— Analytical —————————————————————————————————————————————————──────────
  mcp.tool("spendesk_get_analytical_fields", "Get analytical (custom) fields for reporting.", {}, async () =>
    toContent(await run("spendesk_get_analytical_fields", {}))
  );
  mcp.tool(
    "spendesk_get_analytical_values",
    "Get analytical values for a given field. Call spendesk_get_analytical_fields first to get field ids. Use 'filters' to pass any API query parameters.",
    {
      fieldId: z.string().describe("Analytical field id (from spendesk_get_analytical_fields)"),
      ...listSchema,
    },
    async (args) => toContent(await run("spendesk_get_analytical_values", args))
  );
  mcp.tool(
    "spendesk_get_cost_centers",
    "Get cost centers (for ERP mapping and reports). Use 'filters' to pass any API query parameters.",
    listSchema,
    async (args) => toContent(await run("spendesk_get_cost_centers", args))
  );
  mcp.tool(
    "spendesk_get_expense_categories",
    "Get expense categories. Use 'filters' to pass any API query parameters.",
    listSchema,
    async (args) => toContent(await run("spendesk_get_expense_categories", args))
  );
  mcp.tool(
    "spendesk_create_cost_center",
    "Create a cost center.",
    { payload: z.record(z.unknown()).describe("Cost center body") },
    async (args) => toContent(await run("spendesk_create_cost_center", args))
  );
  mcp.tool(
    "spendesk_update_cost_center",
    "Update a cost center by ID.",
    {
      costCenterId: z.string(),
      payload: z.record(z.unknown()).describe("Fields to update"),
    },
    async (args) => toContent(await run("spendesk_update_cost_center", args))
  );
  mcp.tool(
    "spendesk_delete_cost_center",
    "Delete a cost center by ID.",
    { costCenterId: z.string() },
    async (args) => toContent(await run("spendesk_delete_cost_center", args))
  );

  // —— Accounting —————————————————————————————————————————————————──────────
  mcp.tool(
    "spendesk_get_journal_csv",
    "Get journal CSV content for an accounting export (ERP import).",
    { exportId: z.string().describe("Export ID") },
    async (args) => toContent(await run("spendesk_get_journal_csv", args))
  );
  mcp.tool(
    "spendesk_create_accounting_export",
    "Create an accounting export.",
    { payload: z.record(z.unknown()).describe("Export request body") },
    async (args) => toContent(await run("spendesk_create_accounting_export", args))
  );
  mcp.tool("spendesk_get_journal_templates", "Get available journal templates for accounting.", {}, async () =>
    toContent(await run("spendesk_get_journal_templates", {}))
  );

  // —— Suppliers & Users ————————————————————————————————————————————————————
  mcp.tool(
    "spendesk_get_suppliers",
    "Get suppliers list (vendors). Essential for ERP sync. Use 'filters' to pass any API query parameters.",
    listSchema,
    async (args) => toContent(await run("spendesk_get_suppliers", args))
  );
  mcp.tool(
    "spendesk_get_supplier",
    "Get a supplier by ID.",
    { supplierId: z.string() },
    async (args) => toContent(await run("spendesk_get_supplier", args))
  );
  mcp.tool(
    "spendesk_get_users",
    "Get users list (for approvals, dashboards). Use 'filters' to pass any API query parameters.",
    listSchema,
    async (args) => toContent(await run("spendesk_get_users", args))
  );
  mcp.tool(
    "spendesk_get_user",
    "Get a user by ID.",
    { userId: z.string() },
    async (args) => toContent(await run("spendesk_get_user", args))
  );

  // —— Webhooks —————————————————————————————————————————————————────────────—
  mcp.tool(
    "spendesk_create_webhook",
    "Create a webhook instance for real-time events.",
    { payload: z.record(z.unknown()).describe("Webhook config (url, events, etc.)") },
    async (args) => toContent(await run("spendesk_create_webhook", args))
  );
  mcp.tool("spendesk_get_webhooks", "List all webhook instances.", {}, async () =>
    toContent(await run("spendesk_get_webhooks", {}))
  );
  mcp.tool(
    "spendesk_get_webhook",
    "Get a webhook instance by ID.",
    { webhookId: z.string() },
    async (args) => toContent(await run("spendesk_get_webhook", args))
  );
  mcp.tool(
    "spendesk_update_webhook",
    "Update a webhook instance.",
    {
      webhookId: z.string(),
      payload: z.record(z.unknown()).describe("Fields to update"),
    },
    async (args) => toContent(await run("spendesk_update_webhook", args))
  );
  mcp.tool(
    "spendesk_delete_webhook",
    "Delete a webhook instance.",
    { webhookId: z.string() },
    async (args) => toContent(await run("spendesk_delete_webhook", args))
  );

  // —— Purchase Orders —————————————————————————————————————————————————──────
  mcp.tool(
    "spendesk_get_purchase_orders",
    "Get purchase orders list. Supports status, state, supplierId, userId, ids, and date filters (from, to, createdFrom, createdTo, updatedFrom, updatedTo). Use 'filters' for any other API query parameters. All query parameters are sent to the API in camelCase.",
    purchaseOrdersSchema,
    async (args) => toContent(await run("spendesk_get_purchase_orders", args))
  );
  mcp.tool(
    "spendesk_create_purchase_order",
    "Create a purchase order.",
    { payload: z.record(z.unknown()).describe("PO body") },
    async (args) => toContent(await run("spendesk_create_purchase_order", args))
  );

  // —— API reference (discovery) —————————————————————————————————────────——
  mcp.tool(
    "spendesk_get_api_reference",
    "Get the API reference: list of endpoints, HTTP methods, paths, parameters (query, path, body), and MCP tool names. Use when the user asks about API structure, available endpoints, parameters for a given endpoint, or how to use the Spendesk API. Optional: filter by mcpTool (e.g. spendesk_get_settlements) or path (e.g. settlements) to get only that endpoint.",
    {
      mcpTool: z.string().optional().describe("Filter to the endpoint exposed by this MCP tool (e.g. spendesk_get_settlements)"),
      path: z.string().optional().describe("Filter to endpoints whose path contains this string (e.g. settlements, payables)"),
    },
    async (args) => toContent(await run("spendesk_get_api_reference", args))
  );
}
