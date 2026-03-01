/**
 * Spendesk Public API client.
 * Base URL: https://public-api.spendesk.com (prod) or https://public-api.demo.spendesk.com (demo)
 * All monetary amounts in API responses are converted from cents to major units (EUR) before return.
 * @see https://developer.spendesk.com/reference/general
 */

import { convertAmountsInResponse } from "../lib/amounts.js";
import { sanitizePurchaseOrder } from "../lib/sanitize-purchase-order.js";

const DEFAULT_BASE_URL = "https://public-api.spendesk.com";
const DEFAULT_DEMO_BASE_URL = "https://beta-sandbox.api.trunk.spendesk.services";

export type SpendeskClientConfig = {
  /** Bearer token (from OAuth2 or API credentials). Do not commit. */
  apiToken: string;
  /** Use demo API when true. */
  useDemo?: boolean;
  /** Override base URL. */
  baseUrl?: string;
  /** Optional: resolve current token (e.g. from TokenManager). Used for Authorization header when set. */
  getToken?: () => Promise<string>;
  /** Optional: when 401 is received, call this then retry once (e.g. refresh token). */
  on401Refresh?: () => Promise<void>;
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
  private getToken?: () => Promise<string>;
  private on401Refresh?: () => Promise<void>;

  constructor(config: SpendeskClientConfig) {
    this.apiToken = config.apiToken;
    this.getToken = config.getToken;
    this.on401Refresh = config.on401Refresh;
    this.baseUrl =
      config.baseUrl ??
      (config.useDemo ?? false ? DEFAULT_DEMO_BASE_URL : DEFAULT_BASE_URL);
    if (!this.apiToken && !this.getToken) {
      throw new Error("Spendesk API token is required");
    }
  }

  private async getAuthToken(): Promise<string> {
    if (this.getToken) return this.getToken();
    return this.apiToken;
  }

  private static readonly MAX_429_RETRIES = 3;
  private static readonly MAX_409_RETRIES = 3;

  private async request<T>(
    method: string,
    path: string,
    options?: { body?: unknown; searchParams?: Record<string, string> },
    is401Retry = false,
    retry429Count = 0,
    retry409Count = 0
  ): Promise<T> {
    const url = new URL(
      path.startsWith("http") ? path : `${this.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
    );
    if (options?.searchParams) {
      Object.entries(options.searchParams).forEach(([k, v]) =>
        url.searchParams.set(k, v)
      );
    }
    const token = await this.getAuthToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
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
    // Truncate purchase-orders at source so MCP never sees huge payload (lineItems[], payables[], etc.)
    if (method === "GET" && path.includes("purchase-orders") && data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      let list: unknown[] | undefined = d.purchaseOrders as unknown[] | undefined;
      let target: Record<string, unknown> | undefined = d;
      let key: string = "purchaseOrders";
      if (!Array.isArray(list)) {
        list = d.data as unknown[] | undefined;
        key = "data";
      }
      if (!Array.isArray(list) && d.result && typeof d.result === "object") {
        const res = d.result as Record<string, unknown>;
        list = res.data as unknown[] | undefined;
        if (Array.isArray(list)) {
          target = res;
          key = "data";
        }
      }
      if (Array.isArray(list) && target) {
        target[key] = list.map((po: unknown) => sanitizePurchaseOrder(po));
      }
    }
    if (res.status === 401 && this.on401Refresh && !is401Retry) {
      await this.on401Refresh();
      return this.request<T>(method, path, options, true, 0, 0);
    }
    if (res.status === 429 && retry429Count < SpendeskClient.MAX_429_RETRIES) {
      const retryAfter = res.headers.get("Retry-After");
      let waitMs = 2000;
      if (retryAfter) {
        const sec = parseInt(retryAfter, 10);
        if (!Number.isNaN(sec)) waitMs = Math.min(sec * 1000, 60_000);
      } else {
        waitMs = 2000 * 2 ** retry429Count;
      }
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request<T>(method, path, options, is401Retry, retry429Count + 1, retry409Count);
    }
    if (res.status === 409 && retry409Count < SpendeskClient.MAX_409_RETRIES) {
      const waitMs = 5000 * 2 ** retry409Count; // 5s, 10s, 20s
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request<T>(method, path, options, is401Retry, retry429Count, retry409Count + 1);
    }
    if (!res.ok) {
      const bodyHint =
        data && typeof data === "object"
          ? (data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error ?? JSON.stringify(data).slice(0, 300)
          : String(data).slice(0, 300);
      const msg =
        res.status >= 500
          ? `Spendesk API error: ${res.status} ${res.statusText}. Server-side error — see body. Body: ${bodyHint}`
          : `Spendesk API error: ${res.status} ${res.statusText}`;
      throw new SpendeskApiError(msg, res.status, data);
    }
    return convertAmountsInResponse(data) as T;
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
