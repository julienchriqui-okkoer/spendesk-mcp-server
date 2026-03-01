/**
 * Strip purchase order to essential fields only to avoid "content size exceeding maximum".
 * Excludes: full approvalHistory[], comments[], matched payables[].
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function sanitizePurchaseOrder(po: any): Record<string, unknown> {
  const supplier = po?.supplier ?? po?.supplierId;
  const requester = po?.requester;
  const costCenter = po?.costCenter ?? po?.cost_center;
  const lineItems = po?.lineItems ?? po?.line_items ?? [];
  const totalAmount = po?.totalAmount ?? po?.total_amount ?? 0;
  const amountInvoiced = po?.amountInvoiced ?? po?.amount_invoiced ?? 0;
  const remainingAmount =
    po?.remainingAmount ??
    po?.remaining_amount ??
    (totalAmount - amountInvoiced);

  return {
    id: po?.id,
    number: po?.number ?? po?.po_number,
    status: po?.status,
    state: po?.state,
    createdAt: po?.createdAt ?? po?.created_at,
    updatedAt: po?.updatedAt ?? po?.updated_at,
    supplier: supplier
      ? {
          id: (supplier as any)?.id,
          name: (supplier as any)?.name ?? (supplier as any)?.supplierName,
        }
      : undefined,
    requester: requester
      ? {
          id: (requester as any)?.id,
          name: [
            (requester as any)?.firstName ?? (requester as any)?.first_name,
            (requester as any)?.lastName ?? (requester as any)?.last_name,
          ]
            .filter(Boolean)
            .join(" ")
            .trim() || (requester as any)?.id,
        }
      : undefined,
    costCenter: costCenter
      ? {
          id: (costCenter as any)?.id,
          name: (costCenter as any)?.name,
          expenseAccount: (costCenter as any)?.expenseAccount ?? (costCenter as any)?.expense_account,
        }
      : undefined,
    currency: po?.currency,
    totalAmount,
    amountInvoiced,
    remainingAmount,
    description: po?.description,
    startDate: po?.startDate ?? po?.start_date ?? null,
    endDate: po?.endDate ?? po?.end_date ?? null,
    lineItems: Array.isArray(lineItems)
      ? lineItems.map((li: any) => ({
          description: li?.description,
          quantity: li?.quantity,
          unitPrice: li?.unitPrice ?? li?.unit_price,
          totalAmount: li?.totalAmount ?? li?.total_amount,
        }))
      : [],
  };
}
