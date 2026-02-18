/**
 * Authentication middleware for client API keys.
 * Extracts X-Client-Token header and resolves Spendesk token from database.
 */

import type { Request, Response, NextFunction } from "express";
import { DatabaseClient } from "../db/client.js";

// Extend Express Request type to include clientToken and companyId
declare global {
  namespace Express {
    interface Request {
      clientToken?: string;
      clientApiKey?: string;
      companyId?: string;
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

/**
 * Resolve API key and optional company ID from request.
 * Supports:
 * - Authorization: Bearer <apiKey> or Bearer <apiKey>:<companyKey> (for Dust and clients that only send Bearer)
 * - X-Client-Token + optional X-Company-Id
 */
function getAuthFromRequest(req: Request): { apiKey: string; companyId?: string } | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (!token) return null;
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
 * Middleware to authenticate client via X-Client-Token or Authorization Bearer.
 * Optional company: X-Company-Id header or Bearer "apiKey:companyKey" (for Dust multi-company).
 * If credentials present, resolves Spendesk token from database.
 * If not present, request continues (fallback to env var token).
 */
export function authenticateClient(req: Request, res: Response, next: NextFunction): void {
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
