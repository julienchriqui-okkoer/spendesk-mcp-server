/**
 * Request-scoped context for MCP HTTP transport.
 * Used to pass session ID into ephemeral SQLite so each session gets its own DB.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const mcpSessionStorage = new AsyncLocalStorage<string | null>();

export function getMcpSessionId(): string | null {
  return mcpSessionStorage.getStore() ?? null;
}
