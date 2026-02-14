#!/usr/bin/env node
/**
 * Spendesk MCP Server (stdio)
 * @see https://developer.spendesk.com/reference/general
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SpendeskClient } from "./spendesk-api/client.js";
import { createMcpServer } from "./lib/create-server.js";

function getApiToken(): string {
  const token = process.env.SPENDESK_API_TOKEN;
  if (!token) {
    console.error("SPENDESK_API_TOKEN is required. Set it in your environment or .env.");
    process.exit(1);
  }
  return token;
}

async function main(): Promise<void> {
  const apiToken = getApiToken();
  const useDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
  const baseUrl = process.env.SPENDESK_BASE_URL;
  const api = new SpendeskClient({ apiToken, useDemo, baseUrl });
  const mcp = createMcpServer(api);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
