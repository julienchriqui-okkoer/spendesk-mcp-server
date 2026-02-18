/**
 * Database client for managing client tokens.
 * Provides CRUD operations with encryption/decryption.
 */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createDatabase, encryptToken, decryptToken, type Client } from "./schema.js";

/** Generate a URL-safe slug from a label (e.g. "Spendesk FR" -> "spendesk-fr"). */
function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "company";
}

export interface CompanyInfo {
  company_key: string;
  label: string;
}

export class DatabaseClient {
  private db: Database.Database;

  constructor() {
    this.db = createDatabase();
  }

  /**
   * Create a new client with encrypted token.
   * Optionally creates a first company (for multi-company flow).
   * Returns the API key (UUID) for the client.
   */
  createClient(spendeskToken: string, firstCompanyLabel?: string): string {
    const apiKey = randomUUID();
    const encrypted = encryptToken(spendeskToken);
    const insertClient = this.db.prepare(`
      INSERT INTO clients (api_key, spendesk_token_encrypted, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
    `);
    insertClient.run(apiKey, encrypted);

    if (firstCompanyLabel != null && firstCompanyLabel.trim() !== "") {
      const clientRow = this.db.prepare("SELECT id FROM clients WHERE api_key = ?").get(apiKey) as { id: number };
      const companyKey = this.ensureUniqueCompanyKey(clientRow.id, slugify(firstCompanyLabel));
      const insertCompany = this.db.prepare(`
        INSERT INTO companies (client_id, company_key, label, spendesk_token_encrypted, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `);
      insertCompany.run(clientRow.id, companyKey, firstCompanyLabel.trim(), encrypted);
    }
    return apiKey;
  }

  /**
   * Create a new company for an existing client.
   * Returns the company_key (slug, unique per client).
   */
  createCompany(apiKey: string, label: string, spendeskToken: string): string {
    const client = this.getClientInfo(apiKey);
    if (!client) {
      throw new Error("Client not found");
    }
    const encrypted = encryptToken(spendeskToken);
    const companyKey = this.ensureUniqueCompanyKey(client.id, slugify(label));
    const stmt = this.db.prepare(`
      INSERT INTO companies (client_id, company_key, label, spendesk_token_encrypted, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    stmt.run(client.id, companyKey, label.trim(), encrypted);
    return companyKey;
  }

  private ensureUniqueCompanyKey(clientId: number, baseKey: string): string {
    let key = baseKey;
    let n = 0;
    const exists = this.db.prepare("SELECT 1 FROM companies WHERE company_key = ? LIMIT 1");
    while (exists.get(key)) {
      n += 1;
      key = `${baseKey}-${n}`;
    }
    return key;
  }

  /**
   * Get Spendesk token for a specific company. Returns null if not found.
   */
  getCompanyToken(apiKey: string, companyKey: string): string | null {
    const stmt = this.db.prepare(`
      SELECT c.spendesk_token_encrypted
      FROM companies c
      INNER JOIN clients cl ON cl.id = c.client_id
      WHERE cl.api_key = ? AND c.company_key = ?
    `);
    const row = stmt.get(apiKey, companyKey) as { spendesk_token_encrypted: string } | undefined;
    if (!row) return null;
    try {
      return decryptToken(row.spendesk_token_encrypted);
    } catch (err) {
      console.error("Failed to decrypt company token:", err);
      return null;
    }
  }

  /**
   * List companies for a client (company_key and label only).
   */
  listCompanies(apiKey: string): CompanyInfo[] {
    const stmt = this.db.prepare(`
      SELECT c.company_key, c.label
      FROM companies c
      INNER JOIN clients cl ON cl.id = c.client_id
      WHERE cl.api_key = ?
      ORDER BY c.id ASC
    `);
    const rows = stmt.all(apiKey) as CompanyInfo[];
    return rows;
  }

  /**
   * Get client by API key and return decrypted token (default token).
   * Default = first company's token if client has companies, else legacy client token.
   * Returns null if not found.
   */
  getClientToken(apiKey: string): string | null {
    const companies = this.listCompanies(apiKey);
    if (companies.length > 0) {
      return this.getCompanyToken(apiKey, companies[0].company_key);
    }
    const stmt = this.db.prepare(`
      SELECT spendesk_token_encrypted FROM clients WHERE api_key = ?
    `);
    const row = stmt.get(apiKey) as { spendesk_token_encrypted: string } | undefined;
    if (!row) return null;
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
