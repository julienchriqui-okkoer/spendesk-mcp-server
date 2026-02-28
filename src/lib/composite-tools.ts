/**
 * Composite MCP tool logic: analyze spend, bookkeeping pipeline, payment status, AP aging, cash flow forecast.
 * All use fetchAllPayables internally.
 */

import type { SpendeskClient } from "../spendesk-api/client.js";
import { fetchAllPayables, type Payable } from "./fetch-all-payables.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function groupByKey<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  return map;
}

export type AnalyzeSpendFilters = {
  costCenter?: string;
  costCenterIds?: string[];
  supplier?: string;
  supplierId?: string;
  payableType?: string;
  counterpartyType?: "supplier" | "employee";
  bookkeepingStatus?: "created" | "prepared" | "exported";
  currency?: string;
  minAmount?: number;
  maxAmount?: number;
  expenseAccount?: string;
  analyticalFieldName?: string;
  analyticalFieldValue?: string;
};

function matchesCostCenter(p: Payable, costCenter: string): boolean {
  const lower = costCenter.toLowerCase();
  const topLevel = (p as { costCenterName?: string }).costCenterName?.toLowerCase().includes(lower);
  const lineItemMatch = (p.lineItems ?? []).some((li) =>
    li.costCenterName?.toLowerCase().includes(lower)
  );
  return Boolean(topLevel || lineItemMatch);
}

function applyFilters(payables: Payable[], filters: AnalyzeSpendFilters | undefined): Payable[] {
  if (!filters || Object.keys(filters).length === 0) return payables;
  return payables.filter((p) => {
    if (filters.costCenter && !matchesCostCenter(p, filters.costCenter!)) return false;
    if (filters.costCenterIds?.length) {
      const topId = (p as { costCenterId?: string }).costCenterId;
      const lineIds = (p.lineItems ?? []).map((li) => (li as { costCenterId?: string }).costCenterId).filter(Boolean) as string[];
      const allIds = [topId, ...lineIds].filter(Boolean) as string[];
      if (allIds.length === 0) return false;
      if (!allIds.some((id) => filters.costCenterIds!.includes(id))) return false;
    }
    if (filters.supplier && !(p.counterparty?.name ?? "").toLowerCase().includes(filters.supplier.toLowerCase())) return false;
    if (filters.supplierId && p.counterparty?.id !== filters.supplierId) return false;
    if (filters.payableType && p.type !== filters.payableType) return false;
    if (filters.counterpartyType && p.counterparty?.type !== filters.counterpartyType) return false;
    if (filters.bookkeepingStatus && p.bookkeepingStatus !== filters.bookkeepingStatus) return false;
    if (filters.currency && p.currency !== filters.currency) return false;
    if (filters.minAmount != null && p.functionalAmount < filters.minAmount) return false;
    if (filters.maxAmount != null && p.functionalAmount > filters.maxAmount) return false;
    if (filters.expenseAccount) {
      const match = (p.lineItems ?? []).some((li) =>
        (li.expenseAccount?.name ?? "").toLowerCase().includes(filters.expenseAccount!.toLowerCase())
      );
      if (!match) return false;
    }
    if (filters.analyticalFieldName && filters.analyticalFieldValue) {
      const match = (p.lineItems ?? []).some((li) =>
        (li.analyticalProperties ?? []).some(
          (ap) =>
            ap.fieldName === filters.analyticalFieldName! &&
            ap.valueName === filters.analyticalFieldValue!
        )
      );
      if (!match) return false;
    }
    return true;
  });
}

export type AnalyzeSpendParams = {
  from: string;
  to: string;
  groupBy:
    | "supplier"
    | "costCenter"
    | "analyticalField"
    | "payableType"
    | "expenseAccount"
    | "employee"
    | "currency"
    | "bookkeepingStatus"
    | "month"
    | "paymentStatus"
    | "country";
  analyticalFieldName?: string;
  limit?: number;
  excludeCredits?: boolean;
  filters?: AnalyzeSpendFilters;
  includeDetails?: boolean;
};

