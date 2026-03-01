/**
 * Client credentials auth: get access token via POST /v1/auth/token.
 * Uses Basic auth (base64(client_id:client_secret)) and grant_type: client_credentials.
 * Refresh = call the same endpoint again (no refresh_token in this flow).
 * @see https://developer.spendesk.com/reference/general
 */

import { SpendeskPaths } from "./endpoints.js";

export type ClientCredentialsConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
};

export class ClientCredentialsAuth {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private fetchPromise: Promise<string> | null = null;

  constructor(config: ClientCredentialsConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  /** Basic auth header value: base64(client_id:client_secret) */
  private getBasicAuth(): string {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
      "utf8"
    ).toString("base64");
    return credentials;
  }

  /** Fetch a new access token from POST /v1/auth/token. */
  private async fetchToken(): Promise<string> {
    const url = `${this.baseUrl}${SpendeskPaths.authToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${this.getBasicAuth()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ grant_type: "client_credentials" }),
    });
    const data = (await res.json()) as TokenResponse & { error?: string };
    if (!res.ok) {
      throw new Error(
        `Client credentials token failed: ${res.status} ${res.statusText} — ${JSON.stringify(data)}`
      );
    }
    const token = data.access_token;
    if (!token) {
      throw new Error(
        `Client credentials response missing access_token: ${JSON.stringify(data)}`
      );
    }
    return token;
  }

  /** Get current access token; fetches one if not cached. Safe to call concurrently (single flight). */
  async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (this.fetchPromise) return this.fetchPromise;
    this.fetchPromise = this.fetchToken();
    try {
      this.accessToken = await this.fetchPromise;
      return this.accessToken;
    } finally {
      this.fetchPromise = null;
    }
  }

  /** Refresh: fetch a new token (e.g. on 401). Clears cache then fetches. */
  async refresh(): Promise<void> {
    this.accessToken = null;
    this.fetchPromise = null;
    this.accessToken = await this.fetchToken();
  }
}
