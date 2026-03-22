/**
 * Authentication middleware for Spendesk API credentials.
 * Supports:
 * - Client credentials from client (Dust/Claude): Bearer "client_credentials:<base64(client_id:client_secret)>" or headers X-Spendesk-Client-Id + X-Spendesk-Client-Secret
 * - Optional: X-Spendesk-Use-Demo: true | 1 — force sandbox/trunk API host for this session when using client credentials (required if Railway has SPENDESK_USE_DEMO=false but credentials are sandbox).
 * - Direct Spendesk API token: Authorization: Bearer <apiToken> (used as-is, no database lookup)
 * If none present, the server falls back to environment credentials in buildApi.
 */

import type { Request, Response, NextFunction } from "express";

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      clientToken?: string;
      /** When set, use POST /v1/auth/token with these credentials (no DB lookup). */
      clientCredentials?: ClientCredentials;
      /** From X-Spendesk-Use-Demo on initialize; overrides server env for API base URL with client credentials. */
      spendeskUseDemoHint?: boolean;
    }
  }
}

const CLIENT_CREDENTIALS_PREFIX = "client_credentials:";

/**
 * Parse client credentials from Bearer "client_credentials:<base64(client_id:client_secret)>".
 * Returns null if not in that format or decode fails.
 */
function parseClientCredentialsFromBearer(token: string): ClientCredentials | null {
  if (!token.startsWith(CLIENT_CREDENTIALS_PREFIX)) return null;
  const b64 = token.slice(CLIENT_CREDENTIALS_PREFIX.length).trim();
  if (!b64) return null;
  try {
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    const firstColon = decoded.indexOf(":");
    if (firstColon <= 0 || firstColon === decoded.length - 1) return null;
    const clientId = decoded.slice(0, firstColon).trim();
    const clientSecret = decoded.slice(firstColon + 1).trim();
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  } catch {
    return null;
  }
}

/**
 * Resolve client credentials from headers (X-Spendesk-Client-Id + X-Spendesk-Client-Secret).
 */
function getClientCredentialsFromHeaders(req: Request): ClientCredentials | null {
  const id = (req.headers["x-spendesk-client-id"] as string)?.trim();
  const secret = (req.headers["x-spendesk-client-secret"] as string)?.trim();
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret };
}

/** X-Spendesk-Use-Demo: true | 1 | false | 0 — when client sends OAuth credentials, align API host with sandbox vs prod. */
function parseSpendeskUseDemoHint(req: Request): boolean | undefined {
  const raw = (req.headers["x-spendesk-use-demo"] as string)?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

function attachUseDemoHintIfCredentials(req: Request): void {
  const hint = parseSpendeskUseDemoHint(req);
  if (hint !== undefined && (req.clientCredentials || req.clientToken)) {
    req.spendeskUseDemoHint = hint;
  }
}

/**
 * Middleware to authenticate client.
 * Priority:
 * 1. Client credentials from client: Bearer "client_credentials:<base64(id:secret)>" or X-Spendesk-Client-Id + X-Spendesk-Client-Secret
 * 2. Direct Spendesk API token: Bearer <apiToken> (used directly without database)
 * If none present, request continues (fallback to env).
 */
export function authenticateClient(req: Request, res: Response, next: NextFunction): void {
  // 1) Client credentials: Bearer or headers
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const cc = parseClientCredentialsFromBearer(token);
    if (cc) {
      req.clientCredentials = cc;
      attachUseDemoHintIfCredentials(req);
      return next();
    }

    // Not client_credentials: treat as direct Spendesk API token
    if (token) {
      req.clientToken = token;
      attachUseDemoHintIfCredentials(req);
      return next();
    }
  }
  const ccHeaders = getClientCredentialsFromHeaders(req);
  if (ccHeaders) {
    req.clientCredentials = ccHeaders;
    attachUseDemoHintIfCredentials(req);
    return next();
  }

  // 2) No explicit credentials: continue and fall back to environment-based credentials in buildApi
  return next();
}