function getPaymentStatusKey(p: Payable): "paid" | "unpaid" | "partial" {
  const allocated = (p.allocations ?? []).reduce((sum, a) => sum + a.allocatedAmount, 0);
  if ((p.allocations ?? []).length === 0) return "unpaid";
  return allocated >= p.functionalAmount ? "paid" : "partial";
}

function getExpenseAccountKey(account: { code?: string; name?: string } | null | undefined): string {
  if (!account) return "Unassigned";
  const code = (account as { code?: string }).code ?? "";
  const name = (account as { name?: string }).name ?? "";
  if (code && name) return `${code} - ${name}`.trim();
  return name || code || "Unassigned";
}

/** Aggregate by expense account. Uses top-level expenseAccount (API may expose it when lineItems absent), else first lineItem. For split invoices, aggregates at line-item level so totals match by account. */
function groupByExpenseAccount(filtered: Payable[]): Record<string, { total: number; payables: Payable[] }> {
  const byKey: Record<string, { total: number; payables: Payable[] }> = {};
  for (const p of filtered) {
    const lineItems = p.lineItems ?? [];
    const topAccount = (p as { expenseAccount?: { code: string; name: string } }).expenseAccount;
    if (lineItems.length > 0) {
      for (const li of lineItems) {
        const account = li.expenseAccount ?? topAccount;
        const key = getExpenseAccountKey(account);
        const amount = li.financial?.netAmount ?? p.functionalAmount / lineItems.length;
        if (!byKey[key]) byKey[key] = { total: 0, payables: [] };
        byKey[key].total += amount;
        if (!byKey[key].payables.includes(p)) byKey[key].payables.push(p);
      }
    } else {
      const account = topAccount ?? p.lineItems?.[0]?.expenseAccount;
      const key = getExpenseAccountKey(account);
      if (!byKey[key]) byKey[key] = { total: 0, payables: [] };
      byKey[key].total += p.functionalAmount;
      byKey[key].payables.push(p);
    }
  }
  return byKey;
}

