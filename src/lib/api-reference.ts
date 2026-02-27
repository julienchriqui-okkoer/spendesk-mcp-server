/**
 * Structured API reference for the Spendesk Public API as exposed by this MCP.
 * Exposed via resource spendesk://api-reference and tool spendesk_get_api_reference
 * so clients (Claude, Dust, etc.) can query endpoints, parameters, and data structures.
 */

export type ParamSpec = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
  /** API query/body key if different (e.g. paid_from for paidFrom). */
  apiKey?: string;
};

export type EndpointSpec = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "MCP";
  path: string;
  mcpTool?: string;
  description: string;
  queryParams?: ParamSpec[];
  pathParams?: ParamSpec[];
  bodyParams?: ParamSpec[];
  responseNote?: string;
};

export const API_REFERENCE = {
  baseUrl: "https://public-api.spendesk.com",
  baseUrlDemo: "https://beta-sandbox.api.trunk.spendesk.services",
  docUrl: "https://developer.spendesk.com/reference/general",
  version: "v1",

  /** Common query params used by many list endpoints. */
  common: {
    pagination: [
      { name: "page", type: "number", required: false, description: "Page number (1-based)", apiKey: "page" },
      { name: "perPage", type: "number", required: false, description: "Items per page (1-100)", apiKey: "per_page" },
    ] as ParamSpec[],
    filters: {
      name: "filters",
      type: "object",
      description: "Additional API query parameters as key-value (e.g. from, to, state, ids). Sent as-is to the API.",
    } as ParamSpec,
  },

  endpoints: [
    // —— Spend Data —————————————————————————————————————————————————————————
    {
      method: "GET",
      path: "/v1/settlements",
      mcpTool: "spendesk_get_settlements",
      description: "List settlements. Useful for ERP sync and reporting.",
      queryParams: [
        { name: "page", type: "number", required: false, description: "Page number", apiKey: "page" },
        { name: "perPage", type: "number", required: false, description: "Items per page", apiKey: "per_page" },
        { name: "type", type: "string", required: false, description: "Filter by type", apiKey: "type" },
        { name: "state", type: "string", required: false, description: "Filter by state", apiKey: "state" },
        {
          name: "paidFrom",
          type: "string",
          required: false,
          description: "Paid from date (ISO 8601, bank account filter)",
        },
        {
          name: "clearedFrom",
          type: "string",
          required: false,
          description: "Cleared from date (ISO 8601)",
        },
        {
          name: "clearedTo",
          type: "string",
          required: false,
          description: "Cleared to date (ISO 8601)",
        },
        { name: "exportedAfter", type: "string", required: false, description: "Exported after date (ISO 8601)" },
        { name: "ids", type: "string | string[]", required: false, description: "Settlement ID(s)", apiKey: "ids" },
        { name: "filters", type: "object", required: false, description: "Any other API query params" },
      ],
      responseNote: "Paginated list. May require scope settlement:read.",
    },
    {
      method: "PUT",
      path: "/v1/settlements/:id/state",
      mcpTool: "spendesk_update_settlement_state",
      description: "Update a settlement state.",
      pathParams: [{ name: "settlementId", type: "string", required: true, description: "Settlement ID" }],
      bodyParams: [{ name: "state", type: "string", required: true, description: "New state value" }],
    },
    {
      method: "GET",
      path: "/v1/bank-fees",
      mcpTool: "spendesk_get_bank_fees",
      description: "List bank fees.",
      queryParams: [
        { name: "page", type: "number", required: false, apiKey: "page", description: "Page" },
        { name: "perPage", type: "number", required: false, apiKey: "per_page", description: "Per page" },
        { name: "filters", type: "object", required: false, description: "Additional query params" },
      ],
    },
    {
      method: "POST",
      path: "/v1/snapshots/payables",
      mcpTool: "spendesk_create_payables_snapshot",
      description: "Create a payables snapshot. Body: { query } with Public API payable query filters.",
      bodyParams: [
        { name: "query", type: "object", required: false, description: "Payable query (publicPayableQuerySchema)" },
        { name: "query.bookkeepingStatus", type: "string[]", required: false, description: "Filter by bookkeeping status(es)" },
        { name: "query.exportedAfter", type: "string", required: false, description: "Payables exported after this date (ISO 8601)" },
        { name: "query.ids", type: "string[]", required: false, description: "List of payable IDs" },
        { name: "query.sortBy", type: "string", required: false, description: "Sort field (default: payableDate)" },
        { name: "query.sortOrder", type: "string", required: false, description: "asc | desc (default: desc)" },
        { name: "query.fromPayableDate", type: "string", required: false, description: "Period start date YYYY-MM-DD (requires toPayableDate, max 31 days)" },
        { name: "query.toPayableDate", type: "string", required: false, description: "Period end date YYYY-MM-DD" },
        { name: "query.createdFrom", type: "string", required: false, description: "Creation date start YYYY-MM-DD" },
        { name: "query.createdTo", type: "string", required: false, description: "Creation date end YYYY-MM-DD" },
        { name: "query.updatedFrom", type: "string", required: false, description: "Payables modified after YYYY-MM-DD" },
      ],
    },
    {
      method: "GET",
      path: "/v1/snapshots/payables/:key",
      mcpTool: "spendesk_get_payables_snapshot",
      description: "Get a payables snapshot by ID. Supports pagination.",
      pathParams: [{ name: "snapshotId", type: "string", required: true, description: "Snapshot ID (key)" }],
      queryParams: [
        { name: "page", type: "number", required: false, description: "Page number (1-based), default 1" },
        { name: "perPage", type: "number", required: false, description: "Items per page (max 100), default 30" },
        { name: "filters", type: "object", required: false, description: "Additional query params (camelCase)" },
      ],
    },
    {
      method: "GET",
      path: "/v1/payables/:id",
      mcpTool: "spendesk_get_payable",
      description: "Get a single payable by ID.",
      pathParams: [{ name: "payableId", type: "string", required: true, description: "Payable ID" }],
    },
    {
      method: "GET",
      path: "/v1/payables/:id/attachments",
      mcpTool: "spendesk_get_payable_attachments",
      description: "Get attachments for a payable.",
      pathParams: [{ name: "payableId", type: "string", required: true, description: "Payable ID" }],
    },
    {
      method: "PUT",
      path: "/v1/payables/bookkeeping-status",
      mcpTool: "spendesk_update_payable_bookkeeping",
      description: "Update bookkeeping status of a payable.",
      bodyParams: [
        { name: "payableId", type: "string", required: true, description: "Payable ID" },
        { name: "payload", type: "object", required: true, description: "Bookkeeping status fields" },
      ],
    },
    {
      method: "GET",
      path: "/v1/wallet-loads",
      mcpTool: "spendesk_get_wallet_loads",
      description: "List wallet loads.",
      queryParams: [
        { name: "page", type: "number", required: false, apiKey: "page", description: "Page" },
        { name: "perPage", type: "number", required: false, apiKey: "per_page", description: "Per page" },
        { name: "filters", type: "object", required: false, description: "Additional params" },
      ],
    },
    {
      method: "GET",
      path: "/v1/wallet/summary",
      mcpTool: "spendesk_get_wallet_summary",
      description: "Get wallet summary.",
    },
    // —— Report (aggregated) —————————————————————————————————————————————————
    {
      method: "MCP",
      path: "(aggregated from payables)",
      mcpTool: "spendesk_get_spend_dashboard",
      description: "Spend dashboard: totals by cost center, expense category, charge account for a period.",
      queryParams: [
        { name: "from", type: "string", required: true, description: "Start date ISO (e.g. 2026-01-01)" },
        { name: "to", type: "string", required: true, description: "End date ISO (e.g. 2026-01-31)" },
        { name: "groupBy", type: "costCenter | expenseCategory | chargeAccount", required: false, description: "Return only this aggregation" },
      ],
      responseNote: "Uses Payables API; 404 if Payables not available.",
    },
    {
      method: "MCP",
      path: "(aggregated from payables)",
      mcpTool: "spendesk_get_top_suppliers_by_spend",
      description: "Top N suppliers by spend for a period, with payables and settlement IDs.",
      queryParams: [
        { name: "from", type: "string", required: true, description: "Start date ISO" },
        { name: "to", type: "string", required: true, description: "End date ISO" },
        { name: "limit", type: "number", required: false, description: "Number of top suppliers (default 10)" },
      ],
      responseNote: "Uses Payables API; 404 if Payables not available.",
    },
    {
      method: "MCP",
      path: "(aggregated from purchase-orders + payables)",
      mcpTool: "spendesk_get_purchase_orders_and_payables_export",
      description: "Export purchase orders and payables for a period, linked by supplier.",
      queryParams: [
        { name: "from", type: "string", required: true, description: "Start date ISO" },
        { name: "to", type: "string", required: true, description: "End date ISO" },
      ],
    },
    // —— Analytical ————————————————————————————————————————————————————————
    {
      method: "GET",
      path: "/v1/analytical-fields",
      mcpTool: "spendesk_get_analytical_fields",
      description: "Get analytical (custom) fields for reporting.",
    },
    {
      method: "GET",
      path: "/v1/analytical-fields/:fieldId/values",
      mcpTool: "spendesk_get_analytical_values",
      description: "Get analytical values for a given field. Call analytical-fields first for fieldId.",
      pathParams: [{ name: "fieldId", type: "string", required: true, description: "From spendesk_get_analytical_fields" }],
      queryParams: [
        { name: "page", type: "number", required: false, apiKey: "page", description: "Page" },
        { name: "perPage", type: "number", required: false, apiKey: "per_page", description: "Per page" },
        { name: "filters", type: "object", required: false, description: "Additional params" },
      ],
    },
    {
      method: "GET",
      path: "/v1/cost-centers",
      mcpTool: "spendesk_get_cost_centers",
      description: "List cost centers.",
      queryParams: [
        { name: "page", type: "number", required: false, apiKey: "page", description: "Page" },
        { name: "perPage", type: "number", required: false, apiKey: "per_page", description: "Per page" },
        { name: "filters", type: "object", required: false, description: "Additional params" },
      ],
    },
    {
      method: "POST",
      path: "/v1/cost-centers",
      mcpTool: "spendesk_create_cost_center",
      description: "Create a cost center.",
      bodyParams: [{ name: "payload", type: "object", required: true, description: "Cost center body" }],
    },
    {
      method: "PUT",
      path: "/v1/cost-centers/:id",
      mcpTool: "spendesk_update_cost_center",
      description: "Update a cost center.",
      pathParams: [{ name: "costCenterId", type: "string", required: true, description: "Cost center ID" }],
      bodyParams: [{ name: "payload", type: "object", required: true, description: "Fields to update" }],
    },
    {
      method: "DELETE",
      path: "/v1/cost-centers/:id",
      mcpTool: "spendesk_delete_cost_center",
      description: "Delete a cost center.",
      pathParams: [{ name: "costCenterId", type: "string", required: true, description: "Cost center ID" }],
    },
    {
      method: "GET",
      path: "/v1/expense-categories",
      mcpTool: "spendesk_get_expense_categories",
      description: "List expense categories.",
      queryParams: [
        { name: "page", type: "number", required: false, apiKey: "page", description: "Page" },
        { name: "perPage", type: "number", required: false, apiKey: "per_page", description: "Per page" },
        { name: "filters", type: "object", required: false, description: "Additional params" },
      ],
    },
    // —— Accounting —————————————————————————————————————————————————————————
    {
      method: "GET",
      path: "/v1/accounting/journal/:exportId/content",
      mcpTool: "spendesk_get_journal_csv",
      description: "Get journal CSV content for an accounting export.",
      pathParams: [{ name: "exportId", type: "string", required: true, description: "Export ID" }],
    },
    {
      method: "POST",
      path: "/v1/accounting/exports",
      mcpTool: "spendesk_create_accounting_export",
      description: "Create an accounting export.",
      bodyParams: [{ name: "payload", type: "object", required: true, description: "Export request body" }],
    },
    {
      method: "GET",
      path: "/v1/accounting/journal-templates",
      mcpTool: "spendesk_get_journal_templates",
      description: "Get available journal templates.",
    },
    // —— Suppliers & Users ———————————————————————————————————————————————————
    {
      method: "GET",
      path: "/v1/suppliers",
      mcpTool: "spendesk_get_suppliers",
      description: "List suppliers (vendors).",
      queryParams: [
        { name: "page", type: "number", required: false, apiKey: "page", description: "Page" },
        { name: "perPage", type: "number", required: false, apiKey: "per_page", description: "Per page" },
        { name: "filters", type: "object", required: false, description: "Additional params" },
      ],
    },
    {
      method: "GET",
      path: "/v1/suppliers/:id",
      mcpTool: "spendesk_get_supplier",
      description: "Get a supplier by ID.",
      pathParams: [{ name: "supplierId", type: "string", required: true, description: "Supplier ID" }],
    },
    {
      method: "GET",
      path: "/v1/users",
      mcpTool: "spendesk_get_users",
      description: "List users.",
      queryParams: [
        { name: "page", type: "number", required: false, apiKey: "page", description: "Page" },
        { name: "perPage", type: "number", required: false, apiKey: "per_page", description: "Per page" },
        { name: "filters", type: "object", required: false, description: "Additional params" },
      ],
    },
    {
      method: "GET",
      path: "/v1/users/:id",
      mcpTool: "spendesk_get_user",
      description: "Get a user by ID.",
      pathParams: [{ name: "userId", type: "string", required: true, description: "User ID" }],
    },
    // —— Webhooks —————————————————————————————————————————————————────────——
    {
      method: "POST",
      path: "/v1/webhooks/instances",
      mcpTool: "spendesk_create_webhook",
      description: "Create a webhook instance.",
      bodyParams: [{ name: "payload", type: "object", required: true, description: "Webhook config (url, events)" }],
    },
    {
      method: "GET",
      path: "/v1/webhooks/instances",
      mcpTool: "spendesk_get_webhooks",
      description: "List webhook instances.",
    },
    {
      method: "GET",
      path: "/v1/webhooks/instances/:id",
      mcpTool: "spendesk_get_webhook",
      description: "Get a webhook instance by ID.",
      pathParams: [{ name: "webhookId", type: "string", required: true, description: "Webhook ID" }],
    },
    {
      method: "PUT",
      path: "/v1/webhooks/instances/:id",
      mcpTool: "spendesk_update_webhook",
      description: "Update a webhook instance.",
      pathParams: [{ name: "webhookId", type: "string", required: true, description: "Webhook ID" }],
      bodyParams: [{ name: "payload", type: "object", required: true, description: "Fields to update" }],
    },
    {
      method: "DELETE",
      path: "/v1/webhooks/instances/:id",
      mcpTool: "spendesk_delete_webhook",
      description: "Delete a webhook instance.",
      pathParams: [{ name: "webhookId", type: "string", required: true, description: "Webhook ID" }],
    },
    // —— Purchase Orders ————————————————————————————————————————————————————
    {
      method: "GET",
      path: "/v1/purchase-orders",
      mcpTool: "spendesk_get_purchase_orders",
      description: "List purchase orders. Supports status, state, supplierId, userId, date filters (from/to, createdFrom/createdTo, updatedFrom/updatedTo), ids.",
      queryParams: [
        { name: "page", type: "number", required: false, apiKey: "page", description: "Page" },
        { name: "perPage", type: "number", required: false, apiKey: "per_page", description: "Per page" },
        { name: "status", type: "string", required: false, apiKey: "status", description: "Filter by status" },
        { name: "state", type: "string", required: false, apiKey: "state", description: "Filter by state" },
        { name: "supplierId", type: "string", required: false, description: "Filter by supplier" },
        { name: "userId", type: "string", required: false, description: "Filter by user" },
        { name: "from", type: "string", required: false, description: "Created from date ISO" },
        { name: "to", type: "string", required: false, description: "Created to date ISO" },
        { name: "createdFrom", type: "string", required: false, description: "Created from date ISO" },
        { name: "createdTo", type: "string", required: false, description: "Created to date ISO" },
        { name: "updatedFrom", type: "string", required: false, description: "Updated from" },
        { name: "updatedTo", type: "string", required: false, description: "Updated to" },
        { name: "ids", type: "string | string[]", required: false, apiKey: "ids", description: "PO ID(s)" },
        { name: "filters", type: "object", required: false, description: "Any other API params" },
      ],
    },
    {
      method: "POST",
      path: "/v1/purchase-orders",
      mcpTool: "spendesk_create_purchase_order",
      description: "Create a purchase order.",
      bodyParams: [{ name: "payload", type: "object", required: true, description: "PO body" }],
    },
  ] as EndpointSpec[],

  /** Resource URIs (read-only data). */
  resources: [
    { uri: "spendesk://settlements", description: "Settlements list" },
    { uri: "spendesk://suppliers", description: "Suppliers list" },
    { uri: "spendesk://users", description: "Users list" },
    { uri: "spendesk://wallet-summary", description: "Wallet summary" },
    { uri: "spendesk://cost-centers", description: "Cost centers" },
    { uri: "spendesk://expense-categories", description: "Expense categories" },
    { uri: "spendesk://analytical-fields", description: "Analytical fields" },
    { uri: "spendesk://bank-fees", description: "Bank fees" },
    { uri: "spendesk://wallet-loads", description: "Wallet loads" },
    { uri: "spendesk://journal-templates", description: "Journal templates" },
    { uri: "spendesk://api-reference", description: "This API reference (endpoints, params, structures)" },
  ],
};

export function getApiReference(options?: { mcpTool?: string; path?: string }): typeof API_REFERENCE {
  if (!options?.mcpTool && !options?.path) return API_REFERENCE;
  const ref = {
    ...API_REFERENCE,
    endpoints: API_REFERENCE.endpoints.filter((e) => {
      if (options.mcpTool && e.mcpTool === options.mcpTool) return true;
      if (options.path && e.path.includes(options.path)) return true;
      return false;
    }),
  };
  return ref;
}
