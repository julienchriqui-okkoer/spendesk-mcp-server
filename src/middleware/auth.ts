/**
 * Authentication middleware for client API keys.
 * Extracts X-Client-Token header and resolves Spendesk token from database.
 */

import type { Request, Response, NextFunction } from "express";
import { DatabaseClient } from "../db/client.js";

// Extend Express Request type to include clientToken
declare global {
  namespace Express {
    interface Request {
      clientToken?: string;
      clientApiKey?: string;
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
 * Middleware to authenticate client via X-Client-Token header.
 * If header is present, resolves Spendesk token from database.
 * If not present, request continues (fallback to env var token).
 */
export function authenticateClient(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers["x-client-token"] as string | undefined;
  
  if (!apiKey) {
    // No client token provided, continue without it (will use env var fallback)
    return next();
  }

  try {
    const client = getDbClient();
    const spendeskToken = client.getClientToken(apiKey);
    
    if (!spendeskToken) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Invalid or expired client token",
        },
        id: null,
      });
      return;
    }

    // Inject client token into request
    req.clientToken = spendeskToken;
    req.clientApiKey = apiKey;
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