export async function analyzeSpend(
  api: SpendeskClient,
  params: AnalyzeSpendParams
): Promise<{
  period: string;
  groupBy: string;
  grandTotalEUR: number;
  results: Array<{
    name: string;
    totalEUR: number;
    count: number;
    sharePercent: number;
    details?: Array<{ id: string; date: string; description: string; amountEUR: number; invoiceNumber?: string }>;
  }>;
  message?: string;
}> {
  const {
    from,
    to,
    groupBy,
    analyticalFieldName,
    limit = 10,
    excludeCredits = true,
    filters,
    includeDetails = false,
  } = params;
  const payables = await fetchAllPayables(api, from, to);
  if (payables.length === 0) {
    return {
      period: `${from} → ${to}`,
      groupBy,
      grandTotalEUR: 0,
      results: [],
      message: "No payables found for this period",
    };
  }
  let filtered = excludeCredits ? payables.filter((p) => p.functionalAmount > 0) : payables;
  filtered = applyFilters(filtered, filters);

  let grouped: Record<string, Payable[]>;
  if (groupBy === "supplier") {
    grouped = groupByKey(filtered, (p) => p.counterparty?.name ?? "Unassigned");
  } else if (groupBy === "costCenter") {
    grouped = groupByKey(filtered, (p) => p.lineItems?.[0]?.costCenterName ?? "Unassigned");
  } else if (groupBy === "analyticalField" && analyticalFieldName) {
    grouped = groupByKey(filtered, (p) => {
      const vals = p.lineItems?.flatMap((li) =>
        (li.analyticalProperties ?? [])
          .filter((ap) => ap.fieldName === analyticalFieldName)
          .map((ap) => ap.valueName)
      );
      return vals?.[0] ?? "Unassigned";
    });
  } else if (groupBy === "expenseAccount") {
    const byAccount = groupByExpenseAccount(filtered);
    const DETAILS_CAP = 10;
    let expenseResults = Object.entries(byAccount)
      .map(([name, v]) => {
        const totalEUR = round2(v.total);
        const details =
          includeDetails && v.payables.length > 0
            ? v.payables.slice(0, DETAILS_CAP).map((p) => ({
                id: p.id,
                date: p.payableDate ?? "",
                description: p.description ?? "",
                amountEUR: round2(p.functionalAmount),
                invoiceNumber: p.invoiceNumber,
              }))
            : undefined;
        return { name, totalEUR, count: v.payables.length, sharePercent: 0, details };
      })
      .sort((a, b) => b.totalEUR - a.totalEUR)
      .slice(0, limit);
    const grandTotalExpense = expenseResults.reduce((sum, r) => sum + r.totalEUR, 0);
    expenseResults = expenseResults.map((r) => ({
      ...r,
      sharePercent: grandTotalExpense > 0 ? round2((r.totalEUR / grandTotalExpense) * 100) : 0,
    }));
    return {
      period: `${from} → ${to}`,
      groupBy,
      grandTotalEUR: round2(grandTotalExpense),
      results: expenseResults,
    };
  } else if (groupBy === "employee") {
    const employees = filtered.filter((p) => p.counterparty?.type === "employee");
    grouped = groupByKey(employees, (p) => p.counterparty?.name ?? "Unassigned");
  } else if (groupBy === "currency") {
    grouped = groupByKey(filtered, (p) => p.currency ?? "Unassigned");
  } else if (groupBy === "bookkeepingStatus") {
    grouped = groupByKey(filtered, (p) => p.bookkeepingStatus ?? "unknown");
  } else if (groupBy === "month") {
    grouped = groupByKey(filtered, (p) => (p.payableDate ?? "").substring(0, 7) || "Unassigned");
  } else if (groupBy === "paymentStatus") {
    grouped = groupByKey(filtered, (p) => getPaymentStatusKey(p));
  } else if (groupBy === "country") {
    grouped = groupByKey(
      filtered,
      (p) => (p.counterparty as { country?: string })?.country ?? "Unassigned"
    );
  } else {
    grouped = groupByKey(filtered, (p) => p.type ?? "unknown");
  }

  const DETAILS_CAP = 10;
  let results = Object.entries(grouped)
    .map(([name, items]) => {
      const totalEUR = round2(items.reduce((sum, p) => sum + p.functionalAmount, 0));
      const details =
        includeDetails && items.length > 0
          ? items
              .slice(0, DETAILS_CAP)
              .map((p) => ({
                id: p.id,
                date: p.payableDate ?? "",
                description: p.description ?? "",
                amountEUR: round2(p.functionalAmount),
                invoiceNumber: p.invoiceNumber,
              }))
          : undefined;
      return { name, totalEUR, count: items.length, sharePercent: 0, details };
    })
    .sort((a, b) => b.totalEUR - a.totalEUR)
    .slice(0, limit);

  const grandTotalEUR = results.reduce((sum, r) => sum + r.totalEUR, 0);
  results = results.map((r) => ({
    ...r,
    sharePercent: grandTotalEUR > 0 ? round2((r.totalEUR / grandTotalEUR) * 100) : 0,
  }));

  return {
    period: `${from} → ${to}`,
    groupBy,
    grandTotalEUR: round2(grandTotalEUR),
    results,
  };
}

export type BookkeepingPipelineParams = {
  from: string;
  to: string;
  status?: "created" | "prepared" | "exported";
  includeVatBreakdown?: boolean;
  includeJournalEntries?: boolean;
};

