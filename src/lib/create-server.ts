import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SpendeskClient } from "../spendesk-api/client.js";
import { registerTools } from "../tools/index.js";
import { registerResources } from "../resources/index.js";

export function createMcpServer(api: SpendeskClient): McpServer {
  const mcp = new McpServer(
    {
      name: "spendesk-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions: [
        "This server exposes the Spendesk Public API for ERP integrations and dashboards.",
        "Use tools to list/update settlements, payables, suppliers, users, cost centers, accounting exports, webhooks, and purchase orders.",
        "Use resources to read snapshot data (e.g. spendesk://settlements, spendesk://suppliers) for dashboards.",
        "When the user asks about API structure, endpoints, parameters, or how to use the Spendesk API, use the tool spendesk_get_api_reference or the resource spendesk://api-reference to return the list of endpoints, HTTP methods, paths, and parameters (query, path, body).",
      ].join(" "),
    }
  );
  registerTools(mcp, api);
  registerResources(mcp, api);
  return mcp;
}
