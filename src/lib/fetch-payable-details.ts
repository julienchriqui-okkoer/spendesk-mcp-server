import type { SpendeskClient } from "../spendesk-api/client.js";
import { SpendeskPaths } from "../spendesk-api/endpoints.js";

/**
 * Helper to fetch payable details by ID using GET /v1/payables/{id}.
 * Uses a simple concurrency limit to avoid hammering the API.
 */
export async function fetchPayableDetails(
  api: SpendeskClient,
  ids: string[],
  maxConcurrent = 10
): Promise<Map<string, Record<string, unknown>>> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => !!id)));
  const results = new Map<string, Record<string, unknown>>();
  if (!uniqueIds.length) return results;

  let index = 0;
  const worker = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const current = index++;
      if (current >= uniqueIds.length) break;
      const id = uniqueIds[current];
      try {
        const detail = await api.get<Record<string, unknown>>(SpendeskPaths.getPayableById(id));
        results.set(id, detail);
      } catch (err) {
        // Best-effort enrichment only; log and continue on errors.
        // eslint-disable-next-line no-console
        console.error("[fetchPayableDetails] Failed to fetch payable", id, err);
      }
    }
  };

  const workers: Promise<void>[] = [];
  const concurrency = Math.min(maxConcurrent, uniqueIds.length);
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

