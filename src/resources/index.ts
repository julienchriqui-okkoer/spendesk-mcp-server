/**
 * MCP Resources for Spendesk data (read-only, for dashboards and context).
 * URIs: spendesk://settlements | suppliers | users | wallet-summary | cost-centers | expense-categories | analytical-fields
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SpendeskClient } from "../spendesk-api/client.js";
import { SpendeskPaths } from "../spendesk-api/endpoints.js";

const SPENDESK_URI_PREFIX = "spendesk://";

function jsonResource(uri: string, text: string, mimeType = "application/json") {
  return {
    contents: [{ uri, text, mimeType }],
  };
}

export function registerResources(mcp: McpServer, api: SpendeskClient): void {
  const read = async (uri: URL): Promise<{ contents: Array<{ uri: string; text: string; mimeType?: string }> }> => {
    const path = uri.pathname.replace(/^\//, "") || uri.host || "";
    const resourceUri = uri.toString();
    let data: unknown;
    switch (path) {
      case "settlements":
        data = await api.get(SpendeskPaths.getSettlements, { per_page: "50" });
        break;
      case "suppliers":
        data = await api.get(SpendeskPaths.getSuppliers, { per_page: "100" });
        break;
      case "users":
        data = await api.get(SpendeskPaths.getUsers, { per_page: "100" });
        break;
      case "wallet-summary":
        data = await api.get(SpendeskPaths.getWalletSummary);
        break;
      case "cost-centers":
        data = await api.get(SpendeskPaths.getCostCenters, { per_page: "100" });
        break;
      case "expense-categories":
        data = await api.get(SpendeskPaths.getExpenseCategories, { per_page: "100" });
        break;
      case "analytical-fields":
        data = await api.get(SpendeskPaths.getAnalyticalFields);
        break;
      case "bank-fees":
        data = await api.get(SpendeskPaths.getBankFees, { per_page: "50" });
        break;
      case "wallet-loads":
        data = await api.get(SpendeskPaths.getWalletLoads, { per_page: "50" });
        break;
      case "journal-templates":
        data = await api.get(SpendeskPaths.getJournalTemplates);
        break;
      default:
        return jsonResource(resourceUri, JSON.stringify({ error: `Unknown resource: ${path}` }, null, 2));
    }
    return jsonResource(resourceUri, JSON.stringify(data, null, 2));
  };

  const resources: Array<{ name: string; uri: string; description?: string }> = [
    { name: "Settlements", uri: `${SPENDESK_URI_PREFIX}settlements`, description: "Settlements list (for dashboards)" },
    { name: "Suppliers", uri: `${SPENDESK_URI_PREFIX}suppliers`, description: "Suppliers/vendors list" },
    { name: "Users", uri: `${SPENDESK_URI_PREFIX}users`, description: "Users list" },
    { name: "Wallet summary", uri: `${SPENDESK_URI_PREFIX}wallet-summary`, description: "Wallet summary" },
    { name: "Cost centers", uri: `${SPENDESK_URI_PREFIX}cost-centers`, description: "Cost centers" },
    { name: "Expense categories", uri: `${SPENDESK_URI_PREFIX}expense-categories`, description: "Expense categories" },
    { name: "Analytical fields", uri: `${SPENDESK_URI_PREFIX}analytical-fields`, description: "Analytical (custom) fields" },
    { name: "Bank fees", uri: `${SPENDESK_URI_PREFIX}bank-fees`, description: "Bank fees" },
    { name: "Wallet loads", uri: `${SPENDESK_URI_PREFIX}wallet-loads`, description: "Wallet loads" },
    { name: "Journal templates", uri: `${SPENDESK_URI_PREFIX}journal-templates`, description: "Accounting journal templates" },
  ];

  for (const r of resources) {
    mcp.resource(r.name, r.uri, { description: r.description }, async (uri) => read(uri));
  }
}
