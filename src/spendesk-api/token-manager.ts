/**
 * OAuth2 token manager: holds access + refresh token and refreshes on demand.
 * Used to auto-refresh on 401 so long-running workflows (e.g. 40-page aggregation) don't fail.
 * @see https://developer.spendesk.com/reference/general (OAuth2 / Refresh Token)
 */

const OAUTH2_REFRESH_PATH = "/v1/oauth2/token/refresh";

export type TokenManagerConfig = {
  baseUrl: string;
  refreshToken: string;
  initialAccessToken: string;
  onTokensUpdated?: (accessToken: string, refreshToken?: string) => void;
};

export class TokenManager {
  private baseUrl: string;
  private refreshToken: string;
  private accessToken: string;
  private onTokensUpdated?: (accessToken: string, refreshToken?: string) => void;
  private refreshPromise: Promise<void> | null = null;

  constructor(config: TokenManagerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.refreshToken = config.refreshToken;
    this.accessToken = config.initialAccessToken;
    this.onTokensUpdated = config.onTokensUpdated;
  }

  getAccessToken(): Promise<string> {
    return Promise.resolve(this.accessToken);
  }

  /**
   * Refresh access token using refresh_token. Safe to call concurrently (single flight).
   */
  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<void> {
    const url = `${this.baseUrl}${OAUTH2_REFRESH_PATH}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refresh_token: this.refreshToken }),
    });
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status} ${res.statusText} — ${JSON.stringify(data)}`);
    }
    if (data.access_token) this.accessToken = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.onTokensUpdated?.(this.accessToken, this.refreshToken);
  }
}
