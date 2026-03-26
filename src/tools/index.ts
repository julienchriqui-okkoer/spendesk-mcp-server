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
import {
  analyzeSpend,
  type AnalyzeSpendFilters,
  type AnalyzeSpendParams,
  getBookkeepingPipeline,
  getPaymentStatus,
  getApAging,
  getCashFlowForecast,
  getCashPosition,
  getAccruals,
} from "../lib/composite-tools.js";
import { getApiReference } from "../lib/api-reference.js";
import {
  loadDataset,
  executeQuery,
  listLoadedTables,
  clearTables,
  type LoadDataset,
} from "../lib/ephemeral-sqlite.js";
import { fetchAllPages } from "../lib/fetch-all-pages.js";
import { isToolEnabled } from "../lib/tools-config.js";
import { logToolCallUsage, TOOL_CATEGORY } from "../lib/usage-logger.js";
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

const supplierFilterSchema = z
  .object({
    ids: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe("Filter by supplier ID(s). Can be a single ID string or array of IDs."),
    updatedBefore: z.string().optional().describe("Only suppliers updated before this datetime (ISO 8601)."),
    updatedAfter: z.string().optional().describe("Only suppliers updated after this datetime (ISO 8601)."),
    createdBefore: z.string().optional().describe("Only suppliers created before this datetime (ISO 8601)."),
    createdAfter: z.string().optional().describe("Only suppliers created after this datetime (ISO 8601)."),
    bankCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional()
      .describe("Filter by bank country (ISO alpha-2, e.g. FR, DE, GB)."),
    iban: z.string().optional().describe("Filter by supplier IBAN."),
    vatNumber: z.string().optional().describe("Filter by supplier VAT number."),
    isArchived: z
      .boolean()
      .optional()
      .describe("Filter archived suppliers: true = archived only, false = active only."),
  })
  .optional();

const suppliersSchema = {
  page: z.number().int().min(1).optional().describe("Page number (1-based)"),
  perPage: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Items per page (mapped to API pageSize, max 30 for suppliers endpoint)."),
  filters: filtersSchema,
  supplierFilters: supplierFilterSchema.describe("Dedicated suppliers filters (merged with filters)."),
  fetchAll: z
    .boolean()
    .optional()
    .default(false)
    .describe("When true, fetch all pages. Default false to keep responses small for MCP clients."),
};

// Bank fees: date filters to avoid loading all fees (e.g. daily agent needs only yesterday)
const bankFeesSchema = {
  ...paginationSchema,
  chargedFrom: z
    .string()
    .optional()
    .describe("Filter fees charged from this date (ISO 8601, e.g. YYYY-MM-DD). Use to limit scope (e.g. yesterday)."),
  chargedTo: z
    .string()
    .optional()
    .describe("Filter fees charged until this date (ISO 8601, e.g. YYYY-MM-DD)."),
  filters: filtersSchema,
};

