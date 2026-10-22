"use client";

import Link from "next/link";
import { ResourceState, usePortalResource } from "./admin-resource";
import { useLocale } from "./locale-provider";

type Overview = {
  customerCount: number;
  keyCount: number;
  pendingCreditCount: number;
  gatewayConfigured: boolean;
};

export function OverviewSection() {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<Overview>("/admin/overview");
  const stats = [
    {
      label: zh ? "客戶帳號" : "Customer accounts",
      note: zh
        ? "只計算客戶帳號；客戶名單同時列出管理員。"
        : "Counts customer accounts only; the Customers list also shows administrators.",
      value: resource.data?.customerCount,
      href: "/admin/customers",
    },
    {
      label: zh ? "API 金鑰" : "API keys",
      value: resource.data?.keyCount,
      href: "/admin/keys",
    },
    {
      label: zh ? "待審核儲值申請" : "Pending credit requests",
      value: resource.data?.pendingCreditCount,
      href: "/admin/credits",
    },
  ];
  return (
    <ResourceState {...resource}>
      <div className="portal-grid">
        {stats.map((stat) => (
          <Link
            className="portal-panel portal-stat"
            key={stat.label}
            href={stat.href}
          >
            <span>{stat.label}</span>
            <strong>
              {typeof stat.value === "number" && Number.isFinite(stat.value)
                ? stat.value.toLocaleString(zh ? "zh-TW" : "en-US")
                : zh
                  ? "尚未取得"
                  : "Unavailable"}
            </strong>
            {"note" in stat && stat.note ? <small>{stat.note}</small> : null}
          </Link>
        ))}
      </div>
      <section className="portal-panel">
        <h2>{zh ? "Gateway 連線設定" : "Gateway configuration"}</h2>
        <p className="portal-badge">
          {resource.data?.gatewayConfigured === true
            ? zh
              ? "已設定"
              : "Configured"
            : resource.data?.gatewayConfigured === false
              ? zh
                ? "尚未設定"
                : "Not configured"
              : zh
                ? "狀態未取得"
                : "Status unavailable"}
        </p>
        <p className="portal-note">
          {zh
            ? "此狀態代表連線設定是否存在，不代表即時健康檢查。儲值申請的審核紀錄不會變更 Gateway 餘額。"
            : "This indicates whether a connection is configured, not a live health check. Reviewing a credit request does not change a gateway balance."}
        </p>
        <Link href="/status">
          {zh ? "查看即時服務狀態" : "View service status"} →
        </Link>
      </section>
      <section className="portal-panel">
        <h2>{zh ? "管理工作" : "Administration tasks"}</h2>
        <p>
          {zh
            ? "查看客戶與金鑰數量、審核儲值申請，並追蹤操作紀錄。"
            : "Find customers and their key counts, review credit requests, and trace administrative activity."}
        </p>
        <div className="portal-actions">
          <Link className="portal-button" href="/admin/credits">
            {zh ? "前往儲值審核" : "Review credit requests"}
          </Link>
          <Link className="portal-button-secondary" href="/admin/audit">
            {zh ? "查看操作紀錄" : "View audit log"}
          </Link>
        </div>
      </section>
    </ResourceState>
  );
}

