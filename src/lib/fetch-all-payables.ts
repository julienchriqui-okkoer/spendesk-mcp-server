/**
 * Internal engine: fetch all payables for a date range.
 * Not an MCP tool — used by composite tools (analyze_spend, bookkeeping_pipeline, etc.).
 * Handles: split range (31-day API limit) → create snapshots → poll until ready → paginate in parallel → return flat array.
 * Amounts are already converted from cents to EUR by SpendeskClient.
 */

import type { SpendeskClient } from "../spendesk-api/client.js";
import { SpendeskApiError } from "../spendesk-api/client.js";
import { SpendeskPaths } from "../spendesk-api/endpoints.js";

const MAX_WAIT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;
const PAGE_SIZE = 100;
const MAX_CONCURRENT_PAGES = 6;
/** Delay between creating each snapshot (ms) to reduce 429 rate limit risk */
const SNAPSHOT_CREATE_DELAY_MS = 1_200;

export interface Payable {
  id: string;
  type: string;
  payableDate: string;
  accountingDate: string;
  invoiceDueDate?: string;
  invoiceNumber?: string;
  description: string;
  counterparty: {
    id: string;
    name: string;
    type: "supplier" | "employee";
    accountPayable?: { generalAccountCode: string };
    country?: string;
  };
  functionalAmount: number;
  functionalCurrency: string;
  currency: string;
  amount: number;
  exchangeRate: number;
  bookkeepingStatus: "created" | "prepared" | "exported";
  /** Top-level expense account (API may expose here when lineItems are absent or for single-account payables). */
  expenseAccount?: { code: string; name: string };
  allocations: Array<{
    settlementId: string;
    allocatedAmount: number;
  }>;
  lineItems: Array<{
    description: string;
    expenseAccount: { code: string; name: string };
    vatAccount: { code: string; rate: number };
    costCenterName: string;
    financial: {
      netAmount: number;
      vatAmount: number;
      grossAmount: number;
    };
    analyticalProperties: Array<{
      fieldName: string;
      valueName: string;
      functionalAmount: number;
    }>;
  }>;
  [key: string]: unknown;
}

export interface DateRange {
  from: string;
  to: string;
}

export function splitDateRange(from: string, to: string, maxDays: number): DateRange[] {
  const ranges: DateRange[] = [];
  const end = new Date(to);
  let start = new Date(from);
  while (start <= end) {
    const rangeFrom = start.toISOString().slice(0, 10);
    const chunkEnd = new Date(start);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1);
    const rangeTo = chunkEnd <= end ? chunkEnd.toISOString().slice(0, 10) : to;
    ranges.push({ from: rangeFrom, to: rangeTo });
    start = new Date(chunkEnd);
    start.setDate(start.getDate() + 1);
  }
  return ranges.length ? ranges : [{ from, to }];
}

type SnapshotCreateResponse = {
  id?: string;
  key?: string;
  snapshotId?: string;
  data?: { id?: string };
};

/** GET /v1/snapshots/payables/:key — data is under result.data, pagination under result.meta */
type SnapshotPageResponse = {
  status?: string;
  result?: {
    data?: unknown[] | { payables?: unknown[] };
    meta?: { pagination?: { total?: number; page?: number; pageSize?: number } };
  };
  data?: unknown[] | { payables?: unknown[] };
  payables?: unknown[];
  meta?: { pagination?: { total?: number; page?: number; pageSize?: number } };
};

async function createSnapshot(api: SpendeskClient, from: string, to: string): Promise<string> {
  // API accepts flat body (fromPayableDate, toPayableDate); wrapper { query } can cause 400
  const body = { fromPayableDate: from, toPayableDate: to };
  const res = await api.post<SnapshotCreateResponse>(SpendeskPaths.createPayablesSnapshot, body);
  const id =
    (res as SnapshotCreateResponse).key ??
    (res as SnapshotCreateResponse).id ??
    (res as SnapshotCreateResponse).snapshotId ??
    (res as SnapshotCreateResponse).data?.id;
  if (!id) throw new Error("Snapshot creation did not return an id/key");
  return String(id);
}