export async function getBookkeepingPipeline(
  api: SpendeskClient,
  params: BookkeepingPipelineParams
): Promise<{
  summary: { created: number; prepared: number; exported: number; totalPending: number };
  payables: Array<{
    id: string;
    invoiceNumber?: string;
    supplier: string;
    accountingDate: string;
    bookkeepingStatus: string;
    functionalAmount: number;
    currency: string;
    expenseAccounts: Array<{ code: string; name: string; netAmount: number }>;
    vatBreakdown?: Array<{ rate: number; vatAmount: number; netAmount: number }>;
    journalEntry?: { debit: Record<string, number>; credit: Record<string, number> };
  }>;
}> {
  const { from, to, status, includeVatBreakdown = false, includeJournalEntries = false } = params;
  const payables = await fetchAllPayables(api, from, to);
  const filtered =
    status != null ? payables.filter((p) => p.bookkeepingStatus === status) : payables;

  const summary = {
    created: payables.filter((p) => p.bookkeepingStatus === "created").length,
    prepared: payables.filter((p) => p.bookkeepingStatus === "prepared").length,
    exported: payables.filter((p) => p.bookkeepingStatus === "exported").length,
    totalPending: payables.filter((p) => p.bookkeepingStatus !== "exported").length,
  };

  const payablesOut = filtered.map((p) => {
    const expenseAccounts = (p.lineItems ?? []).map((li) => ({
      code: li.expenseAccount?.code ?? "",
      name: li.expenseAccount?.name ?? "",
      netAmount: li.financial?.netAmount ?? 0,
    }));
    let vatBreakdown: Array<{ rate: number; vatAmount: number; netAmount: number }> | undefined;
    if (includeVatBreakdown && p.lineItems) {
      const byRate = new Map<number, { vatAmount: number; netAmount: number }>();
      for (const li of p.lineItems) {
        const rate = li.vatAccount?.rate ?? 0;
        const cur = byRate.get(rate) ?? { vatAmount: 0, netAmount: 0 };
        cur.vatAmount += li.financial?.vatAmount ?? 0;
        cur.netAmount += li.financial?.netAmount ?? 0;
        byRate.set(rate, cur);
      }
      vatBreakdown = Array.from(byRate.entries()).map(([rate, v]) => ({
        rate,
        vatAmount: round2(v.vatAmount),
        netAmount: round2(v.netAmount),
      }));
    }
    let journalEntry: { debit: Record<string, number>; credit: Record<string, number> } | undefined;
    if (includeJournalEntries && p.lineItems) {
      const debit: Record<string, number> = {};
      const credit: Record<string, number> = {};
      for (const li of p.lineItems) {
        const expCode = li.expenseAccount?.code ?? "unknown";
        debit[expCode] = (debit[expCode] ?? 0) + (li.financial?.netAmount ?? 0);
        const vatCode = li.vatAccount?.code ?? "VAT";
        debit[vatCode] = (debit[vatCode] ?? 0) + (li.financial?.vatAmount ?? 0);
      }
      credit["account_payable"] = p.functionalAmount;
      journalEntry = { debit, credit };
    }
    return {
      id: p.id,
      invoiceNumber: p.invoiceNumber,
      supplier: p.counterparty?.name ?? "",
      accountingDate: p.accountingDate,
      bookkeepingStatus: p.bookkeepingStatus,
      functionalAmount: p.functionalAmount,
      currency: p.currency,
      expenseAccounts,
      vatBreakdown,
      journalEntry,
    };
  });

  return { summary, payables: payablesOut };
}

export type PaymentStatusParams = {
  from: string;
  to: string;
  status?: "paid" | "unpaid" | "partial";
  currency?: string;
};

function paymentStatus(p: Payable): "paid" | "unpaid" | "partial" {
  const allocated = (p.allocations ?? []).reduce((sum, a) => sum + a.allocatedAmount, 0);
  const total = p.functionalAmount;
  if ((p.allocations ?? []).length === 0) return "unpaid";
  if (allocated >= total) return "paid";
  return "partial";
}

export async function getPaymentStatus(
  api: SpendeskClient,
  params: PaymentStatusParams
): Promise<{
  period: string;
  payables: Array<{
    id: string;
    supplier: string;
    invoiceNumber?: string;
    functionalAmount: number;
    currency: string;
    status: "paid" | "unpaid" | "partial";
    allocatedAmount: number;
  }>;
}> {
  const { from, to, status, currency } = params;
  const payables = await fetchAllPayables(api, from, to);
  let filtered = payables;
  if (currency) filtered = filtered.filter((p) => p.currency === currency);
  if (status) filtered = filtered.filter((p) => paymentStatus(p) === status);

  const payablesOut = filtered.map((p) => {
    const allocated = (p.allocations ?? []).reduce((sum, a) => sum + a.allocatedAmount, 0);
    return {
      id: p.id,
      supplier: p.counterparty?.name ?? "",
      invoiceNumber: p.invoiceNumber,
      functionalAmount: p.functionalAmount,
      currency: p.currency,
      status: paymentStatus(p),
      allocatedAmount: round2(allocated),
    };
  });

  return { period: `${from} → ${to}`, payables: payablesOut };
}

