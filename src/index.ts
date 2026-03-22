#!/usr/bin/env node
import "dotenv/config";
/**
 * Spendesk MCP Server (stdio)
 * @see https://developer.spendesk.com/reference/general
 *
 * Auth (same idea as server-http): OAuth2 client credentials only (no SPENDESK_API_TOKEN):
 * - SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET (prod)
 * - or SPENDESK_USE_DEMO=true with SPENDESK_CLIENT_ID_DEMO + SPENDESK_CLIENT_SECRET_DEMO
 *   (stdio falls back to SPENDESK_CLIENT_ID/SECRET if _DEMO vars are missing)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SpendeskClient } from "./spendesk-api/client.js";
import { ClientCredentialsAuth } from "./spendesk-api/client-credentials-auth.js";
import { createMcpServer } from "./lib/create-server.js";

function getEnvClientId(useDemo: boolean): string | null {
  if (useDemo) {
    // Some environments only provide SPENDESK_CLIENT_ID/SECRET even when SPENDESK_USE_DEMO=true.
    return (
      process.env.SPENDESK_CLIENT_ID_DEMO?.trim() ||
      process.env.SPENDESK_CLIENT_ID?.trim() ||
      null
    );
  }
  return process.env.SPENDESK_CLIENT_ID?.trim() || null;
}

function getEnvClientSecret(useDemo: boolean): string | null {
  if (useDemo) {
    // Same fallback logic as getEnvClientId().
    return (
      process.env.SPENDESK_CLIENT_SECRET_DEMO?.trim() ||
      process.env.SPENDESK_CLIENT_SECRET?.trim() ||
      null
    );
  }
  return process.env.SPENDESK_CLIENT_SECRET?.trim() || null;
}

function resolveAuthBaseUrl(useDemo: boolean): string {
  const fromEnv = process.env.SPENDESK_BASE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return useDemo
    ? "https://beta-sandbox.api.trunk.spendesk.services"
    : "https://public-api.spendesk.com";
}

function buildSpendeskClient(): SpendeskClient {
  const useDemo = process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
  const clientId = getEnvClientId(useDemo);
  const clientSecret = getEnvClientSecret(useDemo);
  if (clientId && clientSecret) {
    const baseUrl = resolveAuthBaseUrl(useDemo);
    const cc = new ClientCredentialsAuth({ baseUrl, clientId, clientSecret });
    return new SpendeskClient({
      apiToken: "",
      useDemo,
      baseUrl,
      getToken: () => cc.getAccessToken(),
      on401Refresh: () => cc.refresh(),
    });
  }

  console.error(
    [
      "Spendesk OAuth2 client credentials required for stdio MCP:",
      "  • SPENDESK_CLIENT_ID + SPENDESK_CLIENT_SECRET (production API)",
      "  • SPENDESK_USE_DEMO=true and SPENDESK_CLIENT_ID_DEMO + SPENDESK_CLIENT_SECRET_DEMO",
      "  (If _DEMO vars are missing in demo mode, SPENDESK_CLIENT_ID/SECRET are reused.)",
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
