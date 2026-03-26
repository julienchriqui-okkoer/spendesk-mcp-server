#!/usr/bin/env node
import "dotenv/config";
/**
 * Spendesk MCP Server (stdio)
 * @see https://developer.spendesk.com/reference/general
 *
 * Auth (same idea as server-http): OAuth2 client credentials only (no SPENDESK_API_TOKEN):
 * - SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET (prod)
 * - or SPENDESK_ENV=demo with SPENDESK_CLIENT_ID_DEMO + SPENDESK_CLIENT_SECRET_DEMO
 * - or SPENDESK_ENV=trunk with SPENDESK_CLIENT_ID_TRUNK + SPENDESK_CLIENT_SECRET_TRUNK
 * Legacy compatibility: SPENDESK_USE_DEMO=true maps to trunk.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SpendeskClient } from "./spendesk-api/client.js";
import { ClientCredentialsAuth } from "./spendesk-api/client-credentials-auth.js";
import { createMcpServer } from "./lib/create-server.js";
import {
  type SpendeskEnvironment,
  resolveSpendeskBaseUrl,
  resolveSpendeskEnvironmentFromEnv,
} from "./spendesk-api/environment.js";

function getEnvClientId(environment: SpendeskEnvironment): string | null {
  if (environment !== "production") {
    // Some setups only provide SPENDESK_CLIENT_ID/SECRET for non-production environments.
    return (
      process.env.SPENDESK_CLIENT_ID_DEMO?.trim() ||
      process.env.SPENDESK_CLIENT_ID_TRUNK?.trim() ||
      process.env.SPENDESK_CLIENT_ID?.trim() ||
      null
    );
  }
  return process.env.SPENDESK_CLIENT_ID?.trim() || null;
}

function getEnvClientSecret(environment: SpendeskEnvironment): string | null {
  if (environment !== "production") {
    // Same fallback logic as getEnvClientId().
    return (
      process.env.SPENDESK_CLIENT_SECRET_DEMO?.trim() ||
      process.env.SPENDESK_CLIENT_SECRET_TRUNK?.trim() ||
      process.env.SPENDESK_CLIENT_SECRET?.trim() ||
      null
    );
  }
  return process.env.SPENDESK_CLIENT_SECRET?.trim() || null;
}

function buildSpendeskClient(): SpendeskClient {
  const environment = resolveSpendeskEnvironmentFromEnv();
  const clientId = getEnvClientId(environment);
  const clientSecret = getEnvClientSecret(environment);
  if (clientId && clientSecret) {
    const baseUrl = resolveSpendeskBaseUrl(environment, process.env.SPENDESK_BASE_URL);
    const cc = new ClientCredentialsAuth({ baseUrl, clientId, clientSecret });
    return new SpendeskClient({
      apiToken: "",
      environment,
      baseUrl,
      getToken: () => cc.getAccessToken(),
      on401Refresh: () => cc.refresh(),
    });
  }

  console.error(
    [
      "Spendesk OAuth2 client credentials required for stdio MCP:",
      "  • SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET (production API)",
      "  • SPENDESK_ENV=demo and SPENDESK_CLIENT_ID_DEMO + SPENDESK_CLIENT_SECRET_DEMO",
      "  • SPENDESK_ENV=trunk and SPENDESK_CLIENT_ID_TRUNK + SPENDESK_CLIENT_SECRET_TRUNK",
      "  (non-prod fallback: _DEMO/_TRUNK vars can reuse SPENDESK_CLIENT_ID/SECRET).",
      "Optional: SPENDESK_BASE_URL to override the API host.",
    ].join("\n")
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const api = buildSpendeskClient();
  const mcp = createMcpServer(api);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
