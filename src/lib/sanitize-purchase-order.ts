/**
 * Strip purchase order to essential fields only to avoid "content size exceeding maximum".
 * STRICTLY EXCLUDED: payables, payableIds, approvalHistory, comments, auditLog, events, attachments, customFields.
 * Line items: only description + totalAmount (no quantity, unitPrice, sub-breakdown).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function sanitizePurchaseOrder(po: any): Record<string, unknown> {
  const supplier = po?.supplier ?? po?.supplierId;
  const requester = po?.requester;
  const costCenter = po?.costCenter ?? po?.cost_center;
  const lineItems = po?.lineItems ?? po?.line_items ?? [];
  const totalAmount = po?.totalAmount ?? po?.total_amount ?? 0;
  const amountInvoiced = po?.amountInvoiced ?? po?.amount_invoiced ?? 0;

  return {
    id: po?.id,
    number: po?.number ?? po?.po_number,
    status: po?.status,
    state: po?.state,
    createdAt: po?.createdAt ?? po?.created_at,
    updatedAt: po?.updatedAt ?? po?.updated_at,
    supplier:
      supplier != null
        ? {
            id: (supplier as any)?.id,
            name: (supplier as any)?.name ?? (supplier as any)?.supplierName,
          }
        : undefined,
    requester:
      requester != null
        ? {
            id: (requester as any)?.id ?? po?.userId,
            name:
              [(requester as any)?.firstName ?? (requester as any)?.first_name, (requester as any)?.lastName ?? (requester as any)?.last_name]
                .filter(Boolean)
                .join(" ")
                .trim() || null,
          }
        : undefined,
    costCenter:
      costCenter != null
        ? {
            id: (costCenter as any)?.id,
            name: (costCenter as any)?.name,
          }
        : undefined,
    currency: po?.currency,
    totalAmount,
    amountInvoiced: amountInvoiced ?? 0,
    remainingAmount: (totalAmount ?? 0) - (amountInvoiced ?? 0),
    description: po?.description,
    startDate: po?.startDate ?? po?.start_date ?? null,
    endDate: po?.endDate ?? po?.end_date ?? null,
    lineItems: Array.isArray(lineItems)
      ? lineItems.map((li: any) => ({
          description: li?.description,
          totalAmount: li?.totalAmount ?? li?.total_amount,
        }))
      : [],
  };
}
