export type CreditTargetKey = {
  id: string;
  label: string;
  prefix: string;
  status: string;
  createdAt: string;
  gatewayKeyId?: string;
  userId?: string;
};

export type CreditRequest = {
  id: string;
  amountUsd: number;
  status: string;
  reference: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  targetKeyId: string | null;
  targetKeyLabel: string | null;
  targetKeyPrefix: string | null;
  paymentConfirmedAt: string | null;
  fulfillmentStatus: "not_started" | "pending" | "fulfilled";
  fulfillmentError: string | null;
  fulfilledAt: string | null;
};

export function creditStatusText(request: CreditRequest, zh: boolean): string {
  if (request.fulfillmentStatus === "fulfilled")
    return zh ? "額度已入帳" : "Credit added";
  if (request.paymentConfirmedAt || request.fulfillmentStatus === "pending")
    return zh
      ? "已人工確認收款 · 入額待處理，需管理員重試"
      : "Payment confirmed · credit pending; administrator retry required";
  if (request.status === "approved")
    return zh ? "舊核准紀錄 · 尚未入額" : "Approved record · credit not issued";
  if (request.status === "rejected") return zh ? "未核准" : "Rejected";
  return zh ? "等待人工確認收款" : "Awaiting manual payment confirmation";
}

export function creditTargetText(request: CreditRequest, zh: boolean): string {
  if (!request.targetKeyId)
    return zh ? "需由管理員確認入額金鑰" : "Target key needs administrator attention";
  return `${request.targetKeyLabel || request.targetKeyId}${request.targetKeyPrefix ? ` · ${request.targetKeyPrefix}…` : ""}`;
}
