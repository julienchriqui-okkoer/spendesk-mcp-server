/**
 * Generic "fetch all pages" for list endpoints (settlements, suppliers, purchase orders).
 * Uses the same pagination logic as fetch-all-payables: read result.data / result.meta when present,
 * use actual pageSize from API response for totalPages, fetch remaining pages in parallel.
 */

import type { SpendeskClient } from "../spendesk-api/client.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_CONCURRENT_PAGES = 6;

/** Response shape: API may return { result: { data, meta } } or { data, meta } or { [listKey]: [] } */
type ListResponse = {
  result?: {
    data?: unknown[];
    meta?: { pagination?: { total?: number; pageSize?: number } };
  };
  data?: unknown[];
  meta?: { pagination?: { total?: number; pageSize?: number } };
  settlements?: unknown[];
  suppliers?: unknown[];
  purchaseOrders?: unknown[];
  [key: string]: unknown;
};

function extractListAndPagination(
  res: ListResponse,
  listKey?: "settlements" | "suppliers" | "purchaseOrders"
): { list: unknown[]; total: number; pageSize: number } {
  const raw = res as ListResponse;
  let list: unknown[] =
    raw.result?.data ??
    raw.data ??
    (listKey ? (raw[listKey] as unknown[] | undefined) ?? [] : []);
  if (!Array.isArray(list)) list = [];

  const total =
    raw.result?.meta?.pagination?.total ??
    raw.meta?.pagination?.total ??
    list.length;
  const pageSize =
    raw.result?.meta?.pagination?.pageSize ??
    raw.meta?.pagination?.pageSize ??
    DEFAULT_PAGE_SIZE;

  return {
    list,
    total: Number(total) || 0,
    pageSize: Number(pageSize) || DEFAULT_PAGE_SIZE,
  };
}

/**
 * Fetch all pages for a GET list endpoint. Params must be camelCase (page/perPage added by this function).
 */
export async function fetchAllPages(
  api: SpendeskClient,
  path: string,
  baseParams: Record<string, string>,
  options?: {
    listKey?: "settlements" | "suppliers" | "purchaseOrders";
    requestedPerPage?: number;
  }
): Promise<{ data: unknown[]; meta: { pagination: { total: number; pageSize: number } } }> {
  const perPage = options?.requestedPerPage ?? DEFAULT_PAGE_SIZE;
  const listKey = options?.listKey;

  const firstRes = await api.get<ListResponse>(path, {
    ...baseParams,
    page: "1",
    perPage: String(perPage),
  });

  const { list, total, pageSize } = extractListAndPagination(firstRes, listKey);
  const actualPageSize = pageSize > 0 ? pageSize : perPage;
  const totalPages = Math.ceil(total / actualPageSize);

  if (totalPages <= 1) {
    return {
      data: list,
      meta: { pagination: { total, pageSize: actualPageSize } },
    };
  }

  const results: unknown[][] = [];
  results[0] = list;

  const queue = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  const workers = Math.min(MAX_CONCURRENT_PAGES, queue.length);

  async function run(): Promise<void> {
    while (queue.length > 0) {
      const page = queue.shift();
      if (page == null) return;
      const res = await api.get<ListResponse>(path, {
        ...baseParams,
        page: String(page),
        perPage: String(perPage),
      });
      const { list: pageList } = extractListAndPagination(res, listKey);
      results[page - 1] = Array.isArray(pageList) ? pageList : [];
    }
  }

  await Promise.all(Array.from({ length: workers }, run));

  const data = results.flat();
  return {
    data,
    meta: { pagination: { total, pageSize: actualPageSize } },
  };
}
