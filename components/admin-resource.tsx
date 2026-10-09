"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { portalErrorCodeText, portalRequest, PortalError } from "../lib/portal-client";
import { useLocale } from "./locale-provider";

export function errorMessage(error: unknown, zh: boolean): string {
  if (error instanceof PortalError) {
    // A specific error code (a rejected gateway token, a gateway outage, …) says more than the status.
    const specific = portalErrorCodeText(error, zh ? "zh" : "en");
    if (specific) return specific;
    if (error.status === 401)
      return zh
        ? "登入已失效，請重新登入後再試。"
        : "Your session has expired. Sign in again to continue.";
    if (error.status === 403)
      return zh
        ? "目前帳號沒有管理員權限。"
        : "This account does not have administrator access.";
    if (error.status === 409)
      return zh
        ? "這筆申請的狀態已變更。請重新整理後查看最新結果。"
        : "This request has changed. Refresh to see its latest status.";
    if (error.status === 429)
      return zh
        ? "操作過於頻繁，請稍後再試。"
        : "Too many requests. Please try again shortly.";
    if (error.status >= 500)
      return zh
        ? "管理服務目前尚未可用，請稍後重試。"
        : "Administration services are currently unavailable. Please try again later.";
  }
  return zh
    ? "無法完成此操作。請檢查連線並重試。"
    : "We could not complete this request. Check your connection and try again.";
}

export function usePortalResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    portalRequest<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [path, revision]);
  function refresh() {
    setLoading(true);
    setError(null);
    setData(null);
    setRevision((value) => value + 1);
  }
  return { data, error, loading, refresh };
}

export function ResourceState({
  loading,
  error,
  refresh,
  children,
}: {
  loading: boolean;
  error: unknown;
  refresh: () => void;
  children: ReactNode;
}) {
  const zh = useLocale().locale === "zh";
  if (loading)
    return (
      <div className="portal-panel" role="status">
        <p>{zh ? "正在載入管理資料…" : "Loading administration data…"}</p>
      </div>
    );
  if (error)
    return (
      <div className="portal-panel">
        <p className="portal-error" role="alert">
          {errorMessage(error, zh)}
        </p>
        <div className="portal-actions">
          <button
            className="portal-button-secondary"
            type="button"
            onClick={refresh}
          >
            {zh ? "重試" : "Try again"}
          </button>
          {error instanceof PortalError && error.status === 401 && (
            <Link className="portal-button" href="/login?next=%2Fadmin">
              {zh ? "重新登入" : "Sign in again"}
            </Link>
          )}
        </div>
      </div>
    );
  return children;
}

export function dateLabel(value: string | number | null, zh: boolean): string {
  if (value === null || value === "") return "—";
  const numeric =
    typeof value === "number"
      ? value
      : /^\d+$/.test(value)
        ? Number(value)
        : null;
  const date =
    numeric === null
      ? new Date(value)
      : new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime())
    ? zh
      ? "日期未提供"
      : "Date unavailable"
    : new Intl.DateTimeFormat(zh ? "zh-TW" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function usdLabel(
  value: string | number | null | undefined,
  digits: number,
): string {
  const amount = typeof value === "number" ? value : Number(value);
  return value === null || value === undefined || !Number.isFinite(amount)
    ? "—"
    : `$${amount.toFixed(digits)}`;
}

export type GatewayOwner = { id: string; email: string; name: string };

export function ownerLabel(owner: GatewayOwner | null, zh: boolean): string {
  return owner?.email || (zh ? "未歸屬" : "Unassigned");
}
