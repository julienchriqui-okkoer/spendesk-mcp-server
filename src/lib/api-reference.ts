/**
 * Structured API reference for the Spendesk Public API as exposed by this MCP.
 * Exposed via resource spendesk://api-reference and tool spendesk_get_api_reference
 * so clients (Claude, Dust, etc.) can query endpoints, parameters, and data structures.
 * Endpoints for disabled tools (config/tools.config.json) are excluded from the reference.
 */

import { isToolEnabled } from "./tools-config.js";

export type ParamSpec = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
  /** API query/body key if different (e.g. paid_from for paidFrom). */
  apiKey?: string;
};

export type EndpointSpec = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "MCP";
  path: string;
  mcpTool?: string;
  description: string;
  /** Official Spendesk Public API docs (developer.spendesk.com). */
  documentation?: string[];
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
        { name: "chargedFrom", type: "string", required: false, apiKey: "chargedFrom", description: "Filter fees charged from this date (ISO 8601)" },
        { name: "chargedTo", type: "string", required: false, apiKey: "chargedTo", description: "Filter fees charged until this date (ISO 8601)" },
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
      description: "Update bookkeeping status of a payable. No path param; payableId and fields go in the request body.",
      bodyParams: [
        { name: "payableId", type: "string", required: true, description: "Payable ID (in body, not in path)" },
        { name: "bookkeepingStatus", type: "string", required: false, description: "e.g. 'exported'. Merged from payload into body." },
      ],
    },
    {
      method: "GET",
      path: "/v1/wallet-loads",
      mcpTool: "spendesk_get_wallet_loads",
      description: "List wallet loads (top-ups). Use filters.createdFrom / filters.createdTo (ISO date) for daily export to NetSuite.",
      queryParams: [
        { name: "page", type: "number", required: false, apiKey: "page", description: "Page" },
        { name: "perPage", type: "number", required: false, apiKey: "per_page", description: "Per page" },
        { name: "createdFrom", type: "string", required: false, description: "Filter loads created from this date (ISO 8601). Pass via filters." },
        { name: "createdTo", type: "string", required: false, description: "Filter loads created until this date (ISO 8601). Pass via filters." },
        { name: "filters", type: "object", required: false, description: "Additional query params (e.g. createdFrom, createdTo)" },
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
      description:
        "Export purchase orders and payables for a period, linked by supplier. PO list uses GET /v1/purchase-orders with createdFrom/createdTo (from/to args).",
      documentation: ["https://developer.spendesk.com/reference/v1-get-purchase-orders"],
      queryParams: [
        { name: "from", type: "string", required: true, description: "Start date YYYY-MM-DD → PO createdFrom" },
        { name: "to", type: "string", required: true, description: "End date YYYY-MM-DD → PO createdTo" },
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
      method: "MCP",
      path: "(filter discovery)",
      mcpTool: "spendesk_get_filter_options",
      description: "Returns all valid filter values (payableType, bookkeepingStatus, settlementState, counterpartyType, sortOrder, groupBy, paymentStatus). Call when a filter returns 0 results or to discover allowed values before calling analyze_spend, get_settlements, or get_bookkeeping_pipeline.",
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
        { name: "perPage", type: "number", required: false, apiKey: "pageSize", description: "Page size (max 30)" },
        { name: "ids", type: "string | string[]", required: false, description: "Filter by supplier IDs" },
        { name: "updatedBefore", type: "string", required: false, description: "Filter by update datetime upper bound (ISO 8601)" },
        { name: "updatedAfter", type: "string", required: false, description: "Filter by update datetime lower bound (ISO 8601)" },
        { name: "createdBefore", type: "string", required: false, description: "Filter by creation datetime upper bound (ISO 8601)" },
        { name: "createdAfter", type: "string", required: false, description: "Filter by creation datetime lower bound (ISO 8601)" },
        { name: "bankCountry", type: "string", required: false, description: "Filter by bank country ISO alpha-2 (e.g. FR)" },
        { name: "iban", type: "string", required: false, description: "Filter by supplier IBAN" },
        { name: "vatNumber", type: "string", required: false, description: "Filter by supplier VAT number" },
        { name: "isArchived", type: "boolean", required: false, description: "true = archived suppliers only, false = active suppliers only" },
        { name: "filters", type: "object", required: false, description: "Additional query params (generic fallback)" },
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
      method: "POST",
      path: "/v1/suppliers",
      mcpTool: "spendesk_create_suppliers",
      description: "Create one or more suppliers. Body: array of supplierToCreate (name, supplierDetails with legalName required).",
      bodyParams: [{ name: "payload", type: "array<object>", required: true, description: "Array of suppliers to create (1–100)" }],
    },
    {
      method: "PATCH",
      path: "/v1/suppliers/:id",
      mcpTool: "spendesk_update_supplier",
      description: "Update a single supplier by ID.",
      pathParams: [{ name: "supplierId", type: "string", required: true, description: "Supplier ID" }],
      bodyParams: [{ name: "payload", type: "object", required: true, description: "Supplier fields to update" }],
    },
    {
      method: "PATCH",
      path: "/v1/suppliers",
      mcpTool: "spendesk_update_suppliers",
      description: "Bulk update suppliers (2 to 100 items).",
      bodyParams: [{ name: "payload", type: "array<object>", required: true, description: "Array of supplier update objects, each with id" }],
    },
    {
      method: "PATCH",
      path: "/v1/experimental/suppliers/:id/status",
      mcpTool: "spendesk_set_supplier_archive_status",
      description: "Archive or unarchive a supplier by ID.",
      pathParams: [{ name: "supplierId", type: "string", required: true, description: "Supplier ID" }],
      bodyParams: [{ name: "isArchived", type: "boolean", required: true, description: "true to archive, false to unarchive" }],
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
      description:
        "List purchase orders; the MCP tool fetches all pages in parallel. API uses query param pageSize (max 30). Returns { data, meta: { pagination } }. Each PO is sanitized.",
      documentation: ["https://developer.spendesk.com/reference/v1-get-purchase-orders"],
      queryParams: [
        { name: "page", type: "number", required: false, description: "Page number (1-based); managed automatically when fetching all pages", apiKey: "page" },
        {
          name: "perPage",
          type: "number",
          required: false,
          description: "Items per request; sent to the API as pageSize (default 30, max 30)",
          apiKey: "pageSize",
        },
        {
          name: "withItems",
          type: "boolean",
          required: false,
          description: "Include line items in each PO in the list response",
        },
        {
          name: "supplierIds",
          type: "string | string[]",
          required: false,
          description: "Filter by supplier ID(s); comma-separated or array (merged to comma-separated)",
        },
        {
          name: "status",
          type: "string | string[]",
          required: false,
          description: "Filter by PO status: open, closed, cancelled (string or array)",
        },
        {
          name: "companyIds",
          type: "string | string[]",
          required: false,
          description: "Filter by company ID(s)",
        },
        {
          name: "createdFrom",
          type: "string",
          required: false,
          description: "PO creation from date YYYY-MM-DD",
        },
        {
          name: "createdTo",
          type: "string",
          required: false,
          description: "PO creation until date YYYY-MM-DD",
        },
        {
          name: "startDateFrom",
          type: "string",
          required: false,
          description: "PO start date from YYYY-MM-DD",
        },
        {
          name: "startDateTo",
          type: "string",
          required: false,
          description: "PO start date until YYYY-MM-DD",
        },
        {
          name: "endDateFrom",
          type: "string",
          required: false,
          description: "PO end date from YYYY-MM-DD",
        },
        {
          name: "endDateTo",
          type: "string",
          required: false,
          description: "PO end date until YYYY-MM-DD",
        },
        { name: "supplierId", type: "string", required: false, description: "MCP alias: single supplier → supplierIds" },
        { name: "from", type: "string", required: false, description: "MCP alias for createdFrom (YYYY-MM-DD)" },
        { name: "to", type: "string", required: false, description: "MCP alias for createdTo (YYYY-MM-DD)" },
        {
          name: "filters",
          type: "object",
          required: false,
          description: "Extra query keys forwarded to the API (camelCase as per Public API)",
        },
      ],
    },
    {
      method: "GET",
      path: "/v1/purchase-orders/:purchaseOrderId",
      mcpTool: "spendesk_get_purchase_order",
      description: "Get one purchase order by ID.",
      documentation: ["https://developer.spendesk.com/reference/v1-get-purchase-order"],
      pathParams: [
        { name: "purchaseOrderId", type: "string", required: true, description: "Purchase order ID" },
      ],
      queryParams: [
        { name: "withItems", type: "boolean", required: false, description: "Include line items" },
      ],
    },
    {
      method: "POST",
      path: "/v1/purchase-orders",
      mcpTool: "spendesk_create_purchase_order",
      description: "Create a purchase order.",
      documentation: ["https://developer.spendesk.com/reference/v1-create-purchase-order"],
      bodyParams: [{ name: "payload", type: "object", required: true, description: "PO body" }],
    },
    {
      method: "POST",
      path: "/v1/purchase-orders/:purchaseOrderId/cancel",
      mcpTool: "spendesk_cancel_purchase_order",
      description:
        "Cancel a purchase order. Typically only allowed when no invoice is linked to the PO; if invoices exist, the request fails.",
      documentation: ["https://developer.spendesk.com/reference/v1-cancel-purchase-order"],
      pathParams: [
        { name: "purchaseOrderId", type: "string", required: true, description: "Purchase order ID" },
      ],
      queryParams: [
        { name: "withItems", type: "boolean", required: false, description: "Include line items in the response" },
      ],
    },
    {
      method: "POST",
      path: "/v1/purchase-orders/:purchaseOrderId/close",
      mcpTool: "spendesk_close_purchase_order",
      description:
        "Close a purchase order. Typically only allowed when every invoice linked to the PO is paid; otherwise the request fails.",
      documentation: ["https://developer.spendesk.com/reference/v1-close-purchase-order"],
      pathParams: [
        { name: "purchaseOrderId", type: "string", required: true, description: "Purchase order ID" },
      ],
      queryParams: [
        { name: "withItems", type: "boolean", required: false, description: "Include line items in the response" },
      ],
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
  let endpoints = API_REFERENCE.endpoints.filter(
    (e) => !e.mcpTool || isToolEnabled(e.mcpTool)
  );
  if (options?.mcpTool || options?.path) {
    endpoints = endpoints.filter((e) => {
      if (options.mcpTool && e.mcpTool === options.mcpTool) return true;
      if (options.path && e.path.includes(options.path)) return true;
      return false;
    });
  }
  return {
    ...API_REFERENCE,
    endpoints,
  };
}
