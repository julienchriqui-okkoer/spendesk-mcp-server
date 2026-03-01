/**
 * Strip purchase order to minimal skeleton — ZERO arrays — to stay under MCP content size limit.
 * Use for spendesk_get_purchase_orders and for fetchOpenPurchaseOrders (accruals).
 * Arrays (lineItems, payables, etc.) are replaced by counts only.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function sanitizePurchaseOrder(po: any): Record<string, unknown> {
  const supplier = po?.supplier ?? po?.supplierId;
  const requester = po?.requester;
  const costCenter = po?.costCenter ?? po?.cost_center;
  const lineItems = po?.lineItems ?? po?.line_items;
  const payables = po?.payables;
  const totalAmount = po?.totalAmount ?? po?.total_amount ?? 0;
  const amountInvoiced = po?.amountInvoiced ?? po?.amount_invoiced ?? 0;
  const description = (po?.description ?? "").substring(0, 150);

  const supplierName =
    po?.supplierName ?? (supplier as any)?.name ?? (supplier as any)?.supplierName ?? null;
  const requesterName =
    po?.requesterName ??
    (requester != null
      ? [(requester as any)?.firstName ?? (requester as any)?.first_name, (requester as any)?.lastName ?? (requester as any)?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() || null
      : null);

  return {
    id: po?.id,
    number: po?.number ?? po?.po_number ?? (po?.id ? String(po.id).substring(0, 8) : null),
    status: po?.status,
    state: po?.state,
    createdAt: po?.createdAt ?? po?.created_at,
    startDate: po?.startDate ?? po?.start_date ?? null,
    endDate: po?.endDate ?? po?.end_date ?? null,
    supplierId: po?.supplierId ?? (supplier as any)?.id ?? null,
    supplierName,
    requesterId: po?.requesterId ?? (requester as any)?.id ?? po?.userId ?? null,
    requesterName,
    costCenterId: po?.costCenterId ?? (costCenter as any)?.id ?? null,
    costCenterName: po?.costCenterName ?? (costCenter as any)?.name ?? null,
    currency: po?.currency,
    totalAmount: totalAmount ?? 0,
    amountInvoiced: amountInvoiced ?? 0,
    remainingAmount: (totalAmount ?? 0) - (amountInvoiced ?? 0),
    description: description || null,
    lineItemsCount: po?.lineItemsCount ?? (Array.isArray(lineItems) ? lineItems.length : 0),
    payablesCount: po?.payablesCount ?? (Array.isArray(payables) ? payables.length : 0),
  };
}
