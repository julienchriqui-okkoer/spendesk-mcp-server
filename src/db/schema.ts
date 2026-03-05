/**
 * Database schema and migrations for MCP usage monitoring.
 * Uses SQLite with automatic migrations.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Validate DB_PATH so it cannot point outside ./data (prevents path traversal). */
function getSafeDbPath(): string {
  const rawPath = process.env.DB_PATH ?? "./data/clients.db";
  const resolved = resolve(rawPath);
  const allowedBase = resolve("./data");
  if (!resolved.startsWith(allowedBase)) {
    throw new Error(`Security: DB_PATH "${rawPath}" is outside the allowed directory`);
  }
  mkdirSync(dirname(resolved), { recursive: true });
  return resolved;
}

const DB_PATH = getSafeDbPath();

/**
 * Initialize database schema (create tables if they don't exist).
 * This single-tenant version only keeps the mcp_usage_events table.
 */
export function initDatabase(db: Database.Database): void {
  db.exec(`
    -- MCP usage monitoring: generic event table for HTTP and tool calls
    CREATE TABLE IF NOT EXISTS mcp_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,                         -- ISO timestamp
      client_hash TEXT,                         -- anonymized client identifier (hash of API key or credentials)
      company_key TEXT,                         -- optional company identifier (if available)
      session_id TEXT,                          -- optional MCP session id
      method TEXT,                              -- MCP method (initialize, tools/call, resources/read, etc.) or HTTP method
      tool_name TEXT,                           -- MCP tool name when applicable
      category TEXT,                            -- logical category (spend_analysis, ap_aging, bookkeeping, reference_data, etc.)
      duration_ms INTEGER,                      -- execution time in milliseconds
      status TEXT,                              -- success / error
      error_code TEXT,                          -- optional error code or class name
      result_size INTEGER,                      -- approximate response size (bytes or item count)
      meta_json TEXT                            -- additional structured metadata as JSON (sanitized)
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_usage_ts ON mcp_usage_events(ts);
    CREATE INDEX IF NOT EXISTS idx_mcp_usage_client ON mcp_usage_events(client_hash);
    CREATE INDEX IF NOT EXISTS idx_mcp_usage_tool ON mcp_usage_events(tool_name);
    CREATE INDEX IF NOT EXISTS idx_mcp_usage_category ON mcp_usage_events(category);
  `);
}

/**
 * Create a new database instance with schema initialized.
 */
export function createDatabase(): Database.Database {
  try {
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initDatabase(db);
    console.log(`✓ Database initialized: ${DB_PATH}`);
    return db;
  } catch (err) {
    console.error("❌ Failed to initialize database:", err);
    throw err;
  }
}
