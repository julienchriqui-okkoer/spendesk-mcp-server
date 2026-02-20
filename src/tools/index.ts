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
  paidFrom: z.string().optional().describe("Filter settlements paid from this date (ISO 8601 format)"),
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
  exportedAfter?: string;
  ids?: string | string[];
  filters?: Record<string, unknown>;
}): Record<string, string> {
  const params = paginate(args);
  
  // Add dedicated settlement parameters
  if (args.type != null) params.type = String(args.type);
  if (args.state != null) params.state = String(args.state);
  if (args.paidFrom != null) params.paidFrom = String(args.paidFrom);
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

  if (args.status != null) params.status = String(args.status);
  if (args.state != null) params.state = String(args.state);
  if (args.supplierId != null) params.supplier_id = String(args.supplierId);
  if (args.userId != null) params.user_id = String(args.userId);

  // Creation date: Try both "from"/"to" and "created_from"/"created_to" since API might expect snake_case.
  // Accept from/to and createdFrom/createdTo in the tool, map to API param names.
  const fromDate = args.from ?? args.createdFrom;
  const toDate = args.to ?? args.createdTo;
  if (fromDate != null) {
    // Try created_from first (snake_case, aligned with per_page, supplier_id, etc.)
    params.created_from = String(fromDate);
    // Also send "from" as fallback in case API expects that
    params.from = String(fromDate);
  }
  if (toDate != null) {
    params.created_to = String(toDate);
    params.to = String(toDate);
  }

  if (args.updatedFrom != null) params.updated_from = String(args.updatedFrom);
  if (args.updatedTo != null) params.updated_to = String(args.updatedTo);

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
      case "spendesk_get_payables":
        return api.get(
          SpendeskPaths.getPayables,
          buildQueryParams(args as { page?: number; perPage?: number; filters?: Record<string, unknown> })
        );
      case "spendesk_create_payables_snapshot":
        return api.post(SpendeskPaths.createPayablesSnapshot, args.payload);
      case "spendesk_get_payables_snapshot":
        return api.get(SpendeskPaths.getPayablesSnapshot(args.snapshotId as string));
      case "spendesk_get_payable":
        return api.get(SpendeskPaths.getPayableById(args.payableId as string));
      case "spendesk_get_payable_attachments":
        return api.get(SpendeskPaths.getPayableAttachments(args.payableId as string));
      case "spendesk_update_payable_bookkeeping":
        return api.put(SpendeskPaths.updatePayableBookkeeping(args.payableId as string), args.payload);
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
    "Get settlements list. Useful for ERP sync and reporting. Supports dedicated parameters (type, state, paidFrom, exportedAfter, ids) and 'filters' for any additional API query parameters.",
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
    "spendesk_get_payables",
    "List payables (invoices, credit notes) with pagination. Use when GET /v1/payables is available. Use 'filters' to pass any API query parameters (dates, statuses, supplier IDs, etc.).",
    listSchema,
    async (args) => toContent(await run("spendesk_get_payables", args))
  );
  mcp.tool(
    "spendesk_create_payables_snapshot",
    "Create a snapshot of payables (invoices, credit notes, etc.).",
    { payload: z.record(z.unknown()).describe("Snapshot request body (filters, etc.)") },
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
    "Get purchase orders list. Supports status, state, supplierId, userId, ids, and date filters: use 'from' or 'createdFrom' for creation date from (sent as 'from'), 'to' or 'createdTo' for creation date to (sent as 'to'); updatedFrom/updatedTo are sent as updated_from/updated_to. Use 'filters' for any other API query parameters.",
    purchaseOrdersSchema,
    async (args) => toContent(await run("spendesk_get_purchase_orders", args))
  );
  mcp.tool(
    "spendesk_create_purchase_order",
    "Create a purchase order.",
    { payload: z.record(z.unknown()).describe("PO body") },
    async (args) => toContent(await run("spendesk_create_purchase_order", args))
  );
}
