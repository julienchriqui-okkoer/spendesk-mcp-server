export type SpendeskEnvironment = "production" | "demo" | "trunk";

export const SPENDESK_BASE_URLS: Record<SpendeskEnvironment, string> = {
  production: "https://public-api.spendesk.com",
  demo: "https://public-api.demo.spendesk.com",
  trunk: "https://public-api.trunk.spendesk.dev",
};

function parseBoolean(value?: string): boolean {
  const v = value?.trim().toLowerCase();
  return v === "true" || v === "1";
}

function normalizeEnvironment(raw?: string): SpendeskEnvironment | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (value === "prod" || value === "production") return "production";
  if (value === "demo" || value === "sandbox") return "demo";
  if (value === "trunk" || value === "dev" || value === "development") return "trunk";
  return null;
}

/**
 * Environment resolution priority:
 * 1) explicit SPENDESK_ENV=production|demo|trunk
 * 2) legacy SPENDESK_USE_DEMO=true => trunk (legacy behavior)
 * 3) default production
 */
export function resolveSpendeskEnvironmentFromEnv(): SpendeskEnvironment {
  const fromEnv = normalizeEnvironment(process.env.SPENDESK_ENV);
  if (fromEnv) return fromEnv;
  if (parseBoolean(process.env.SPENDESK_USE_DEMO)) return "trunk";
  return "production";
}

export function resolveSpendeskBaseUrl(
  env: SpendeskEnvironment,
  overrideBaseUrl?: string
): string {
  const fromEnv = overrideBaseUrl?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return SPENDESK_BASE_URLS[env];
}

export function parseSpendeskEnvironmentHint(raw?: string): SpendeskEnvironment | undefined {
  return normalizeEnvironment(raw) ?? undefined;
}
