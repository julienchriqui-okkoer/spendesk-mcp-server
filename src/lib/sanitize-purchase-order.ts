/**
 * Strip purchase order to minimal skeleton — ZERO arrays — to stay under MCP content size limit.
 * Used by HTTP client (purchase-orders truncation) and fetchOpenPurchaseOrders (accruals).
 * Supports API format: amount/billedAmount/netAmount as { amount, currency, precision }; purchaseOrderNumber; invoices[].
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AmountObj = { amount?: number; currency?: string; precision?: number };

/** Normalize to major units. Handles { amount, precision } object (minor units) or raw number (cents). */
function toMajorUnits(value: unknown, defaultPrecision = 2): number {
  if (value == null) return 0;
  if (typeof value === "object" && value !== null && "amount" in value) {
    const obj = value as AmountObj;
    const n = Number(obj?.amount);
    if (!Number.isFinite(n)) return 0;
    const p = Number(obj?.precision) || defaultPrecision;
    return n / Math.pow(10, p);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

export function sanitizePurchaseOrder(po: any): Record<string, unknown> {
  const supplier = po?.supplier ?? po?.supplierId;
  const requester = po?.requester;
  const costCenter = po?.costCenter ?? po?.cost_center;
  const lineItems = po?.lineItems ?? po?.line_items;
  const payables = po?.payables;
  const invoices = po?.invoices;

  // Total: current API uses po.amount or po.netAmount as { amount, currency, precision }
  let totalAmountFinal =
    toMajorUnits(po?.amount) ||
    toMajorUnits(po?.netAmount) ||
    toMajorUnits(po?.totalAmount ?? po?.total_amount ?? po?.committedAmount ?? po?.committed_amount ?? po?.total ?? po?.amountCents);
  if (totalAmountFinal === 0 && Array.isArray(lineItems) && lineItems.length > 0) {
    const sum = lineItems.reduce((acc: number, li: any) => {
      const fin = li?.financial ?? li;
      const amt =
        fin?.netAmount ?? fin?.net_amount ?? fin?.grossAmount ?? fin?.gross_amount ?? (fin?.amount && typeof fin.amount === "object" ? fin.amount?.amount : fin?.amount) ?? 0;
      return acc + toMajorUnits(amt);
    }, 0);
    if (Number.isFinite(sum)) totalAmountFinal = sum;
  }

  // Billed/invoiced: current API uses po.billedAmount as { amount, currency, precision }
  const amountInvoiced =
    toMajorUnits(po?.billedAmount) ||
    toMajorUnits(po?.amountInvoiced ?? po?.amount_invoiced ?? po?.invoicedAmount ?? po?.invoiced_amount);

  const currency =
    (po?.amount && typeof po.amount === "object" && (po.amount as AmountObj).currency) ||
    (po?.netAmount && typeof po.netAmount === "object" && (po.netAmount as AmountObj).currency) ||
    (po?.billedAmount && typeof po.billedAmount === "object" && (po.billedAmount as AmountObj).currency) ||
    po?.currency;

  const description = (po?.description ?? "").substring(0, 150);

  const supplierName =
    po?.supplierName ?? (supplier && typeof supplier === "object" ? (supplier as any).name ?? (supplier as any).supplierName : null) ?? null;
  const requesterName =
    po?.requesterName ??
    (requester != null && typeof requester === "object"
      ? [(requester as any)?.firstName ?? (requester as any)?.first_name, (requester as any)?.lastName ?? (requester as any)?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() || null
      : null);

  return {
    id: po?.id,
    number:
      po?.purchaseOrderNumber != null
        ? String(po.purchaseOrderNumber)
        : po?.number ?? po?.po_number ?? (po?.id ? String(po.id).substring(0, 8) : null),
    status: po?.status,
    state: po?.state ?? null,
    createdAt: po?.createdAt ?? po?.created_at ?? null,
    startDate: po?.startDate ?? po?.start_date ?? null,
    endDate: po?.endDate ?? po?.end_date ?? null,
    supplierId: po?.supplierId ?? (supplier && typeof supplier === "object" ? (supplier as any).id : null) ?? null,
    supplierName: supplierName ?? null,
    requesterId: po?.requesterId ?? (requester && typeof requester === "object" ? (requester as any).id : null) ?? po?.userId ?? null,
    requesterName: requesterName ?? null,
    costCenterId: po?.costCenterId ?? (costCenter && typeof costCenter === "object" ? (costCenter as any).id : null) ?? null,
    costCenterName: po?.costCenterName ?? (costCenter && typeof costCenter === "object" ? (costCenter as any).name : null) ?? null,
    currency: currency ?? null,
    totalAmount: totalAmountFinal,
    amountInvoiced,
    remainingAmount: totalAmountFinal - amountInvoiced,
    description: description || null,
    lineItemsCount: po?.lineItemsCount ?? (Array.isArray(lineItems) ? lineItems.length : 0),
    payablesCount: po?.payablesCount ?? (Array.isArray(payables) ? payables.length : 0),
    invoicesCount: Array.isArray(invoices) ? invoices.length : 0,
  };
}
