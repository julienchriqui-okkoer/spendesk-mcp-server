/**
 * Authentication middleware for client API keys and client credentials.
 * Supports:
 * - Client credentials from client (Dust/Claude): Bearer "client_credentials:<base64(client_id:client_secret)>" or headers X-Spendesk-Client-Id + X-Spendesk-Client-Secret
 * - API key: X-Client-Token or Bearer <apiKey> (resolves to Spendesk token from database)
 */

import type { Request, Response, NextFunction } from "express";
import { DatabaseClient } from "../db/client.js";

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      clientToken?: string;
      clientApiKey?: string;
      companyId?: string;
      /** When set, use POST /v1/auth/token with these credentials (no DB lookup). */
      clientCredentials?: ClientCredentials;
    }
  }
}

// Lazy initialization of database client to avoid errors at module load time
let dbClient: DatabaseClient | null = null;

function getDbClient(): DatabaseClient {
  if (!dbClient) {
    try {
      dbClient = new DatabaseClient();
    } catch (err) {
      console.error("Failed to initialize database client:", err);
      throw err;
    }
  }
  return dbClient;
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

/**
 * Resolve API key and optional company ID from request (when not using client credentials).
 * Supports:
 * - Authorization: Bearer <apiKey> or Bearer <apiKey>:<companyKey> (for Dust and clients that only send Bearer)
 * - X-Client-Token + optional X-Company-Id
 */
function getAuthFromRequest(req: Request): { apiKey: string; companyId?: string } | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    // Do not treat client_credentials Bearer as apiKey
    if (token.startsWith(CLIENT_CREDENTIALS_PREFIX)) return null;
    const colon = token.indexOf(":");
    if (colon > 0) {
      return { apiKey: token.slice(0, colon), companyId: token.slice(colon + 1).trim() || undefined };
    }
    return { apiKey: token, companyId: undefined };
  }
  const apiKey = req.headers["x-client-token"] as string | undefined;
  if (!apiKey?.trim()) return null;
  const companyId = req.headers["x-company-id"] as string | undefined;
  return {
    apiKey: apiKey.trim(),
    companyId: companyId != null && companyId.trim() !== "" ? companyId.trim() : undefined,
  };
}

/**
 * Middleware to authenticate client.
 * Priority:
 * 1. Client credentials from client: Bearer "client_credentials:<base64(id:secret)>" or X-Spendesk-Client-Id + X-Spendesk-Client-Secret
 * 2. API key: X-Client-Token or Bearer <apiKey> (resolves to Spendesk token from DB)
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
      return next();
    }
  }
  const ccHeaders = getClientCredentialsFromHeaders(req);
  if (ccHeaders) {
    req.clientCredentials = ccHeaders;
    return next();
  }

  // 2) API key -> DB -> Spendesk token
  const auth = getAuthFromRequest(req);
  if (!auth) {
    return next();
  }

  const { apiKey, companyId } = auth;

  try {
    const client = getDbClient();
    const spendeskToken = companyId
      ? client.getCompanyToken(apiKey, companyId)
      : client.getClientToken(apiKey);

    if (!spendeskToken) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: companyId
            ? "Invalid or expired client token or unknown company ID"
            : "Invalid or expired client token",
        },
        id: null,
      });
      return;
    }

    req.clientToken = spendeskToken;
    req.clientApiKey = apiKey;
    if (companyId) req.companyId = companyId;
    next();
  } catch (err) {
    console.error("Authentication error:", err);
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : "Internal server error during authentication",
      },
      id: null,
    });
  }
}
