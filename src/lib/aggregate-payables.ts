/**
 * Helpers to fetch payables for a period and aggregate by cost center, supplier, etc.
 * Used by report tools: spend_dashboard, top_suppliers, purchase_orders_export.
 */

import type { SpendeskClient } from "../spendesk-api/client.js";
import { SpendeskPaths } from "../spendesk-api/endpoints.js";

const MAX_PAGES = 50;
const PER_PAGE = 100;

export type NormalizedPayable = {
  id: string;
  amount: number;
  functionalAmount: number;
  currency: string;
  costCenterId: string | null;
  costCenterName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  chargeAccount: string | null;
  expenseCategory: string | null;
  payableDate: string | null;
  createdAt: string | null;
  type: string | null;
  settlementIds: string[];
  raw: Record<string, unknown>;
};

function normalizePayable(p: Record<string, unknown>): NormalizedPayable {
  const counterparty = (p.counterparty ?? p.supplier) as Record<string, unknown> | undefined;
  const accountPayable = counterparty?.accountPayable as Record<string, unknown> | undefined;
  const lineItems = (p.lineItems ?? p.line_items ?? []) as Array<Record<string, unknown>>;
  const allocations = (p.allocations ?? []) as Array<Record<string, unknown>>;

  const amount = Number(p.amount ?? p.functionalAmount ?? 0);
  const functionalAmount = Number(p.functionalAmount ?? p.amount ?? 0);
  const chargeFromLine = lineItems[0]
    ? (lineItems[0].expenseAccount ?? lineItems[0].expense_account ?? accountPayable?.generalAccountCode ?? accountPayable?.general_account_code)
    : (accountPayable?.generalAccountCode ?? accountPayable?.general_account_code);
  const chargeAccount = chargeFromLine != null ? String(chargeFromLine) : null;

  const settlementIds = allocations
    .filter((a) => (a.type ?? a.settlementId ?? a.settlement_id) && (a.settlementId ?? a.settlement_id))
    .map((a) => String(a.settlementId ?? a.settlement_id ?? ""));

  return {
    id: String(p.id ?? ""),
    amount,
    functionalAmount,
    currency: String(p.currency ?? p.functionalCurrency ?? "EUR"),
    costCenterId: (p.costCenterId ?? p.cost_center_id) != null ? String(p.costCenterId ?? p.cost_center_id) : null,
    costCenterName: (p.costCenterName ?? p.cost_center_name) != null ? String(p.costCenterName ?? p.cost_center_name) : null,
    supplierId: counterparty?.id != null ? String(counterparty.id) : null,
    supplierName: counterparty?.name != null ? String(counterparty.name) : null,
    chargeAccount,
    expenseCategory: (p.expenseCategory ?? p.expense_category) != null ? String(p.expenseCategory ?? p.expense_category) : null,
    payableDate: (p.payableDate ?? p.payable_date ?? p.date) != null ? String(p.payableDate ?? p.payable_date ?? p.date) : null,
    createdAt: (p.createdAt ?? p.created_at) != null ? String(p.createdAt ?? p.created_at) : null,
    type: (p.type ?? p.payableType) != null ? String(p.type ?? p.payableType) : null,
    settlementIds,
    raw: p as Record<string, unknown>,
  };
}

/**
 * Fetch all payables for a date range using the snapshot endpoints only.
 */
export async function fetchPayablesForPeriod(
  api: SpendeskClient,
  from: string,
  to: string
): Promise<{ payables: NormalizedPayable[]; error?: string }> {
  const normalized: NormalizedPayable[] = [];

  try {
    const snapshotPayload =
      from && to ? { query: { fromPayableDate: from, toPayableDate: to } } : {};
    const createRes = await api.post<{ id?: string; data?: { id?: string }; snapshotId?: string; key?: string }>(
      SpendeskPaths.createPayablesSnapshot,
      snapshotPayload
    );
    const data = (createRes as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    const snapshotId =
      (createRes as Record<string, unknown>)?.id ??
      data?.id ??
      (createRes as Record<string, unknown>)?.snapshotId ??
      (createRes as Record<string, unknown>)?.key;
    if (snapshotId) {
      const snapshotRes = await api.get<{
        result?: { data?: unknown[] };
        payables?: unknown[];
        data?: unknown[] | { payables?: unknown[] };
      }>(SpendeskPaths.getPayablesSnapshot(String(snapshotId)));
      const list =
        snapshotRes?.result?.data ??
        (snapshotRes as Record<string, unknown>)?.payables ??
        (snapshotRes as Record<string, unknown>)?.data ??
        (snapshotRes as Record<string, { payables?: unknown[] }>)?.data?.payables ??
        (Array.isArray(snapshotRes) ? snapshotRes : []);
      const items = Array.isArray(list) ? list : [];
      for (const p of items) {
        normalized.push(normalizePayable(p as Record<string, unknown>));
      }
      return { payables: normalized };
    }
    return {
      payables: [],
      error: "Payables snapshot endpoint did not return a snapshot id.",
    };
  } catch (err) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    const is404 = statusCode === 404 || String((err as Error)?.message ?? "").includes("404");
    return {
      payables: [],
      error: is404
        ? "Payables snapshot endpoint not available (404). Check plan and scopes (payable:read)."
        : (err as Error)?.message ?? "Failed to fetch payables snapshot.",
    };
  }

  return { payables: normalized };
}