export type ApAgingParams = {
  asOfDate?: string;
  includeUpcoming?: boolean;
};

export async function getApAging(
  api: SpendeskClient,
  params: ApAgingParams
): Promise<{
  asOfDate: string;
  summary: {
    totalOutstandingEUR: number;
    current: number;
    overdue_1_30: number;
    overdue_31_60: number;
    overdue_61_90: number;
    overdue_90plus: number;
    dpo: number;
  };
  topOverdueSuppliers: Array<{ name: string; totalOverdueEUR: number; oldestInvoiceDaysOverdue: number }>;
  payables: Array<{
    supplier: string;
    invoiceNumber?: string;
    dueDate: string;
    daysOverdue: number;
    amountEUR: number;
    amountDueEUR: number;
  }>;
}> {
  const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
  const asOfDate = new Date(asOf);
  const from = new Date(asOfDate);
  from.setMonth(from.getMonth() - 6);
  const to = asOf;
  const payables = await fetchAllPayables(api, from.toISOString().slice(0, 10), to);
  const unpaid = payables.filter((p) => paymentStatus(p) !== "paid");
  const withDueDate = unpaid.filter((p) => p.invoiceDueDate ?? p.payableDate);
  const withDue = withDueDate.map((p) => {
    const dueStr = p.invoiceDueDate ?? p.payableDate;
    const due = new Date(dueStr);
    const daysOverdue = Math.floor((asOfDate.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
    return { p, dueStr, daysOverdue, amount: p.functionalAmount };
  });

  const current = withDue.filter((x) => x.daysOverdue < 0);
  const overdue_1_30 = withDue.filter((x) => x.daysOverdue >= 0 && x.daysOverdue <= 30);
  const overdue_31_60 = withDue.filter((x) => x.daysOverdue > 30 && x.daysOverdue <= 60);
  const overdue_61_90 = withDue.filter((x) => x.daysOverdue > 60 && x.daysOverdue <= 90);
  const overdue_90plus = withDue.filter((x) => x.daysOverdue > 90);

  const totalOutstandingEUR = withDue.reduce((s, x) => s + x.amount, 0);
  const sumDays = withDue.reduce((s, x) => s + Math.max(0, x.daysOverdue) * x.amount, 0);
  const dpo = totalOutstandingEUR > 0 ? round2(sumDays / totalOutstandingEUR) : 0;

  const bySupplier = groupByKey(withDue.filter((x) => x.daysOverdue > 0), (x) => x.p.counterparty?.name ?? "");
  const topOverdueSuppliers = Object.entries(bySupplier)
    .map(([name, items]) => ({
      name,
      totalOverdueEUR: round2(items.reduce((s, x) => s + x.amount, 0)),
      oldestInvoiceDaysOverdue: Math.max(...items.map((x) => x.daysOverdue)),
    }))
    .sort((a, b) => b.totalOverdueEUR - a.totalOverdueEUR)
    .slice(0, 10);

  let payablesList = withDue.filter((x) => x.daysOverdue >= 0);
  if (params.includeUpcoming) payablesList = withDue;

  const payablesOut = payablesList.map((x) => ({
    supplier: x.p.counterparty?.name ?? "",
    invoiceNumber: x.p.invoiceNumber,
    dueDate: x.dueStr,
    daysOverdue: Math.max(0, x.daysOverdue),
    amountEUR: round2(x.amount),
    amountDueEUR: round2(x.amount),
  }));

  return {
    asOfDate: asOf,
    summary: {
      totalOutstandingEUR: round2(totalOutstandingEUR),
      current: round2(current.reduce((s, x) => s + x.amount, 0)),
      overdue_1_30: round2(overdue_1_30.reduce((s, x) => s + x.amount, 0)),
      overdue_31_60: round2(overdue_31_60.reduce((s, x) => s + x.amount, 0)),
      overdue_61_90: round2(overdue_61_90.reduce((s, x) => s + x.amount, 0)),
      overdue_90plus: round2(overdue_90plus.reduce((s, x) => s + x.amount, 0)),
      dpo,
    },
    topOverdueSuppliers,
    payables: payablesOut,
  };
}

export type CashFlowForecastParams = {
  days?: number;
  groupBy?: "day" | "week" | "supplier";
  asOfDate?: string;
};

export async function getCashFlowForecast(
  api: SpendeskClient,
  params: CashFlowForecastParams
): Promise<{
  forecastPeriod: string;
  totalForecastEUR: number;
  byPeriod: Array<{ period: string; totalEUR: number; invoiceCount: number }>;
  topUpcomingPayments: Array<{ supplier: string; dueDate: string; amountEUR: number; invoiceNumber?: string }>;
}> {
  const days = params.days ?? 30;
  const groupBy = params.groupBy ?? "week";
  const asOf = params.asOfDate ?? new Date().toISOString().slice(0, 10);
  const asOfDate = new Date(asOf);
  const toDate = new Date(asOfDate);
  toDate.setDate(toDate.getDate() + days);
  const to = toDate.toISOString().slice(0, 10);
  const from = new Date(asOfDate);
  from.setMonth(from.getMonth() - 1);
  const fromStr = from.toISOString().slice(0, 10);

  const payables = await fetchAllPayables(api, fromStr, to);
  const unpaid = payables.filter((p) => paymentStatus(p) !== "paid");
  const upcoming = unpaid
    .filter((p) => {
      const d = p.invoiceDueDate ?? p.payableDate;
      const due = new Date(d);
      return due >= asOfDate && due <= toDate;
    })
    .map((p) => ({
      p,
      dueDate: p.invoiceDueDate ?? p.payableDate,
      amount: p.functionalAmount,
    }));

  const totalForecastEUR = round2(upcoming.reduce((s, x) => s + x.amount, 0));

  let byPeriod: Array<{ period: string; totalEUR: number; invoiceCount: number }>;
  if (groupBy === "week") {
    const byWeek = new Map<string, { total: number; count: number }>();
    for (const { p, dueDate, amount } of upcoming) {
      const d = new Date(dueDate);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const label = `Week (${weekStart.toISOString().slice(0, 10)} - ${weekEnd.toISOString().slice(0, 10)})`;
      const cur = byWeek.get(label) ?? { total: 0, count: 0 };
      cur.total += amount;
      cur.count += 1;
      byWeek.set(label, cur);
    }
    byPeriod = Array.from(byWeek.entries())
      .map(([period, v]) => ({ period, totalEUR: round2(v.total), invoiceCount: v.count }))
      .sort((a, b) => a.period.localeCompare(b.period));
  } else if (groupBy === "supplier") {
    const bySupp = groupByKey(upcoming, (x) => x.p.counterparty?.name ?? "Unknown");
    byPeriod = Object.entries(bySupp)
      .map(([period, items]) => ({
        period,
        totalEUR: round2(items.reduce((s, x) => s + x.amount, 0)),
        invoiceCount: items.length,
      }))
      .sort((a, b) => b.totalEUR - a.totalEUR);
  } else {
    const byDay = new Map<string, { total: number; count: number }>();
    for (const { p, dueDate, amount } of upcoming) {
      const cur = byDay.get(dueDate) ?? { total: 0, count: 0 };
      cur.total += amount;
      cur.count += 1;
      byDay.set(dueDate, cur);
    }
    byPeriod = Array.from(byDay.entries())
      .map(([period, v]) => ({ period, totalEUR: round2(v.total), invoiceCount: v.count }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  const topUpcomingPayments = upcoming
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 20)
    .map((x) => ({
      supplier: x.p.counterparty?.name ?? "",
      dueDate: x.dueDate,
      amountEUR: round2(x.amount),
      invoiceNumber: x.p.invoiceNumber,
    }));

  return {
    forecastPeriod: `${asOf} → ${to}`,
    totalForecastEUR,
    byPeriod,
    topUpcomingPayments,
  };
}
