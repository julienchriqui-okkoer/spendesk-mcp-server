/**
 * Database client for managing client tokens.
 * Provides CRUD operations with encryption/decryption.
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createDatabase, encryptToken, decryptToken, type Client } from "./schema.js";

export class DatabaseClient {
  private db: Database.Database;

  constructor() {
    this.db = createDatabase();
  }

  /**
   * Create a new client with encrypted token.
   * Returns the API key (UUID) for the client.
   */
  createClient(spendeskToken: string): string {
    const apiKey = randomUUID();
    const encrypted = encryptToken(spendeskToken);
    
    const stmt = this.db.prepare(`
      INSERT INTO clients (api_key, spendesk_token_encrypted, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
    `);
    
    stmt.run(apiKey, encrypted);
    return apiKey;
  }

  /**
   * Get client by API key and return decrypted token.
   * Returns null if not found.
   */
  getClientToken(apiKey: string): string | null {
    const stmt = this.db.prepare(`
      SELECT spendesk_token_encrypted FROM clients WHERE api_key = ?
    `);
    
    const row = stmt.get(apiKey) as { spendesk_token_encrypted: string } | undefined;
    if (!row) {
      return null;
    }
    
    try {
      return decryptToken(row.spendesk_token_encrypted);
    } catch (err) {
      console.error("Failed to decrypt token:", err);
      return null;
    }
  }

  /**
   * Update client token.
   */
  updateClientToken(apiKey: string, spendeskToken: string): boolean {
    const encrypted = encryptToken(spendeskToken);
    
    const stmt = this.db.prepare(`
      UPDATE clients 
      SET spendesk_token_encrypted = ?, updated_at = datetime('now')
      WHERE api_key = ?
    `);
    
    const result = stmt.run(encrypted, apiKey);
    return result.changes > 0;
  }

  /**
   * Check if API key exists.
   */
  apiKeyExists(apiKey: string): boolean {
    const stmt = this.db.prepare(`SELECT 1 FROM clients WHERE api_key = ? LIMIT 1`);
    return !!stmt.get(apiKey);
  }

  /**
   * Get client info (without token) by API key.
   */
  getClientInfo(apiKey: string): Omit<Client, "spendesk_token_encrypted"> | null {
    const stmt = this.db.prepare(`
      SELECT id, api_key, created_at, updated_at FROM clients WHERE api_key = ?
    `);
    
    const row = stmt.get(apiKey) as Omit<Client, "spendesk_token_encrypted"> | undefined;
    return row || null;
  }

  /**
   * Close database connection.
   */
  close(): void {
    this.db.close();
  }
}
