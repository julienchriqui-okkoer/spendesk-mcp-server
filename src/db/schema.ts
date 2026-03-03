/**
 * Database schema and migrations for client token storage.
 * Uses SQLite with automatic migrations.
 */

import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/clients.db";

export interface Client {
  id: number;
  api_key: string;
  spendesk_token_encrypted: string;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: number;
  client_id: number;
  company_key: string;
  label: string;
  spendesk_token_encrypted: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get encryption key from environment or generate a warning.
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    const error = new Error(
      "ENCRYPTION_KEY environment variable is required. Generate one with: node scripts/generate-encryption-key.mjs"
    );
    console.error("❌ ENCRYPTION_KEY missing:", error.message);
    throw error;
  }
  if (keyHex.length !== 64) {
    const error = new Error(`ENCRYPTION_KEY must be 64 hex characters (32 bytes), got ${keyHex.length}`);
    console.error("❌ ENCRYPTION_KEY invalid:", error.message);
    throw error;
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt a token using AES-256-GCM.
 */
export function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a token using AES-256-GCM.
 */
export function decryptToken(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }
  
  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

/**
 * Initialize database schema (create tables if they don't exist).
 */
export function initDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT UNIQUE NOT NULL,
      spendesk_token_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    
    CREATE INDEX IF NOT EXISTS idx_clients_api_key ON clients(api_key);

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      company_key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      spendesk_token_encrypted TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_companies_client_id ON companies(client_id);
    CREATE INDEX IF NOT EXISTS idx_companies_company_key ON companies(company_key);

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
    // Ensure the directory exists before creating the database
    const dbDir = dirname(DB_PATH);
    mkdirSync(dbDir, { recursive: true });
    console.log(`✓ Database directory created/verified: ${dbDir}`);
  } catch (err) {
    // Ignore error if directory already exists
    if (err && typeof err === "object" && "code" in err && err.code !== "EEXIST") {
      console.error("❌ Failed to create database directory:", err);
      throw err;
    }
  }
  
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
