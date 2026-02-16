/**
 * Spendesk Public API paths (v1).
 * @see https://developer.spendesk.com/reference/general
 */

const V1 = "/v1";

export const SpendeskPaths = {
  // Spend Data
  getSettlements: `${V1}/settlements`,
  updateSettlementState: (id: string) => `${V1}/settlements/${id}/state`,
  getBankFees: `${V1}/bank-fees`,
  /** List payables (if supported by API). */
  getPayables: `${V1}/payables`,
  createPayablesSnapshot: `${V1}/payables/snapshots`,
  getPayablesSnapshot: (id: string) => `${V1}/payables/snapshots/${id}`,
  getPayableById: (id: string) => `${V1}/payables/${id}`,
  getPayableAttachments: (id: string) => `${V1}/payables/${id}/attachments`,
  updatePayableBookkeeping: (id: string) => `${V1}/payables/${id}/bookkeeping-status`,
  getWalletLoads: `${V1}/wallet-loads`,
  getWalletSummary: `${V1}/wallet/summary`,

  // Authentication (API token)
  createAccessToken: `${V1}/auth/access-token`,

  // Analytical (doc: Get Analytical Fields, Get Analytical Values — kebab-case comme cost-centers / expense-categories)
  getAnalyticalFields: `${V1}/analytical-fields`,
  getAnalyticalValues: `${V1}/analytical-values`,
  /** Values for a given analytical field (use field id from getAnalyticalFields). */
  getAnalyticalValuesByFieldId: (fieldId: string) => `${V1}/analytical-fields/${fieldId}/values`,
  getCostCenters: `${V1}/cost-centers`,
  getExpenseCategories: `${V1}/expense-categories`,
  createCostCenter: `${V1}/cost-centers`,
  updateCostCenter: (id: string) => `${V1}/cost-centers/${id}`,
  deleteCostCenter: (id: string) => `${V1}/cost-centers/${id}`,

  // OAuth2 (for third-party apps)
  oauth2Authorize: `${V1}/oauth2/authorize`,
  oauth2Token: `${V1}/oauth2/token`,
  oauth2Refresh: `${V1}/oauth2/token/refresh`,

  // Accounting
  getJournalCsv: (exportId: string) => `${V1}/accounting/journal/${exportId}/content`,
  createAccountingExport: `${V1}/accounting/exports`,
  getJournalTemplates: `${V1}/accounting/journal-templates`,

  // Suppliers and Users
  getSuppliers: `${V1}/suppliers`,
  getSupplierById: (id: string) => `${V1}/suppliers/${id}`,
  getUsers: `${V1}/users`,
  getUserById: (id: string) => `${V1}/users/${id}`,

  // Webhooks Admin
  createWebhook: `${V1}/webhooks/instances`,
  getWebhooks: `${V1}/webhooks/instances`,
  getWebhookById: (id: string) => `${V1}/webhooks/instances/${id}`,
  updateWebhook: (id: string) => `${V1}/webhooks/instances/${id}`,
  deleteWebhook: (id: string) => `${V1}/webhooks/instances/${id}`,

  // Purchase Orders
  getPurchaseOrders: `${V1}/purchase-orders`,
  createPurchaseOrder: `${V1}/purchase-orders`,
} as const;
