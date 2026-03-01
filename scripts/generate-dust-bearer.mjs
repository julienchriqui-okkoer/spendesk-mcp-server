#!/usr/bin/env node
/**
 * Generate Bearer token for Dust (or any client) when using client credentials.
 * Format: client_credentials:<base64(client_id:client_secret)>
 *
 * Usage:
 *   node scripts/generate-dust-bearer.mjs <client_id> <client_secret>
 *   SPENDESK_CLIENT_ID=xxx SPENDESK_CLIENT_SECRET=yyy node scripts/generate-dust-bearer.mjs
 *
 * Paste the output in Dust: Tools → Spendesk MCP Server → Bearer Token (Authorization).
 */

const clientId = process.argv[2] || process.env.SPENDESK_CLIENT_ID;
const clientSecret = process.argv[3] || process.env.SPENDESK_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Usage: node scripts/generate-dust-bearer.mjs <client_id> <client_secret>");
  console.error("   or: SPENDESK_CLIENT_ID=... SPENDESK_CLIENT_SECRET=... node scripts/generate-dust-bearer.mjs");
  process.exit(1);
}

const payload = `${clientId}:${clientSecret}`;
const token = "client_credentials:" + Buffer.from(payload, "utf8").toString("base64");
console.log("Paste this as Bearer Token in Dust (Spendesk MCP Server):");
console.log("");
console.log(token);
console.log("");