export type ByCostCenter = { id: string; name: string; amount: number; count: number };
export type ByExpenseCategory = { id: string; name: string; amount: number; count: number };
export type ByChargeAccount = { account: string; amount: number; count: number };
export type BySupplier = {
  supplierId: string;
  supplierName: string;
  totalAmount: number;
  currency: string;
  count: number;
  payables: Array<{ id: string; amount: number; payableDate: string | null; type: string | null }>;
  settlementIds: string[];
};

export function aggregateByCostCenter(payables: NormalizedPayable[]): ByCostCenter[] {
  const map = new Map<string, { name: string; amount: number; count: number }>();
  for (const p of payables) {
    const id = p.costCenterId ?? p.costCenterName ?? "_unknown";
    const name = p.costCenterName ?? p.costCenterId ?? "Unknown";
    const prev = map.get(id);
    const amount = p.functionalAmount || p.amount;
    if (prev) {
      prev.amount += amount;
      prev.count += 1;
    } else {
      map.set(id, { name, amount, count: 1 });
    }
  }
  return Array.from(map.entries()).map(([id, v]) => ({ id, name: v.name, amount: v.amount, count: v.count }));
}

export function aggregateByExpenseCategory(payables: NormalizedPayable[]): ByExpenseCategory[] {
  const map = new Map<string, { name: string; amount: number; count: number }>();
  for (const p of payables) {
    const id = p.expenseCategory ?? "_unknown";
    const name = p.expenseCategory ?? "Unknown";
    const prev = map.get(id);
    const amount = p.functionalAmount || p.amount;
    if (prev) {
      prev.amount += amount;
      prev.count += 1;
    } else {
      map.set(id, { name, amount, count: 1 });
    }
  }
  return Array.from(map.entries()).map(([id, v]) => ({ id, name: v.name, amount: v.amount, count: v.count }));
}

export function aggregateByChargeAccount(payables: NormalizedPayable[]): ByChargeAccount[] {
  const map = new Map<string, { amount: number; count: number }>();
  for (const p of payables) {
    const account = p.chargeAccount ?? "_unknown";
    const prev = map.get(account);
    const amount = p.functionalAmount || p.amount;
    if (prev) {
      prev.amount += amount;
      prev.count += 1;
    } else {
      map.set(account, { amount, count: 1 });
    }
  }
  return Array.from(map.entries()).map(([account, v]) => ({ account, amount: v.amount, count: v.count }));
}

export function aggregateBySupplier(payables: NormalizedPayable[]): BySupplier[] {
  const map = new Map<
    string,
    { supplierName: string; currency: string; amount: number; count: number; payables: BySupplier["payables"]; settlementIds: Set<string> }
  >();
  for (const p of payables) {
    const id = p.supplierId ?? p.supplierName ?? "_unknown";
    const name = p.supplierName ?? p.supplierId ?? "Unknown";
    const amount = p.functionalAmount || p.amount;
    const prev = map.get(id);
    const payablesEntry = { id: p.id, amount, payableDate: p.payableDate, type: p.type };
    if (prev) {
      prev.amount += amount;
      prev.count += 1;
      prev.payables.push(payablesEntry);
      p.settlementIds.forEach((sid) => prev.settlementIds.add(sid));
    } else {
      const settlementIds = new Set<string>(p.settlementIds);
      map.set(id, {
        supplierName: name,
        currency: p.currency,
        amount,
        count: 1,
        payables: [payablesEntry],
        settlementIds,
      });
    }
  }
  return Array.from(map.entries())
    .map(([supplierId, v]) => ({
      supplierId,
      supplierName: v.supplierName,
      totalAmount: v.amount,
      currency: v.currency,
      count: v.count,
      payables: v.payables,
      settlementIds: Array.from(v.settlementIds),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}
