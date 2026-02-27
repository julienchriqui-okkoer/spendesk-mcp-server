/**
 * Convert monetary amounts from minor units (cents) to major units (EUR, etc.).
 * Spendesk API returns amounts in cents; we divide by 100 before returning to the LLM.
 */

const AMOUNT_KEYS = [
  "functionalAmount",
  "billingAmount",
  "amount",
  "netAmount",
  "vatAmount",
  "grossAmount",
  "allocatedAmount",
] as const;

function parseAmount(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw / 100;
  if (typeof raw === "string") return Number(raw) / 100;
  return 0;
}

function convertAmountsInObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      out[key] = value;
      continue;
    }
    if (AMOUNT_KEYS.includes(key as (typeof AMOUNT_KEYS)[number])) {
      out[key] = parseAmount(value);
      continue;
    }
    if (key === "allocations" && Array.isArray(value)) {
      out[key] = value.map((a: unknown) => {
        if (a && typeof a === "object" && "allocatedAmount" in a) {
          return { ...a, allocatedAmount: parseAmount((a as Record<string, unknown>).allocatedAmount) };
        }
        return a;
      });
      continue;
    }
    if (key === "lineItems" && Array.isArray(value)) {
      out[key] = value.map((li: unknown) => {
        if (li && typeof li === "object") {
          let row = li as Record<string, unknown>;
          const financial = row.financial;
          if (financial && typeof financial === "object") {
            const f = financial as Record<string, unknown>;
            row = {
              ...row,
              financial: {
                ...f,
                netAmount: parseAmount(f.netAmount),
                vatAmount: parseAmount(f.vatAmount),
                grossAmount: parseAmount(f.grossAmount),
              },
            };
          }
          if (Array.isArray(row.analyticalProperties)) {
            row = {
              ...row,
              analyticalProperties: row.analyticalProperties.map((ap: unknown) => {
                if (ap && typeof ap === "object" && "functionalAmount" in ap) {
                  return { ...ap, functionalAmount: parseAmount((ap as Record<string, unknown>).functionalAmount) };
                }
                return ap;
              }),
            };
          }
          return row;
        }
        return li;
      });
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      out[key] = convertAmountsInResponse(value);
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? convertAmountsInResponse(item as Record<string, unknown>)
          : item
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Recursively convert all known monetary fields from cents to major units.
 * Use on API responses before returning to the LLM.
 */
export function convertAmountsInResponse(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    return data.map((item) =>
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? convertAmountsInObject(item as Record<string, unknown>)
        : item
    );
  }
  if (typeof data === "object") {
    return convertAmountsInObject(data as Record<string, unknown>);
  }
  return data;
}
