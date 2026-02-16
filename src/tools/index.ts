import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SpendeskClient } from "../spendesk-api/client.js";
import { SpendeskPaths } from "../spendesk-api/endpoints.js";
import { z } from "zod";

const paginationSchema = {
  page: z.number().int().min(1).optional().describe("Page number (1-based)"),
  perPage: z.number().int().min(1).max(100).optional().describe("Items per page"),
};

function paginate(args: { page?: number; perPage?: number }): Record<string, string> {
  const p: Record<string, string> = {};
  if (args.page != null) p.page = String(args.page);
  if (args.perPage != null) p.per_page = String(args.perPage);
  return p;
}

export function registerTools(mcp: McpServer, api: SpendeskClient): void {
  const run = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case "spendesk_get_settlements":
        return api.get(SpendeskPaths.getSettlements, paginate(args as { page?: number; perPage?: number }));
      case "spendesk_update_settlement_state":
        return api.put(SpendeskPaths.updateSettlementState(args.settlementId as string), { state: args.state });
      case "spendesk_get_bank_fees":
        return api.get(SpendeskPaths.getBankFees, paginate(args as { page?: number; perPage?: number }));
      case "spendesk_get_payables":
        return api.get(SpendeskPaths.getPayables, paginate(args as { page?: number; perPage?: number }));
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
        return api.get(SpendeskPaths.getWalletLoads, paginate(args as { page?: number; perPage?: number }));
      case "spendesk_get_wallet_summary":
        return api.get(SpendeskPaths.getWalletSummary);

      case "spendesk_get_analytical_fields":
        return api.get(SpendeskPaths.getAnalyticalFields);
      case "spendesk_get_analytical_values":
        return api.get(SpendeskPaths.getAnalyticalValuesByFieldId(args.fieldId as string));
      case "spendesk_get_cost_centers":
        return api.get(SpendeskPaths.getCostCenters, paginate(args as { page?: number; perPage?: number }));
      case "spendesk_get_expense_categories":
        return api.get(SpendeskPaths.getExpenseCategories, paginate(args as { page?: number; perPage?: number }));
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
        return api.get(SpendeskPaths.getSuppliers, paginate(args as { page?: number; perPage?: number }));
      case "spendesk_get_supplier":
        return api.get(SpendeskPaths.getSupplierById(args.supplierId as string));
      case "spendesk_get_users":
        return api.get(SpendeskPaths.getUsers, paginate(args as { page?: number; perPage?: number }));
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
        return api.get(SpendeskPaths.getPurchaseOrders, paginate(args as { page?: number; perPage?: number }));
      case "spendesk_create_purchase_order":
        return api.post(SpendeskPaths.createPurchaseOrder, args.payload);

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
    "Get settlements list. Useful for ERP sync and reporting.",
    paginationSchema,
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
    "Get bank fees. Useful for accounting and dashboards.",
    paginationSchema,
    async (args) => toContent(await run("spendesk_get_bank_fees", args))
  );
  mcp.tool(
    "spendesk_get_payables",
    "List payables (invoices, credit notes) with pagination. Use when GET /v1/payables is available.",
    paginationSchema,
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
  mcp.tool(
    "spendesk_get_wallet_loads",
    "Get wallet loads (card top-ups, etc.).",
    paginationSchema,
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
    "Get analytical values for a given field. Call spendesk_get_analytical_fields first to get field ids.",
    {
      fieldId: z.string().describe("Analytical field id (from spendesk_get_analytical_fields)"),
      ...paginationSchema,
    },
    async (args) => toContent(await run("spendesk_get_analytical_values", args))
  );
  mcp.tool(
    "spendesk_get_cost_centers",
    "Get cost centers (for ERP mapping and reports).",
    paginationSchema,
    async (args) => toContent(await run("spendesk_get_cost_centers", args))
  );
  mcp.tool(
    "spendesk_get_expense_categories",
    "Get expense categories.",
    paginationSchema,
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
    "Get suppliers list (vendors). Essential for ERP sync.",
    paginationSchema,
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
    "Get users list (for approvals, dashboards).",
    paginationSchema,
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
    "Get purchase orders list.",
    paginationSchema,
    async (args) => toContent(await run("spendesk_get_purchase_orders", args))
  );
  mcp.tool(
    "spendesk_create_purchase_order",
    "Create a purchase order.",
    { payload: z.record(z.unknown()).describe("PO body") },
    async (args) => toContent(await run("spendesk_create_purchase_order", args))
  );
}
