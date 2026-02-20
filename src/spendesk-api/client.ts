/**
 * Spendesk Public API client.
 * Base URL: https://public-api.spendesk.com (prod) or https://public-api.demo.spendesk.com (demo)
 * @see https://developer.spendesk.com/reference/general
 */

const DEFAULT_BASE_URL = "https://public-api.spendesk.com";
const DEFAULT_DEMO_BASE_URL = "https://beta-sandbox.api.trunk.spendesk.services";

export type SpendeskClientConfig = {
  /** Bearer token (from OAuth2 or API credentials). Do not commit. */
  apiToken: string;
  /** Use demo API when true. */
  useDemo?: boolean;
  /** Override base URL. */
  baseUrl?: string;
};

export class SpendeskApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "SpendeskApiError";
  }
}

export class SpendeskClient {
  private baseUrl: string;
  private apiToken: string;

  constructor(config: SpendeskClientConfig) {
    this.apiToken = config.apiToken;
    this.baseUrl =
      config.baseUrl ??
      (config.useDemo ?? false ? DEFAULT_DEMO_BASE_URL : DEFAULT_BASE_URL);
    if (!this.apiToken) {
      throw new Error("Spendesk API token is required");
    }
  }

  private async request<T>(
    method: string,
    path: string,
    options?: { body?: unknown; searchParams?: Record<string, string> }
  ): Promise<T> {
    const url = new URL(
      path.startsWith("http") ? path : `${this.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
    );
    if (options?.searchParams) {
      Object.entries(options.searchParams).forEach(([k, v]) =>
        url.searchParams.set(k, v)
      );
      // Debug: log purchase orders requests to verify filter params
      if (path.includes("purchase-orders")) {
        console.log("[DEBUG] Purchase Orders URL:", url.toString());
      }
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && (err as { cause?: { message?: string } }).cause?.message;
      throw new SpendeskApiError(
        cause ? `Spendesk API request failed: ${msg} (${cause})` : `Spendesk API request failed: ${msg}`,
        undefined,
        undefined
      );
    }
    const text = await res.text();
    let data: T;
    try {
      data = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      data = text as unknown as T;
    }
    if (!res.ok) {
      throw new SpendeskApiError(
        `Spendesk API error: ${res.status} ${res.statusText}`,
        res.status,
        data
      );
    }
    return data;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, { searchParams: params });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
