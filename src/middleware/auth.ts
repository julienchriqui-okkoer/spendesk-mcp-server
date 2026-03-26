/**
 * Authentication middleware for Spendesk API credentials.
 * Supports:
 * - Client credentials from client (Dust/Claude): Bearer "client_credentials:<base64(client_id:client_secret)>" or headers X-Spendesk-Client-Id + X-Spendesk-Client-Secret
 * - Optional: X-Spendesk-Environment: production|demo|trunk — force API host for this session. Alias: Spendesk-Environment.
 * - Optional legacy: X-Spendesk-Use-Demo: true | 1 — mapped to trunk.
 * - Direct Spendesk API token: Authorization: Bearer <apiToken> (used as-is, no database lookup)
 * If none present, the server falls back to environment credentials in buildApi.
 */

import type { Request, Response, NextFunction } from "express";
import {
  type SpendeskEnvironment,
  parseSpendeskEnvironmentHint,
} from "../spendesk-api/environment.js";

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
      /** Legacy hint from X-Spendesk-Use-Demo (true => trunk, false => production). */
      spendeskUseDemoHint?: boolean;
      /** From X-Spendesk-Environment on initialize; overrides server env for API base URL. */
      spendeskEnvironmentHint?: SpendeskEnvironment;
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
 * Also accepts Spendesk-Client-Id / Spendesk-Client-Secret for clients that strip X-.
 */
function getClientCredentialsFromHeaders(req: Request): ClientCredentials | null {
  const id =
    (req.headers["x-spendesk-client-id"] as string)?.trim() ||
    (req.headers["spendesk-client-id"] as string)?.trim();
  const secret =
    (req.headers["x-spendesk-client-secret"] as string)?.trim() ||
    (req.headers["spendesk-client-secret"] as string)?.trim();
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret };
}

/** X-Spendesk-Use-Demo (or Spendesk-Use-Demo): true | 1 | false | 0 — align API host with sandbox vs prod. */
function parseSpendeskUseDemoHint(req: Request): boolean | undefined {
  const value =
    (req.headers["x-spendesk-use-demo"] as string) ||
    (req.headers["spendesk-use-demo"] as string);
  const raw = value?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

/** X-Spendesk-Environment: production|prod|demo|trunk (or Spendesk-Environment). */
function parseEnvironmentHeaderHint(req: Request): SpendeskEnvironment | undefined {
  const raw =
    (req.headers["x-spendesk-environment"] as string) ||
    (req.headers["spendesk-environment"] as string);
  return parseSpendeskEnvironmentHint(raw);
}

function attachUseDemoHintIfCredentials(req: Request): void {
  const envHint = parseEnvironmentHeaderHint(req);
  if (envHint && (req.clientCredentials || req.clientToken)) {
    req.spendeskEnvironmentHint = envHint;
    req.spendeskUseDemoHint = envHint !== "production";
    return;
  }

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
