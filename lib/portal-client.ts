import { taskEntry } from "./task-starters";

export type PortalUser = {
  id: string;
  email: string;
  name: string;
  role: "customer" | "admin";
};

export class PortalError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PortalError";
  }
}

export async function portalRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api/portal${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (cause) {
    if (init.signal?.aborted) throw cause;
    throw new PortalError(
      503,
      "unavailable",
      "The account service is unavailable. Please try again later.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PortalError(
      response.status,
      typeof data?.error === "string" ? data.error : "request_failed",
      typeof data?.detail === "string"
        ? data.detail
        : "The request could not be completed.",
    );
  }
  return data as T;
}

export function portalErrorText(error: unknown, locale: "en" | "zh") {
  const status = error instanceof PortalError ? error.status : 503;
  const code = error instanceof PortalError ? error.code : "unavailable";
  if (code === "usage_pricing_incomplete")
    return locale === "zh"
      ? "部分模型的用量價格資料尚未完整，暫時無法顯示可靠的費用報表。請聯繫支援確認計費資料。"
      : "Pricing data is incomplete for some model usage, so a reliable cost report is not available yet. Contact support to confirm billing details.";
  if (code === "invalid_credentials")
    return locale === "zh"
      ? "電子郵件或密碼不正確，請確認後再試。"
      : "The email or password is incorrect. Check your details and try again.";
  if (code === "duplicate_email")
    return locale === "zh"
      ? "此電子郵件已註冊，請登入或聯繫支援。"
      : "This email is already registered. Sign in or contact support.";
  if (status === 401)
    return locale === "zh"
      ? "請登入後繼續，或重新登入以更新工作階段。"
      : "Sign in to continue, or sign in again to renew your session.";
  if (status === 403)
    return locale === "zh"
      ? "目前的帳號沒有權限執行此操作。"
      : "Your account does not have permission to perform this action.";
  if (status === 409)
    return locale === "zh"
      ? "此資料已存在或狀態已更新，請重新整理後確認。"
      : "This record already exists or its status has changed. Refresh to check the latest state.";
  if (status === 429)
    return locale === "zh"
      ? "操作過於頻繁，請稍後再試。"
      : "Too many requests. Please wait before trying again.";
  if (status >= 500 || code === "gateway_unconfigured")
    return locale === "zh"
      ? "此服務目前無法使用或尚未完成設定，請稍後再試或聯繫支援。"
      : "This service is unavailable or has not been configured yet. Try again later or contact support.";
  if (status === 400 || status === 422)
    return locale === "zh"
      ? "請確認欄位內容符合要求後再試。"
      : "Check that the fields meet the requirements, then try again.";
  return locale === "zh"
    ? "操作未完成，請稍後再試。"
    : "The request could not be completed. Please try again later.";
}

export function safeAccountReturn(value: string | null): string {
  if (!value) return "/account";
  if (/^(?:\/account(?:\/(?:keys|usage|credits))?|\/tasks|\/agents\/build(?:\?template=(?:support|research|content|coding))?)$/.test(value)) return value;
  if (value.startsWith("/tasks?")) {
    const search = value.slice("/tasks".length);
    const params = new URLSearchParams(search);
    if ([...params.keys()].some((key) => !["agent", "starter"].includes(key) || params.getAll(key).length !== 1)) return "/account";
    if (params.has("agent") && !/^[a-f0-9]{32}$/.test(params.get("agent") ?? "")) return "/account";
    return taskEntry(search).returnPath;
  }
  return "/account";
}