async function pollUntilReady(
  api: SpendeskClient,
  snapshotId: string,
  options: { maxWaitMs: number; intervalMs: number }
): Promise<void> {
  const start = Date.now();
  const maxWait = options.maxWaitMs;
  const intervalMs = options.intervalMs;
  while (Date.now() - start < maxWait) {
    try {
      const res = await api.get<SnapshotPageResponse>(
        SpendeskPaths.getPayablesSnapshot(snapshotId),
        { page: "1", perPage: "1" }
      );
      if ((res as SnapshotPageResponse).status === "COMPLETE") return;
    } catch (err) {
      if (err instanceof SpendeskApiError && err.statusCode === 429) {
        const retryAfter = typeof err.body === "object" && err.body !== null && "retryAfter" in (err.body as Record<string, unknown>)
          ? Number((err.body as Record<string, unknown>).retryAfter)
          : 5;
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000));
        continue;
      }
      // snapshot may still be processing (e.g. 202/204) or transient error
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Snapshot ${snapshotId} not ready after ${maxWait}ms`);
}

async function getSnapshotPage(
  api: SpendeskClient,
  snapshotId: string,
  page: number,
  perPage: number
): Promise<{ data: unknown[]; total: number; pageSize: number }> {
  const res = await api.get<SnapshotPageResponse>(
    SpendeskPaths.getPayablesSnapshot(snapshotId),
    { page: String(page), perPage: String(perPage) }
  );
  const r = res as SnapshotPageResponse;
  const list =
    r.result?.data ??
    r.payables ??
    r.data;
  const arr = Array.isArray(list) ? list : (list as { payables?: unknown[] } | undefined)?.payables ?? [];
  const total =
    r.result?.meta?.pagination?.total ??
    r.meta?.pagination?.total ??
    arr.length;
  const pageSize =
    r.result?.meta?.pagination?.pageSize ??
    r.meta?.pagination?.pageSize ??
    perPage;
  return { data: arr, total, pageSize: Number(pageSize) || perPage };
}

async function fetchPagesParallel(
  api: SpendeskClient,
  snapshotId: string,
  fromPage: number,
  toPage: number,
  perPage: number,
  concurrency: number
): Promise<unknown[]> {
  const results: unknown[][] = [];
  const queue = Array.from({ length: toPage - fromPage + 1 }, (_, i) => fromPage + i);
  const workers = Math.min(concurrency, queue.length);
  async function run(): Promise<void> {
    while (queue.length > 0) {
      const page = queue.shift();
      if (page == null) return;
      const { data } = await getSnapshotPage(api, snapshotId, page, perPage);
      results[page - fromPage] = data;
    }
  }
  await Promise.all(Array.from({ length: workers }, run));
  return results.flat();
}

function normalizePayable(p: unknown): Payable {
  const raw = p as Record<string, unknown>;
  const counterparty = (raw.counterparty ?? raw.supplier) as Record<string, unknown> | undefined;
  const lineItems = (raw.lineItems ?? raw.line_items ?? []) as Array<Record<string, unknown>>;
  const allocations = (raw.allocations ?? []) as Array<Record<string, unknown>>;
  return {
    id: String(raw.id ?? ""),
    type: String(raw.type ?? raw.payableType ?? ""),
    payableDate: String(raw.payableDate ?? raw.payable_date ?? raw.date ?? ""),
    accountingDate: String(raw.accountingDate ?? raw.accounting_date ?? ""),
    invoiceDueDate: raw.invoiceDueDate != null ? String(raw.invoiceDueDate) : undefined,
    invoiceNumber: raw.invoiceNumber != null ? String(raw.invoiceNumber) : undefined,
    description: String(raw.description ?? ""),
    counterparty: {
      id: String(counterparty?.id ?? ""),
      name: String(counterparty?.name ?? ""),
      type: (counterparty?.type as "supplier" | "employee") ?? "supplier",
      accountPayable:
        counterparty?.accountPayable != null
          ? { generalAccountCode: String((counterparty.accountPayable as Record<string, unknown>).generalAccountCode ?? "") }
          : undefined,
      country: counterparty?.country != null ? String(counterparty.country) : undefined,
    },
    functionalAmount: Number(raw.functionalAmount ?? 0),
    functionalCurrency: String(raw.functionalCurrency ?? raw.functional_currency ?? "EUR"),
    currency: String(raw.currency ?? "EUR"),
    amount: Number(raw.amount ?? 0),
    exchangeRate: Number(raw.exchangeRate ?? raw.exchange_rate ?? 1),
    bookkeepingStatus: (raw.bookkeepingStatus ?? raw.bookkeeping_status ?? "created") as "created" | "prepared" | "exported",
    expenseAccount: (() => {
      const root = (raw.expenseAccount ?? raw.chargeAccount) as Record<string, unknown> | undefined;
      const firstLi = lineItems[0] as Record<string, unknown> | undefined;
      const liAcc = (firstLi?.expenseAccount ?? firstLi?.expense_account) as Record<string, unknown> | undefined;
      const code = String(root?.code ?? liAcc?.code ?? "");
      const name = String(root?.name ?? liAcc?.name ?? "");
      return code || name ? { code, name } : undefined;
    })(),
    allocations: allocations.map((a) => ({
      settlementId: String(a.settlementId ?? a.settlement_id ?? ""),
      allocatedAmount: Number(a.allocatedAmount ?? a.allocated_amount ?? 0),
    })),
    lineItems: lineItems.map((li) => ({
      description: String(li.description ?? ""),
      expenseAccount: (() => {
        const acc = (li.expenseAccount ?? li.expense_account) as Record<string, unknown> | undefined;
        const code = String(acc?.code ?? "");
        const name = String(acc?.name ?? "");
        return { code, name };
      })(),
      vatAccount: {
        code: String((li.vatAccount as Record<string, unknown>)?.code ?? ""),
        rate: Number((li.vatAccount as Record<string, unknown>)?.rate ?? 0),
      },
      costCenterName: String(li.costCenterName ?? li.cost_center_name ?? ""),
      financial: {
        netAmount: Number((li.financial as Record<string, unknown>)?.netAmount ?? 0),
        vatAmount: Number((li.financial as Record<string, unknown>)?.vatAmount ?? 0),
        grossAmount: Number((li.financial as Record<string, unknown>)?.grossAmount ?? 0),
      },
      analyticalProperties: ((li.analyticalProperties ?? li.analytical_properties ?? []) as Array<Record<string, unknown>>).map(
        (ap) => ({
          fieldName: String(ap.fieldName ?? ap.field_name ?? ""),
          valueName: String(ap.valueName ?? ap.value_name ?? ""),
          functionalAmount: Number(ap.functionalAmount ?? ap.functional_amount ?? 0),
        })
      ),
    })),
    ...raw,
  };
}

/**
 * Fetch all payables for [from, to]. Splits into 31-day chunks, creates snapshots, polls until ready, fetches all pages in parallel (max 6 concurrent), returns flat array. Amounts are already in EUR (converted by client).
 * On snapshot timeout (>90s) throws with message suggesting to narrow date range. Empty result returns [].
 */
export async function fetchAllPayables(
  api: SpendeskClient,
  from: string,
  to: string
): Promise<Payable[]> {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const daysDiff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
  if (daysDiff > 90) {
    console.warn("Large date range may be slow. Consider narrowing to a quarter.");
  }
  const ranges = splitDateRange(from, to, 31);
  let snapshotIds: string[];
  try {
    snapshotIds = [];
    for (let i = 0; i < ranges.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, SNAPSHOT_CREATE_DELAY_MS));
      const id = await createSnapshot(api, ranges[i].from, ranges[i].to);
      snapshotIds.push(id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create payables snapshot: ${msg}. Check token and date range.`);
  }
  try {
    await Promise.all(
      snapshotIds.map((id) =>
        pollUntilReady(api, id, { maxWaitMs: MAX_WAIT_MS, intervalMs: POLL_INTERVAL_MS })
      )
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Snapshot not ready after ${MAX_WAIT_MS / 1000}s. ${msg} Consider narrowing the date range.`
    );
  }
  const firstPages = await Promise.all(
    snapshotIds.map((id) => getSnapshotPage(api, id, 1, PAGE_SIZE))
  );
  const allPages = await Promise.all(
    snapshotIds.map(async (id, i) => {
      const { data, total, pageSize } = firstPages[i];
      const actualPageSize = pageSize > 0 ? pageSize : PAGE_SIZE;
      const totalPages = Math.ceil(total / actualPageSize);
      if (totalPages <= 1) return data;
      const remaining = await fetchPagesParallel(
        api,
        id,
        2,
        totalPages,
        PAGE_SIZE,
        MAX_CONCURRENT_PAGES
      );
      return [...data, ...remaining];
    })
  );
  const flat = allPages.flat();
  return flat.map(normalizePayable);
}