// Specific schema for settlements with dedicated parameters
const settlementsSchema = {
  ...paginationSchema,
  type: z.string().optional().describe("Filter settlements by type."),
  state: z
    .string()
    .optional()
    .describe(
      "Filter settlements by state. Valid values: 'processing', 'completed', 'failed', 'pending'."
    ),
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


const dateYMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// Public API payables snapshot query (publicPayableQuerySchema)
const payablesSnapshotSchema = {
  bookkeepingStatus: z
    .array(z.string())
    .optional()
    .describe(
      "Filter payables by bookkeeping status(es). Valid values: 'created', 'prepared', 'exported'."
    ),
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
    .describe("Sort field (e.g. payableDate)."),
  sortOrder: z
    .enum(["asc", "desc"])
    .optional()
    .describe("Sort order. Valid values: 'asc', 'desc'."),
  fromPayableDate: dateYMD.optional().describe("Period start date (YYYY-MM-DD). Requires toPayableDate; max 31 days range."),
  toPayableDate: dateYMD.optional().describe("Period end date (YYYY-MM-DD). Required when fromPayableDate is set."),
  createdFrom: dateYMD.optional().describe("Period start for creation date (YYYY-MM-DD)."),
  createdTo: dateYMD.optional().describe("Period end for creation date (YYYY-MM-DD), end of day (T23:59:59)."),
  updatedFrom: dateYMD.optional().describe("Returns payables modified after this date (YYYY-MM-DD)."),
  filters: filtersSchema,
  payload: z.record(z.unknown()).optional().describe("Optional extra body fields (legacy: { from, to } are mapped to fromPayableDate, toPayableDate)."),
};

/** Args for spendesk_get_purchase_orders — matches GET /v1/purchase-orders query (see developer.spendesk.com reference). */
const purchaseOrdersListSchema = {
  perPage: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Items per API request, sent as pageSize (max 30 per Public API). Default 30."),
  withItems: z.boolean().optional().describe("Include line items on each PO in the list (query withItems)."),
  supplierIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Filter by supplier ID(s); string or array (comma-separated when sent)."),
  supplierId: z.string().optional().describe("Single supplier id (convenience; becomes supplierIds)."),
  status: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Filter by status: open | closed | cancelled (string or array)."),
  companyIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Filter by company ID(s)."),
  createdFrom: dateYMD.optional().describe("PO created on or after (YYYY-MM-DD)."),
  createdTo: dateYMD.optional().describe("PO created on or before (YYYY-MM-DD)."),
  startDateFrom: dateYMD.optional().describe("PO startDate on or after (YYYY-MM-DD)."),
  startDateTo: dateYMD.optional().describe("PO startDate on or before (YYYY-MM-DD)."),
  endDateFrom: dateYMD.optional().describe("PO endDate on or after (YYYY-MM-DD)."),
  endDateTo: dateYMD.optional().describe("PO endDate on or before (YYYY-MM-DD)."),
  from: dateYMD.optional().describe("Alias for createdFrom."),
  to: dateYMD.optional().describe("Alias for createdTo."),
  state: z.string().optional().describe("Optional legacy query param forwarded as state if set."),
  userId: z.string().optional().describe("Optional query param forwarded as userId if set."),
  ids: z.union([z.string(), z.array(z.string())]).optional().describe("Optional legacy ids filter."),
  filters: filtersSchema,
};

/** Pagination query params; Spendesk Public API uses camelCase (page, perPage). */
function paginate(args: { page?: number; perPage?: number }): Record<string, string> {
  const p: Record<string, string> = {};
  if (args.page != null) p.page = String(args.page);
  if (args.perPage != null) p.perPage = String(args.perPage);
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
 * Build query params for GET /v1/snapshots/payables/:key.
 * Supports page (1-based), perPage (max 100), and filters merged as camelCase.
 */
function buildGetPayablesSnapshotParams(args: {
  page?: number;
  perPage?: number;
  filters?: Record<string, unknown>;
}): Record<string, string> {
  const params = paginate(args);
  if (args.filters) {
    for (const [key, value] of Object.entries(args.filters)) {
      if (value != null && params[key] === undefined) params[key] = String(value);
    }
  }
  return params;
}

/** Comma-separate list query values (Public API often accepts string or array). */
function poQueryList(value: string | string[] | undefined): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value.join(",") : String(value);
}

/**
 * Build query params for GET /v1/purchase-orders (see Spendesk OpenAPI).
 * Pagination keys page / pageSize are normally added by fetchAllPages, not here.
 */
function buildPurchaseOrdersQueryParams(args: {
  withItems?: boolean;
  supplierIds?: string | string[];
  supplierId?: string;
  status?: string | string[];
  state?: string;
  companyIds?: string | string[];
  userId?: string;
  from?: string;
  to?: string;
  createdFrom?: string;
  createdTo?: string;
  startDateFrom?: string;
  startDateTo?: string;
  endDateFrom?: string;
  endDateTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  ids?: string | string[];
  filters?: Record<string, unknown>;
}): Record<string, string> {
  const params: Record<string, string> = {};

  if (args.withItems != null) params.withItems = args.withItems ? "true" : "false";

  const supplierIds = poQueryList(args.supplierIds) ?? (args.supplierId != null ? String(args.supplierId) : undefined);
  if (supplierIds != null) params.supplierIds = supplierIds;

  const st = poQueryList(args.status);
  if (st != null) params.status = st;

  const companies = poQueryList(args.companyIds);
  if (companies != null) params.companyIds = companies;

  const cFrom = args.createdFrom ?? args.from;
  const cTo = args.createdTo ?? args.to;
  if (cFrom != null) params.createdFrom = String(cFrom);
  if (cTo != null) params.createdTo = String(cTo);

  if (args.startDateFrom != null) params.startDateFrom = String(args.startDateFrom);
  if (args.startDateTo != null) params.startDateTo = String(args.startDateTo);
  if (args.endDateFrom != null) params.endDateFrom = String(args.endDateFrom);
  if (args.endDateTo != null) params.endDateTo = String(args.endDateTo);

  if (args.state != null) params.state = String(args.state);
  if (args.userId != null) params.userId = String(args.userId);
  if (args.updatedFrom != null) params.updatedFrom = String(args.updatedFrom);
  if (args.updatedTo != null) params.updatedTo = String(args.updatedTo);

  if (args.ids != null) {
    params.ids = Array.isArray(args.ids) ? args.ids.join(",") : String(args.ids);
  }

  if (args.filters) {
    for (const [key, value] of Object.entries(args.filters)) {
      if (value == null || params[key] !== undefined) continue;
      if (Array.isArray(value)) params[key] = value.map(String).join(",");
      else params[key] = String(value);
    }
  }

  return params;
}

/**
 * Build query params for suppliers list.
 * Spendesk expects pageSize (not perPage) and supports dedicated supplier filters.
 */
function buildSuppliersQueryParams(args: {
  page?: number;
  perPage?: number;
  filters?: Record<string, unknown>;
  supplierFilters?: {
    ids?: string | string[];
    updatedBefore?: string;
    updatedAfter?: string;
    createdBefore?: string;
    createdAfter?: string;
    bankCountry?: string;
    iban?: string;
    vatNumber?: string;
    isArchived?: boolean;
  };
}): Record<string, string> {
  const params: Record<string, string> = {};
  if (args.page != null) params.page = String(args.page);
  if (args.perPage != null) params.pageSize = String(args.perPage);

  const sf = args.supplierFilters;
  if (sf) {
    if (sf.ids != null) {
      params.ids = Array.isArray(sf.ids) ? sf.ids.join(",") : String(sf.ids);
    }
    if (sf.updatedBefore != null) params.updatedBefore = String(sf.updatedBefore);
    if (sf.updatedAfter != null) params.updatedAfter = String(sf.updatedAfter);
    if (sf.createdBefore != null) params.createdBefore = String(sf.createdBefore);
    if (sf.createdAfter != null) params.createdAfter = String(sf.createdAfter);
    if (sf.bankCountry != null) params.bankCountry = String(sf.bankCountry);
    if (sf.iban != null) params.iban = String(sf.iban);
    if (sf.vatNumber != null) params.vatNumber = String(sf.vatNumber);
    if (sf.isArchived != null) params.isArchived = String(sf.isArchived);
  }

  if (args.filters) {
    for (const [key, value] of Object.entries(args.filters)) {
      if (value != null && params[key] === undefined) {
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
  const query: Record<string, unknown> = {};

  // Explicit tool parameters → nested under "query" (API expects body.query)
  if (args.bookkeepingStatus != null && args.bookkeepingStatus.length > 0) {
    query.bookkeepingStatus = args.bookkeepingStatus;
  }
  if (args.exportedAfter != null) query.exportedAfter = args.exportedAfter;
  if (args.ids != null) {
    query.ids = Array.isArray(args.ids) ? args.ids : [args.ids];
  }
  if (args.sortBy != null) query.sortBy = args.sortBy;
  if (args.sortOrder != null) query.sortOrder = args.sortOrder;
  if (args.fromPayableDate != null) query.fromPayableDate = args.fromPayableDate;
  if (args.toPayableDate != null) query.toPayableDate = args.toPayableDate;
  if (args.createdFrom != null) query.createdFrom = args.createdFrom;
  if (args.createdTo != null) query.createdTo = args.createdTo;
  if (args.updatedFrom != null) query.updatedFrom = args.updatedFrom;

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
        if (value != null && query[key] === undefined) {
          if (key === "ids" && !Array.isArray(value)) {
            query.ids = [value as string];
          } else {
            query[key] = value;
          }
        }
      }
    }

    // Legacy: payload.{from,to} → fromPayableDate/toPayableDate
    if (p.from != null && query.fromPayableDate === undefined) {
      query.fromPayableDate = p.from;
    }
    if (p.to != null && query.toPayableDate === undefined) {
      query.toPayableDate = p.to;
    }

  // If only fromPayableDate is set, mirror it into toPayableDate to satisfy the API constraint.
    if (query.fromPayableDate != null && query.toPayableDate === undefined) {
      query.toPayableDate = query.fromPayableDate;
    }

    // Any other keys in payload are ignored on purpose to avoid sending
    // additional properties that the Public API would reject.
  }

  // Spendesk Public API snapshot payload is expected as a flat JSON object (no wrapper),
  // e.g. { "fromPayableDate": "...", "toPayableDate": "..." }.
  return Object.keys(query).length > 0 ? query : {};
}

export function registerTools(mcp: McpServer, api: SpendeskClient): void {
  const run = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const start = Date.now();
    let status: "success" | "error" = "success";
    let errorCode: string | null = null;
    try {
      let result: unknown;
      switch (name) {
      case "spendesk_get_settlements": {
        const settlementParams = buildSettlementsQueryParams(args as {
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
        });
        const { page: _p1, perPage: _pp1, ...baseSettlement } = settlementParams;
        return fetchAllPages(api, SpendeskPaths.getSettlements, baseSettlement, {
          listKey: "settlements",
        });
      }
      case "spendesk_update_settlement_state":
        return api.put(SpendeskPaths.updateSettlementState(args.settlementId as string), { state: args.state });
      case "spendesk_get_bank_fees": {
        const base = buildQueryParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> });
        const chargedFrom = (args as { chargedFrom?: string }).chargedFrom;
        const chargedTo = (args as { chargedTo?: string }).chargedTo;
        if (chargedFrom) base.chargedFrom = chargedFrom;
        if (chargedTo) base.chargedTo = chargedTo;
        return api.get(SpendeskPaths.getBankFees, base);
      }
      case "spendesk_create_payables_snapshot": {
        const flatBody = buildPayablesSnapshotPayload(
          args as Parameters<typeof buildPayablesSnapshotPayload>[0]
        );
        const wrappedBody = Object.keys(flatBody).length > 0 ? { query: flatBody } : {};

        // Try flat first (demo schema is picky). If it fails with "additional properties",
        // retry wrapped format for compatibility with other hosts.
        try {
          return await api.post(SpendeskPaths.createPayablesSnapshot, flatBody);
        } catch (err) {
          const e = err as { statusCode?: number; body?: unknown; message?: string };
          const bodyJson = e.body as
            | { errors?: Array<{ detail?: string; source?: string }> }
            | undefined;
          const detail = bodyJson?.errors?.[0]?.detail;
          const isAdditionalProperties =
            typeof detail === "string" && detail.toLowerCase().includes("additional properties");

          if (e.statusCode === 400 && isAdditionalProperties && wrappedBody && Object.keys(wrappedBody).length > 0) {
            return await api.post(SpendeskPaths.createPayablesSnapshot, wrappedBody);
          }

          if (e.statusCode && e.body) {
            throw new Error(`${e.message ?? "Spendesk API error"} — body: ${JSON.stringify(e.body)}`);
          }
          throw err;
        }
      }
      case "spendesk_get_payables_snapshot":
        return api.get(
          SpendeskPaths.getPayablesSnapshot(args.snapshotId as string),
          buildGetPayablesSnapshotParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> })
        );
      case "spendesk_get_payable":
        return api.get(SpendeskPaths.getPayableById(args.payableId as string));
      case "spendesk_get_payable_attachments":
        return api.get(SpendeskPaths.getPayableAttachments(args.payableId as string));
      case "spendesk_update_payable_bookkeeping": {
        // API has no path param: PUT /v1/payables/bookkeeping-status with body { payableId, ...payload }
        const payload = (args.payload as Record<string, unknown>) ?? {};
        return api.put(SpendeskPaths.updatePayableBookkeeping, {
          payableId: args.payableId,
          ...payload,
        });
      }
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

      case "spendesk_get_suppliers": {
        const supplierParams = buildSuppliersQueryParams(args as {
          page?: number;
          perPage?: number;
          filters?: Record<string, unknown>;
          fetchAll?: boolean;
          supplierFilters?: {
            ids?: string | string[];
            updatedBefore?: string;
            updatedAfter?: string;
            createdBefore?: string;
            createdAfter?: string;
            bankCountry?: string;
            iban?: string;
            vatNumber?: string;
            isArchived?: boolean;
          };
        });
        const fetchAll = (args as { fetchAll?: boolean }).fetchAll === true;
        if (!fetchAll) {
          return api.get(SpendeskPaths.getSuppliers, supplierParams);
        }

        const { page: _p2, pageSize: _ps2, ...baseSupplier } = supplierParams;
        const requestedPerPage = Math.min(30, Math.max(1, Number((args as { perPage?: number }).perPage ?? 30)));
        return fetchAllPages(api, SpendeskPaths.getSuppliers, baseSupplier, {
          listKey: "suppliers",
          requestedPerPage,
          pageSizeParam: "pageSize",
        });
      }
      case "spendesk_get_supplier":
        return api.get(SpendeskPaths.getSupplierById(args.supplierId as string));
      case "spendesk_create_suppliers":
        return api.post(SpendeskPaths.createSuppliers, args.payload);
      case "spendesk_update_supplier":
        return api.patch(SpendeskPaths.updateSupplier(args.supplierId as string), args.payload);
      case "spendesk_update_suppliers":
        return api.patch(SpendeskPaths.updateSuppliers, args.payload);
      case "spendesk_set_supplier_archive_status":
        return api.patch(SpendeskPaths.updateSupplierArchiveStatus(args.supplierId as string), {
          isArchived: args.isArchived,
        });
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

      case "spendesk_get_purchase_orders": {
        const perPage = Math.min(30, Math.max(1, Number(args.perPage ?? 30)));
        const query = buildPurchaseOrdersQueryParams(
          args as {
            withItems?: boolean;
            supplierIds?: string | string[];
            supplierId?: string;
            status?: string | string[];
            companyIds?: string | string[];
            createdFrom?: string;
            createdTo?: string;
            startDateFrom?: string;
            startDateTo?: string;
            endDateFrom?: string;
            endDateTo?: string;
            from?: string;
            to?: string;
            state?: string;
            userId?: string;
            ids?: string | string[];
            filters?: Record<string, unknown>;
          }
        );
        return fetchAllPages(api, SpendeskPaths.getPurchaseOrders, query, {
          listKey: "purchaseOrders",
          requestedPerPage: perPage,
          pageSizeParam: "pageSize",
        });
      }
      case "spendesk_create_purchase_order":
        return api.post(SpendeskPaths.createPurchaseOrder, args.payload);

      case "spendesk_get_purchase_order": {
        const id = String(args.purchaseOrderId ?? "").trim();
        const withItems = args.withItems === true ? "true" : "false";
        return api.get(SpendeskPaths.getPurchaseOrderById(id), { withItems });
      }
      case "spendesk_cancel_purchase_order": {
        const id = String(args.purchaseOrderId ?? "").trim();
        const withItems = args.withItems === true ? "true" : "false";
        const path = `${SpendeskPaths.cancelPurchaseOrder(id)}?withItems=${withItems}`;
        return api.post(path, {});
      }
      case "spendesk_close_purchase_order": {
        const id = String(args.purchaseOrderId ?? "").trim();
        const withItems = args.withItems === true ? "true" : "false";
        const path = `${SpendeskPaths.closePurchaseOrder(id)}?withItems=${withItems}`;
        return api.post(path, {});
      }

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
        const basePo = buildPurchaseOrdersQueryParams({ from, to });
        const { data: purchaseOrders } = await fetchAllPages(
          api,
          SpendeskPaths.getPurchaseOrders,
          basePo,
          { listKey: "purchaseOrders", pageSizeParam: "pageSize", requestedPerPage: 30 }
        );
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
        result = { period: { from, to }, purchaseOrders, payables: payables.map((p) => p.raw), bySupplier };
        break;
      }

      case "spendesk_analyze_spend":
        result = await analyzeSpend(api, {
          from: String(args.from),
          to: String(args.to),
          groupBy: args.groupBy as AnalyzeSpendParams["groupBy"],
          analyticalFieldName: args.analyticalFieldName as string | undefined,
          limit: args.limit != null ? Number(args.limit) : 10,
          excludeCredits: args.excludeCredits !== false,
          filters: args.filters as AnalyzeSpendFilters | undefined,
          includeDetails: args.includeDetails === true,
        });
        break;
      case "spendesk_get_bookkeeping_pipeline":
        result = await getBookkeepingPipeline(api, {
          from: String(args.from),
          to: String(args.to),
          status: args.status as "created" | "prepared" | "exported" | undefined,
          includeVatBreakdown: args.includeVatBreakdown === true,
          includeJournalEntries: args.includeJournalEntries === true,
        });
        break;
      case "spendesk_get_payment_status":
        result = await getPaymentStatus(api, {
          from: String(args.from),
          to: String(args.to),
          status: args.status as "paid" | "unpaid" | "partial" | undefined,
          currency: args.currency as string | undefined,
          payableType: args.payableType as string | undefined,
        });
        break;
      case "spendesk_get_ap_aging":
        result = await getApAging(api, {
          asOfDate: args.asOfDate as string | undefined,
          includeUpcoming: args.includeUpcoming === true,
        });
        break;
      case "spendesk_get_cash_flow_forecast":
        result = await getCashFlowForecast(api, {
          days: args.days != null ? Number(args.days) : 30,
          groupBy: (args.groupBy as "day" | "week" | "supplier") ?? "week",
          asOfDate: args.asOfDate as string | undefined,
        });
        break;
      case "spendesk_get_cash_position":
        result = await getCashPosition(api, {
          asOfDate: args.asOfDate as string | undefined,
        });
        break;
      case "spendesk_get_accruals":
        result = await getAccruals(api, {
          asOfDate: String(args.asOfDate),
          prorateByServicePeriod: args.prorateByServicePeriod as boolean | undefined,
        });
        break;
      case "spendesk_get_filter_options":
        result = {
          payableType: [
            "invoicePurchase",
            "subscriptionCard",
            "singlePurchaseCard",
            "physicalCard",
            "multiUseCard",
            "expenseClaim",
            "mileageAllowance",
            "perDiem",
          ],
          bookkeepingStatus: ["created", "prepared", "exported"],
          settlementState: ["processing", "completed", "failed", "pending"],
          counterpartyType: ["supplier", "employee"],
          sortOrder: ["asc", "desc"],
          groupBy: [
            "supplier",
            "costCenter",
            "analyticalField",
            "payableType",
            "expenseAccount",
            "employee",
            "currency",
            "bookkeepingStatus",
            "month",
            "paymentStatus",
            "country",
          ],
          paymentStatus: ["paid", "unpaid", "partial"],
          tips: "Use these values when calling spendesk_analyze_spend, spendesk_get_settlements, spendesk_get_bookkeeping_pipeline, or spendesk_get_payment_status. If a filter returns 0 results, verify the value is in this list and try discovery tools (e.g. spendesk_get_cost_centers, spendesk_get_suppliers) for exact names.",
        };
        break;
      case "spendesk_load_sqlite_data": {
        const dataset = args.dataset as LoadDataset;
        const fromDate = args.from_date as string | undefined;
        const toDate = args.to_date as string | undefined;
        result = await loadDataset(api, dataset, fromDate, toDate);
        break;
      }
      case "spendesk_execute_sql_query": {
        const sql = String(args.sql ?? "").trim();
        result = executeQuery(api, sql);
        break;
      }
      case "spendesk_list_loaded_tables":
        result = listLoadedTables(api);
        break;
      case "spendesk_clear_sqlite_tables": {
        const tableNames = args.table_names as string[] | undefined;
        result = clearTables(api, tableNames);
        break;
      }
      case "spendesk_get_api_reference": {
        const mcpTool = args.mcpTool as string | undefined;
        const path = args.path as string | undefined;
        result = getApiReference(mcpTool ? { mcpTool } : path ? { path } : undefined);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
      }

      const durationMs = Date.now() - start;
      let resultSize: number | null = null;
      try {
        if (typeof result === "string") {
          resultSize = result.length;
        } else if (Array.isArray(result)) {
          resultSize = result.length;
        } else if (result && typeof result === "object") {
          const json = JSON.stringify(result);
          resultSize = json.length;
        }
      } catch {
        resultSize = null;
      }

      const category = TOOL_CATEGORY[name] ?? "other";
      const meta: Record<string, unknown> = {};
      if ("from" in args || "to" in args) {
        meta.from = (args as { from?: unknown }).from;
        meta.to = (args as { to?: unknown }).to;
      }
      if ("groupBy" in args) {
        meta.groupBy = (args as { groupBy?: unknown }).groupBy;
      }

      logToolCallUsage({
        toolName: name,
        category,
        durationMs,
        status,
        errorCode,
        resultSize: resultSize ?? undefined,
        meta: Object.keys(meta).length ? meta : undefined,
      });

      return result;
    } catch (err) {
      status = "error";
      errorCode = err instanceof Error ? err.name || err.message : "UnknownError";
      const durationMs = Date.now() - start;

      logToolCallUsage({
        toolName: name,
        category: TOOL_CATEGORY[name] ?? "other",
        durationMs,
        status,
        errorCode,
        resultSize: null,
        meta: {
          message: err instanceof Error ? err.message : String(err),
        },
      });

      throw err;
    }
  };

  const toContent = (result: unknown) => ({
    content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
  });

  /** Register tool only if enabled in config/tools.config.json (disabled tools are hidden from API reference). */
  const maybeReg = (name: string, fn: () => void) => {
    if (isToolEnabled(name)) fn();
  };

  // —— Spend Data ———————————————————————————————————————————————————————————
  maybeReg("spendesk_get_settlements", () =>
    mcp.tool(
      "spendesk_get_settlements",
      [
        "Get full settlements list (all pages). Params: type, state (valid: 'processing', 'completed', 'failed', 'pending'), paidFrom, clearedFrom, clearedTo, exportedAfter, ids, and 'filters' (camelCase).",
        "Returns { data: [...], meta: { pagination: { total, pageSize } } }. For financial analysis prefer spendesk_analyze_spend.",
        "IMPORTANT - When 0 results with a state filter: call spendesk_get_filter_options to confirm valid state values, then try without the state filter to inspect a sample and verify data exists for the period.",
      ].join(" "),
      settlementsSchema,
      async (args) => toContent(await run("spendesk_get_settlements", args))
    )
  );
  maybeReg("spendesk_update_settlement_state", () =>
    mcp.tool(
      "spendesk_update_settlement_state",
      "Update a settlement state (e.g. for workflow automation).",
      {
        settlementId: z.string().describe("Settlement ID"),
        state: z.string().describe("New state value"),
      },
      async (args) => toContent(await run("spendesk_update_settlement_state", args))
    )
  );
  maybeReg("spendesk_get_bank_fees", () =>
    mcp.tool(
      "spendesk_get_bank_fees",
      "Get bank fees. Useful for accounting and dashboards. Prefer chargedFrom/chargedTo (ISO 8601) to limit scope (e.g. yesterday's fees). Use 'filters' for any other API query parameters.",
      bankFeesSchema,
      async (args) => toContent(await run("spendesk_get_bank_fees", args))
    )
  );
  maybeReg("spendesk_create_payables_snapshot", () =>
    mcp.tool(
      "spendesk_create_payables_snapshot",
      "Create a snapshot of payables (invoices, credit notes, etc.). Uses Public API filters: bookkeepingStatus, exportedAfter, ids, sortBy, sortOrder, fromPayableDate (requires toPayableDate, max 31 days), toPayableDate, createdFrom, createdTo, updatedFrom. Use 'filters' for any extra query params.",
      payablesSnapshotSchema,
      async (args) => toContent(await run("spendesk_create_payables_snapshot", args))
    )
  );
  const getPayablesSnapshotSchema = {
    snapshotId: z.string().describe("Snapshot ID (or key returned by create snapshot)."),
    page: z.number().int().min(1).optional().default(1).describe("Page number (1-based)."),
    perPage: z.number().int().min(1).max(100).optional().default(30).describe("Items per page (max 100)."),
    filters: filtersSchema,
  };
  maybeReg("spendesk_get_payables_snapshot", () =>
    mcp.tool(
      "spendesk_get_payables_snapshot",
      "Get a payables snapshot by ID. Supports pagination: page (default 1), perPage (default 30, max 100). Use filters for any extra query params (camelCase). Note: for financial analysis prefer spendesk_analyze_spend, spendesk_get_bookkeeping_pipeline, or other composite tools.",
      getPayablesSnapshotSchema,
      async (args) => toContent(await run("spendesk_get_payables_snapshot", args))
    )
  );
  maybeReg("spendesk_get_payable", () =>
    mcp.tool(
      "spendesk_get_payable",
      "Get a single payable by ID (invoice, expense, etc.).",
      { payableId: z.string().describe("Payable ID") },
      async (args) => toContent(await run("spendesk_get_payable", args))
    )
  );
  maybeReg("spendesk_get_payable_attachments", () =>
    mcp.tool(
      "spendesk_get_payable_attachments",
      "Get attachments for a payable.",
      { payableId: z.string().describe("Payable ID") },
      async (args) => toContent(await run("spendesk_get_payable_attachments", args))
    )
  );
  maybeReg("spendesk_update_payable_bookkeeping", () =>
    mcp.tool(
      "spendesk_update_payable_bookkeeping",
    "Update bookkeeping status of a payable (ERP sync). API: PUT /v1/payables/bookkeeping-status (no path param); body = { payableId, ...payload } e.g. { payableId, bookkeepingStatus: 'exported' }.",
    {
      payableId: z.string().describe("Payable ID (sent in body)."),
      payload: z.record(z.unknown()).describe("Fields merged into body, e.g. { bookkeepingStatus: 'exported' }."),
    },
      async (args) => toContent(await run("spendesk_update_payable_bookkeeping", args))
    )
  );

  // —— Report (key answers) ———————————————————————————————————————————————————
  maybeReg("spendesk_get_spend_dashboard", () =>
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
    )
  );
  maybeReg("spendesk_get_top_suppliers_by_spend", () =>
    mcp.tool(
      "spendesk_get_top_suppliers_by_spend",
    "Use when the user asks for top N suppliers by spend for a period, with associated payables or settlements. Returns ranked list with details.",
    {
      from: z.string().describe("Start date ISO (e.g. 2026-01-01)"),
      to: z.string().describe("End date ISO (e.g. 2026-03-31)"),
      limit: z.number().min(1).max(100).optional().describe("Number of top suppliers (default 10)"),
    },
      async (args) => toContent(await run("spendesk_get_top_suppliers_by_spend", args))
    )
  );
  maybeReg("spendesk_get_purchase_orders_and_payables_export", () =>
    mcp.tool(
      "spendesk_get_purchase_orders_and_payables_export",
    "Use when the user asks for an export of all purchase orders created in a period with their associated payables. POs are listed via GET /v1/purchase-orders with createdFrom/createdTo; other list filters: https://developer.spendesk.com/reference/v1-get-purchase-orders — returns POs and payables linked by supplier.",
    {
      from: z.string().describe("Start date ISO (e.g. 2026-01-01)"),
      to: z.string().describe("End date ISO (e.g. 2026-03-31)"),
    },
      async (args) => toContent(await run("spendesk_get_purchase_orders_and_payables_export", args))
    )
  );

  // —— Composite tools (financial analysis) —————————————————————————————————
  const analyzeSpendFiltersSchema = z
    .object({
      costCenter: z.string().optional(),
      costCenterIds: z.array(z.string()).optional(),
      supplier: z.string().optional(),
      supplierId: z.string().optional(),
      payableType: z
        .string()
        .optional()
        .describe(
          "Filter by payable type. Valid values: 'invoicePurchase', 'subscriptionCard', 'singlePurchaseCard', " +
            "'physicalCard', 'multiUseCard', 'expenseClaim', 'mileageAllowance', 'perDiem'."
        ),
      counterpartyType: z
        .enum(["supplier", "employee"])
        .optional()
        .describe("Filter by counterparty type. Valid values: 'supplier', 'employee'."),
      bookkeepingStatus: z
        .enum(["created", "prepared", "exported"])
        .optional()
        .describe("Filter by bookkeeping status. Valid values: 'created', 'prepared', 'exported'."),
      currency: z.string().optional(),
      minAmount: z.number().optional(),
      maxAmount: z.number().optional(),
      expenseAccount: z.string().optional(),
      analyticalFieldName: z.string().optional(),
      analyticalFieldValue: z.string().optional(),
    })
    .optional();
  const analyzeSpendDescription = [
    "Analyze and aggregate spending from Spendesk payables over a time period.",
    "Supports filters: costCenter, supplier, supplierId, payableType, counterpartyType (supplier|employee),",
    "bookkeepingStatus, currency, minAmount, maxAmount, expenseAccount, analyticalFieldName+analyticalFieldValue.",
    "groupBy options: supplier | costCenter | analyticalField | payableType | expenseAccount | employee | currency |",
    "bookkeepingStatus | month | paymentStatus | country.",
    "",
    "Examples:",
    "- Subscription card spend by supplier (Jan 2026): groupBy: \"supplier\", filters: { payableType: \"subscriptionCard\" }, from: \"2026-01-01\", to: \"2026-01-31\"",
    "- Top 10 suppliers for a cost center: groupBy: \"supplier\", filters: { costCenter: \"Engineering\" }",
    "- Monthly spend trend: groupBy: \"month\"",
    "- Spend not yet exported to accounting: groupBy: \"supplier\", filters: { bookkeepingStatus: \"created\" }",
    "- Employee expense claims: groupBy: \"employee\", filters: { counterpartyType: \"employee\" }",
    "- USD-denominated spend: groupBy: \"currency\", filters: { currency: \"USD\" }",
    "",
    "IMPORTANT - When results are empty or unexpected:",
    "1. If 0 results with a payableType filter → call spendesk_get_filter_options to get valid values, then retry.",
    "2. If 0 results with a costCenter filter → call spendesk_get_cost_centers to list exact cost center names (case-sensitive), then retry.",
    "3. If 0 results with a supplier filter → call spendesk_get_suppliers to find the exact supplier name, then retry.",
    "4. Never give up after a single 0-result response — always attempt discovery first.",
    "",
    "Use includeDetails: true for up to 10 payables per group."
  ].join(" ");

  maybeReg("spendesk_analyze_spend", () =>
    mcp.tool(
      "spendesk_analyze_spend",
      analyzeSpendDescription,
      {
        from: z.string().describe("Start date ISO 8601 e.g. 2026-01-01"),
        to: z.string().describe("End date ISO 8601 e.g. 2026-03-31"),
        groupBy: z
          .enum([
            "supplier",
            "costCenter",
            "analyticalField",
            "payableType",
            "expenseAccount",
            "employee",
            "currency",
            "bookkeepingStatus",
            "month",
            "paymentStatus",
            "country",
          ])
          .describe("Group results by this dimension"),
        analyticalFieldName: z.string().optional().describe("Required when groupBy is analyticalField"),
        limit: z.number().int().min(1).max(100).optional().default(10).describe("Number of results to return"),
        excludeCredits: z.boolean().optional().default(true).describe("Exclude refunds and credit notes"),
        filters: analyzeSpendFiltersSchema.describe(
          "Optional filters applied before aggregation (AND logic). Call spendesk_get_filter_options for valid enum values."
        ),
        includeDetails: z.boolean().optional().default(false).describe("Include up to 10 payables per group in results"),
      },
      async (args) => toContent(await run("spendesk_analyze_spend", args))
    )
  );
  maybeReg("spendesk_get_bookkeeping_pipeline", () =>
    mcp.tool(
      "spendesk_get_bookkeeping_pipeline",
      [
        "Use this to track the accounting/bookkeeping pipeline in Spendesk. Returns payables filtered by bookkeeping status (valid: 'created', 'prepared', 'exported').",
        "Use for: which invoices are not yet exported to accounting?, show me the VAT breakdown by rate, generate a journal entry list, what is pending for month-end close?",
        "IMPORTANT - To see valid status values call spendesk_get_filter_options. To understand the distribution of payables by bookkeeping status, use spendesk_analyze_spend with groupBy: 'bookkeepingStatus'.",
      ].join(" "),
      {
      from: z.string().describe("Start date ISO 8601"),
      to: z.string().describe("End date ISO 8601"),
      status: z
        .enum(["created", "prepared", "exported"])
        .optional()
        .describe(
          "Filter by bookkeeping status; if omitted returns all. Valid values: 'created', 'prepared', 'exported'."
        ),
      includeVatBreakdown: z.boolean().optional().default(false),
      includeJournalEntries: z.boolean().optional().default(false),
    },
      async (args) => toContent(await run("spendesk_get_bookkeeping_pipeline", args))
    )
  );
  maybeReg("spendesk_get_payment_status", () =>
    mcp.tool(
      "spendesk_get_payment_status",
    "Use this to check the payment status of invoices (paid, unpaid, partially paid). Also returns multi-currency exposure. Use for: which invoices are still unpaid?, show me partially paid invoices, what is our USD/GBP exposure this month?, reconcile payments with invoices.",
    {
      from: z.string().describe("Start date ISO 8601"),
      to: z.string().describe("End date ISO 8601"),
      status: z
        .enum(["paid", "unpaid", "partial"])
        .optional()
        .describe(
          "Filter by payment status. Valid values: 'paid', 'unpaid', 'partial'."
        ),
      currency: z.string().optional().describe("Filter by original currency e.g. USD, GBP"),
      payableType: z
        .string()
        .optional()
        .describe(
          "Filter by payable type. Valid values include: 'invoicePurchase', 'subscriptionCard', 'singlePurchaseCard', 'physicalCard', 'multiUseCard', 'expenseClaim', 'mileageAllowance', 'perDiem'."
        ),
    },
      async (args) => toContent(await run("spendesk_get_payment_status", args))
    )
  );
  maybeReg("spendesk_get_ap_aging", () =>
    mcp.tool(
      "spendesk_get_ap_aging",
    "Use this for AP aging analysis — shows overdue and upcoming invoice payments. Use for: show me overdue invoices, AP aging report, which suppliers are we most overdue with?, what invoices are 30/60/90 days overdue?, calculate our DPO.",
    {
      asOfDate: z.string().optional().describe("Reference date for aging (default: today) YYYY-MM-DD"),
      includeUpcoming: z.boolean().optional().default(false).describe("Also show not-yet-due unpaid invoices"),
    },
      async (args) => toContent(await run("spendesk_get_ap_aging", args))
    )
  );
  maybeReg("spendesk_get_cash_flow_forecast", () =>
    mcp.tool(
      "spendesk_get_cash_flow_forecast",
    "Use this to forecast upcoming cash outflows based on unpaid invoices with known due dates. Use for: what payments are due in the next 30 days?, cash flow forecast for next month, upcoming disbursements by week, treasury planning.",
    {
      days: z.number().int().min(1).max(365).optional().default(30).describe("Forecast horizon in days"),
      groupBy: z.enum(["day", "week", "supplier"]).optional().default("week"),
      asOfDate: z.string().optional().describe("Reference date (default: today) YYYY-MM-DD"),
    },
      async (args) => toContent(await run("spendesk_get_cash_flow_forecast", args))
    )
  );
  maybeReg("spendesk_get_cash_position", () =>
    mcp.tool(
      "spendesk_get_cash_position",
    "Consolidated cash obligations dashboard: overdue, due today, due next 7/30 days, total outstanding EUR, and top urgent payments. Single call for CFO/treasurer view. Combines AP aging and cash flow forecast.",
    {
      asOfDate: z.string().optional().describe("Reference date (default: today) YYYY-MM-DD"),
    },
      async (args) => toContent(await run("spendesk_get_cash_position", args))
    )
  );
  maybeReg("spendesk_get_accruals", () =>
    mcp.tool(
      "spendesk_get_accruals",
    "Month/year-end close: accruals from open POs (status open or partially_received). Returns journal-entry-ready list (debit 621/expense account, credit 408000), totalAccrualEUR, and journalLines for export. Use for: year-end accruals, PO accrual report, journal entries for open POs. When prorateByServicePeriod is true (default), accrual amount is prorated by the PO service period (startDate–endDate) relative to asOfDate; when false, books full remaining amount.",
    {
      asOfDate: dateYMD.describe("Reference date for accrual (e.g. 2026-12-31) YYYY-MM-DD"),
      prorateByServicePeriod: z
        .boolean()
        .optional()
        .default(true)
        .describe("When true (default), accrual is prorated by PO service period (startDate–endDate) vs asOfDate. When false, book full remaining amount."),
    },
      async (args) => toContent(await run("spendesk_get_accruals", args))
    )
  );

  maybeReg("spendesk_get_wallet_loads", () =>
    mcp.tool(
      "spendesk_get_wallet_loads",
    "Get wallet loads (card top-ups, etc.). Use 'filters' to pass any API query parameters.",
    listSchema,
      async (args) => toContent(await run("spendesk_get_wallet_loads", args))
    )
  );
  maybeReg("spendesk_get_wallet_summary", () =>
    mcp.tool("spendesk_get_wallet_summary", "Get wallet summary for dashboards.", {}, async () =>
      toContent(await run("spendesk_get_wallet_summary", {}))
    )
  );

  // —— Analytical —————————————————————————————————————————————————──────────
  maybeReg("spendesk_get_analytical_fields", () =>
    mcp.tool("spendesk_get_analytical_fields", "Get analytical (custom) fields for reporting.", {}, async () =>
      toContent(await run("spendesk_get_analytical_fields", {}))
    )
  );
  maybeReg("spendesk_get_analytical_values", () =>
    mcp.tool(
      "spendesk_get_analytical_values",
    "Get analytical values for a given field. Call spendesk_get_analytical_fields first to get field ids. Use 'filters' to pass any API query parameters.",
    {
      fieldId: z.string().describe("Analytical field id (from spendesk_get_analytical_fields)"),
      ...listSchema,
    },
      async (args) => toContent(await run("spendesk_get_analytical_values", args))
    )
  );
  maybeReg("spendesk_get_filter_options", () =>
    mcp.tool(
      "spendesk_get_filter_options",
      "Returns all valid filter values for Spendesk MCP tools (payableType, bookkeepingStatus, settlementState, counterpartyType, sortOrder, groupBy, paymentStatus). Call this when a filter returns 0 results to verify allowed values, or to discover which filters are available before calling spendesk_analyze_spend, spendesk_get_settlements, or spendesk_get_bookkeeping_pipeline.",
      {},
      async () => toContent(await run("spendesk_get_filter_options", {}))
    )
  );

  // —— Ephemeral SQLite Analytics (Ramp-style) —————————————————————————————————
  const loadSqliteDataDesc = [
    "Use this tool when you need to run SQL analytics on Spendesk data (e.g. top suppliers by spend, spend by cost center, overdue invoices).",
    "Do NOT use when you only need a simple list — prefer spendesk_get_settlements or spendesk_analyze_spend for that.",
    "Parameters: dataset (required): 'payables' | 'settlements' | 'suppliers' | 'purchase_orders'. from_date (optional): ISO date YYYY-MM-DD. to_date (optional): ISO date YYYY-MM-DD. Payables require both dates; settlements and purchase_orders use them for cleared/created range.",
    "Example: spendesk_load_sqlite_data(dataset='payables', from_date='2026-01-01', to_date='2026-03-31') → loads Q1 2026 payables. Then use spendesk_execute_sql_query to analyze.",
    "Fallback: if row count is 0, verify the date range and call spendesk_list_loaded_tables to confirm the table exists.",
  ].join(" ");
  maybeReg("spendesk_load_sqlite_data", () =>
    mcp.tool(
      "spendesk_load_sqlite_data",
      loadSqliteDataDesc,
      {
        dataset: z
          .enum(["payables", "settlements", "suppliers", "purchase_orders"])
          .describe("Dataset to load. Valid values: 'payables', 'settlements', 'suppliers', 'purchase_orders'."),
        from_date: z.string().optional().describe("Start date ISO 8601 (YYYY-MM-DD). Required for payables; optional for settlements and purchase_orders."),
        to_date: z.string().optional().describe("End date ISO 8601 (YYYY-MM-DD). Required for payables; optional for settlements and purchase_orders."),
      },
      async (args) => toContent(await run("spendesk_load_sqlite_data", args))
    )
  );
  const executeSqlDesc = [
    "Use this tool when you have already loaded data with spendesk_load_sqlite_data and want to run analytical SQL (aggregations, filters, joins).",
    "Do NOT use for INSERT, UPDATE, DELETE, or DROP — only SELECT and WITH (CTE) are allowed. Results are capped at 1000 rows.",
    "Parameters: sql (required): read-only SQL string.",
    "Example: spendesk_execute_sql_query(sql=\"SELECT supplier_name, SUM(amount_eur) as total FROM payables GROUP BY supplier_name ORDER BY total DESC LIMIT 10\").",
    "Fallback: if the query fails, check table and column names with spendesk_list_loaded_tables.",
  ].join(" ");
  maybeReg("spendesk_execute_sql_query", () =>
    mcp.tool(
      "spendesk_execute_sql_query",
      executeSqlDesc,
      {
        sql: z.string().describe("Read-only SQL query (SELECT or WITH only)."),
      },
      async (args) => toContent(await run("spendesk_execute_sql_query", args))
    )
  );
  maybeReg("spendesk_list_loaded_tables", () =>
    mcp.tool(
      "spendesk_list_loaded_tables",
      [
        "Use this tool to see which tables are currently loaded in the ephemeral SQLite DB and their schema (columns + types) and row count.",
        "Call after spendesk_load_sqlite_data to confirm data, or before spendesk_execute_sql_query to know available tables and column names.",
        "No parameters. Returns all loaded tables with columns and row count.",
        "Fallback: if no tables, call spendesk_load_sqlite_data first.",
      ].join(" "),
      {},
      async () => toContent(await run("spendesk_list_loaded_tables", {}))
    )
  );
  maybeReg("spendesk_clear_sqlite_tables", () =>
    mcp.tool(
      "spendesk_clear_sqlite_tables",
      [
        "Use this tool when analysis is complete and you want to free memory by dropping loaded tables.",
        "Parameters: table_names (optional): list of table names to drop. If empty or omitted, clears all tables.",
        "Example: spendesk_clear_sqlite_tables(table_names=['payables']) or spendesk_clear_sqlite_tables() to clear all.",
      ].join(" "),
      {
        table_names: z.array(z.string()).optional().describe("Table names to drop. If empty or omitted, all tables are dropped."),
      },
      async (args) => toContent(await run("spendesk_clear_sqlite_tables", args))
    )
  );

  maybeReg("spendesk_get_cost_centers", () =>
    mcp.tool(
      "spendesk_get_cost_centers",
    "Get cost centers (for ERP mapping and reports). Use 'filters' to pass any API query parameters.",
    listSchema,
      async (args) => toContent(await run("spendesk_get_cost_centers", args))
    )
  );
  maybeReg("spendesk_get_expense_categories", () =>
    mcp.tool(
      "spendesk_get_expense_categories",
    "Get expense categories. Use 'filters' to pass any API query parameters.",
    listSchema,
      async (args) => toContent(await run("spendesk_get_expense_categories", args))
    )
  );
  maybeReg("spendesk_create_cost_center", () =>
    mcp.tool(
      "spendesk_create_cost_center",
    "Create a cost center.",
    { payload: z.record(z.unknown()).describe("Cost center body") },
      async (args) => toContent(await run("spendesk_create_cost_center", args))
    )
  );
  maybeReg("spendesk_update_cost_center", () =>
    mcp.tool(
      "spendesk_update_cost_center",
    "Update a cost center by ID.",
    {
      costCenterId: z.string(),
      payload: z.record(z.unknown()).describe("Fields to update"),
    },
      async (args) => toContent(await run("spendesk_update_cost_center", args))
    )
  );
  maybeReg("spendesk_delete_cost_center", () =>
    mcp.tool(
      "spendesk_delete_cost_center",
    "Delete a cost center by ID.",
    { costCenterId: z.string() },
      async (args) => toContent(await run("spendesk_delete_cost_center", args))
    )
  );

  // —— Accounting —————————————————————————————————————————————————──────────
  maybeReg("spendesk_get_journal_csv", () =>
    mcp.tool(
      "spendesk_get_journal_csv",
    "Get journal CSV content for an accounting export (ERP import).",
    { exportId: z.string().describe("Export ID") },
      async (args) => toContent(await run("spendesk_get_journal_csv", args))
    )
  );
  maybeReg("spendesk_create_accounting_export", () =>
    mcp.tool(
      "spendesk_create_accounting_export",
    "Create an accounting export.",
    { payload: z.record(z.unknown()).describe("Export request body") },
      async (args) => toContent(await run("spendesk_create_accounting_export", args))
    )
  );
  maybeReg("spendesk_get_journal_templates", () =>
    mcp.tool("spendesk_get_journal_templates", "Get available journal templates for accounting.", {}, async () =>
      toContent(await run("spendesk_get_journal_templates", {}))
    )
  );

  // —— Suppliers & Users ————————————————————————————————————————————————————
  maybeReg("spendesk_get_suppliers", () =>
    mcp.tool(
      "spendesk_get_suppliers",
    "Get suppliers list. By default returns only requested page to keep MCP payloads small. Set fetchAll=true to aggregate all pages. Supports dedicated supplier filters (ids, updatedBefore/After, createdBefore/After, bankCountry, iban, vatNumber, isArchived) and generic filters fallback.",
    suppliersSchema,
      async (args) => toContent(await run("spendesk_get_suppliers", args))
    )
  );
  maybeReg("spendesk_get_supplier", () =>
    mcp.tool(
      "spendesk_get_supplier",
    "Get a supplier by ID.",
    { supplierId: z.string() },
      async (args) => toContent(await run("spendesk_get_supplier", args))
    )
  );
  maybeReg("spendesk_create_suppliers", () =>
    mcp.tool(
      "spendesk_create_suppliers",
    "Create one or more suppliers (POST /v1/suppliers). Body must be an array of supplier objects (Public API supplierToCreate: name, supplierDetails.legalName required; optional primaryEmail, supplierDetails.vatNumber, bankInfo, etc.). Requires experimental:supplier:manage.",
    {
      payload: z
        .array(z.record(z.unknown()))
        .min(1)
        .max(100)
        .describe("Array of suppliers to create (1–100 items)."),
    },
      async (args) => toContent(await run("spendesk_create_suppliers", args))
    )
  );
  maybeReg("spendesk_update_supplier", () =>
    mcp.tool(
      "spendesk_update_supplier",
    "Update a single supplier by ID (PATCH /v1/suppliers/:id). Requires supplier manage scope.",
    {
      supplierId: z.string().describe("Supplier ID"),
      payload: z.record(z.unknown()).describe("Supplier fields to update (name, primaryEmail, supplierDetails, bankInfo)."),
    },
      async (args) => toContent(await run("spendesk_update_supplier", args))
    )
  );
  maybeReg("spendesk_update_suppliers", () =>
    mcp.tool(
      "spendesk_update_suppliers",
    "Bulk update suppliers (PATCH /v1/suppliers). Send an array of supplier updates (min 2 items, each with id).",
    {
      payload: z
        .array(z.record(z.unknown()))
        .min(2)
        .max(100)
        .describe("Array of supplier update objects. Each object must include an `id`."),
    },
      async (args) => toContent(await run("spendesk_update_suppliers", args))
    )
  );
  maybeReg("spendesk_set_supplier_archive_status", () =>
    mcp.tool(
      "spendesk_set_supplier_archive_status",
    "Archive or unarchive one supplier (PATCH /v1/experimental/suppliers/:id/status).",
    {
      supplierId: z.string().describe("Supplier ID"),
      isArchived: z.boolean().describe("true to archive, false to unarchive."),
    },
      async (args) => toContent(await run("spendesk_set_supplier_archive_status", args))
    )
  );
  maybeReg("spendesk_get_users", () =>
    mcp.tool(
      "spendesk_get_users",
    "Get users list (for approvals, dashboards). Use 'filters' to pass any API query parameters.",
    listSchema,
      async (args) => toContent(await run("spendesk_get_users", args))
    )
  );
  maybeReg("spendesk_get_user", () =>
    mcp.tool(
      "spendesk_get_user",
    "Get a user by ID.",
    { userId: z.string() },
      async (args) => toContent(await run("spendesk_get_user", args))
    )
  );

  // —— Webhooks —————————————————————————————————————————————————────────────—
  maybeReg("spendesk_create_webhook", () =>
    mcp.tool(
      "spendesk_create_webhook",
    "Create a webhook instance for real-time events.",
    { payload: z.record(z.unknown()).describe("Webhook config (url, events, etc.)") },
      async (args) => toContent(await run("spendesk_create_webhook", args))
    )
  );
  maybeReg("spendesk_get_webhooks", () =>
    mcp.tool("spendesk_get_webhooks", "List all webhook instances.", {}, async () =>
      toContent(await run("spendesk_get_webhooks", {}))
    )
  );
  maybeReg("spendesk_get_webhook", () =>
    mcp.tool(
      "spendesk_get_webhook",
    "Get a webhook instance by ID.",
    { webhookId: z.string() },
      async (args) => toContent(await run("spendesk_get_webhook", args))
    )
  );
  maybeReg("spendesk_update_webhook", () =>
    mcp.tool(
      "spendesk_update_webhook",
    "Update a webhook instance.",
    {
      webhookId: z.string(),
      payload: z.record(z.unknown()).describe("Fields to update"),
    },
      async (args) => toContent(await run("spendesk_update_webhook", args))
    )
  );
  maybeReg("spendesk_delete_webhook", () =>
    mcp.tool(
      "spendesk_delete_webhook",
    "Delete a webhook instance.",
    { webhookId: z.string() },
      async (args) => toContent(await run("spendesk_delete_webhook", args))
    )
  );

  // —— Purchase Orders ———————————————————————————————————————————————————————
  maybeReg("spendesk_get_purchase_orders", () =>
    mcp.tool(
      "spendesk_get_purchase_orders",
    "List all purchase orders: GET /v1/purchase-orders with your filters, all pages fetched in parallel. Official filters & docs: https://developer.spendesk.com/reference/v1-get-purchase-orders — includes supplierIds, status (open|closed|cancelled), companyIds, createdFrom/createdTo, startDateFrom/startDateTo, endDateFrom/endDateTo, withItems; pagination uses pageSize (max 30). Returns { data, meta.pagination }. Each PO is sanitized.",
      purchaseOrdersListSchema,
      async (args) => toContent(await run("spendesk_get_purchase_orders", args))
    )
  );
  maybeReg("spendesk_create_purchase_order", () =>
    mcp.tool(
      "spendesk_create_purchase_order",
    "Create a purchase order: POST /v1/purchase-orders. Schema: https://developer.spendesk.com/reference/v1-create-purchase-order (experimental:purchase-order:write). Use spendesk_get_purchase_order, spendesk_cancel_purchase_order, spendesk_close_purchase_order for read/cancel/close. Business rules: cancel only when no invoice is linked to the PO; close only when every linked invoice is paid.",
    { payload: z.record(z.unknown()).describe("PO body (see Spendesk docs)") },
      async (args) => toContent(await run("spendesk_create_purchase_order", args))
    )
  );
  const purchaseOrderByIdSchema = {
    purchaseOrderId: z.string().describe("Purchase order ID"),
    withItems: z
      .boolean()
      .optional()
      .describe("Include line items in the API response (query withItems). Default false."),
  };
  maybeReg("spendesk_get_purchase_order", () =>
    mcp.tool(
      "spendesk_get_purchase_order",
      "Get one purchase order by ID: GET /v1/purchase-orders/:id. Docs: https://developer.spendesk.com/reference/v1-get-purchase-order — response PO is sanitized (no large arrays).",
      purchaseOrderByIdSchema,
      async (args) => toContent(await run("spendesk_get_purchase_order", args))
    )
  );
  maybeReg("spendesk_cancel_purchase_order", () =>
    mcp.tool(
      "spendesk_cancel_purchase_order",
      "Cancel a purchase order: POST /v1/purchase-orders/:id/cancel. Docs: https://developer.spendesk.com/reference/v1-cancel-purchase-order. Business rule: cancellation is only allowed when no invoice is linked to the PO; if any invoice exists, the API will reject (use spendesk_get_purchase_order with withItems if needed to inspect linkage).",
      purchaseOrderByIdSchema,
      async (args) => toContent(await run("spendesk_cancel_purchase_order", args))
    )
  );
  maybeReg("spendesk_close_purchase_order", () =>
    mcp.tool(
      "spendesk_close_purchase_order",
      "Close a purchase order: POST /v1/purchase-orders/:id/close. Docs: https://developer.spendesk.com/reference/v1-close-purchase-order. Business rule: closing is only allowed when every invoice linked to the PO is paid; otherwise the API will reject.",
      purchaseOrderByIdSchema,
      async (args) => toContent(await run("spendesk_close_purchase_order", args))
    )
  );

  // —— API reference (discovery) —————————————————————————————————────────——
  maybeReg("spendesk_get_api_reference", () =>
    mcp.tool(
      "spendesk_get_api_reference",
    "Get the API reference: list of endpoints, HTTP methods, paths, parameters (query, path, body), MCP tool names, and documentation[] URLs to developer.spendesk.com where present. Use for API structure, filters (e.g. purchase orders list), or Spendesk docs links. Optional: filter by mcpTool or path.",
    {
      mcpTool: z.string().optional().describe("Filter to the endpoint exposed by this MCP tool (e.g. spendesk_get_settlements)"),
      path: z.string().optional().describe("Filter to endpoints whose path contains this string (e.g. settlements, payables)"),
    },
      async (args) => toContent(await run("spendesk_get_api_reference", args))
    )
  );
}
