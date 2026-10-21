"use client";

import Link from "next/link";
import { PortalError, type PortalUser } from "../lib/portal-client";
import { AdminAllocationSection } from "./admin-allocation-section";
import { AuditSection } from "./admin-audit-section";
import { CreditsSection } from "./admin-credits-section";
import { CustomersSection } from "./admin-customers-section";
import { AdminGatewaySection } from "./admin-gateway-section";
import { AdminKeysSection } from "./admin-keys-section";
import { AdminPersonasSection } from "./admin-personas-section";
import { OverviewSection } from "./admin-overview-section";
import { AdminUsageSection } from "./admin-usage-section";
import { useLocale } from "./locale-provider";
import { ResourceState, usePortalResource } from "./admin-resource";

export type AdminSection =
  | "overview"
  | "customers"
  | "keys"
  | "usage"
  | "gateway"
  | "personas"
  | "allocation"
  | "credits"
  | "audit";

export function AdminPortal({
  section = "overview",
}: {
  section?: AdminSection;
}) {
  const zh = useLocale().locale === "zh";
  const session = usePortalResource<{ user: PortalUser }>("/session");
  const navigation: {
    section: AdminSection;
    href: string;
    en: string;
    zh: string;
  }[] = [
    { section: "overview", href: "/admin", en: "Overview", zh: "總覽" },
    {
      section: "customers",
      href: "/admin/customers",
      en: "Customers",
      zh: "客戶",
    },
    { section: "keys", href: "/admin/keys", en: "API keys", zh: "金鑰" },
    { section: "usage", href: "/admin/usage", en: "Usage", zh: "用量" },
    { section: "gateway", href: "/admin/gateway", en: "Gateway", zh: "閘道" },
    { section: "personas", href: "/admin/personas", en: "Personas", zh: "人設" },
    {
      section: "allocation",
      href: "/admin/allocation",
      en: "Node allocation",
      zh: "機台分配",
    },
    {
      section: "credits",
      href: "/admin/credits",
      en: "Credit requests",
      zh: "儲值申請",
    },
    { section: "audit", href: "/admin/audit", en: "Audit log", zh: "操作紀錄" },
  ];
  const signedOut =
    session.error instanceof PortalError && session.error.status === 401;
  const forbidden =
    (session.error instanceof PortalError && session.error.status === 403) ||
    (session.data !== null && session.data.user.role !== "admin");
  const authorized = session.data?.user.role === "admin";
  return (
    <div className="admin-content">
      <h1 className="admin-content-title">
        {
          navigation.find((item) => item.section === section)?.[
            zh ? "zh" : "en"
          ]
        }
      </h1>
      {session.loading ? (
        <div className="portal-panel" role="status">
          <p>{zh ? "正在確認管理員權限…" : "Checking administrator access…"}</p>
        </div>
      ) : signedOut ? (
        <section className="portal-panel">
          <h2>
            {zh
              ? "請以管理員帳號登入"
              : "Sign in with an administrator account"}
          </h2>
          <p>
            {zh
              ? "登入後才可存取客戶資料與管理工具。"
              : "Sign in to access customer records and administration tools."}
          </p>
          <Link
            className="portal-button"
            href={`/login?next=${encodeURIComponent(navigation.find((item) => item.section === section)?.href ?? "/admin")}`}
          >
            {zh ? "登入" : "Sign in"}
          </Link>
        </section>
      ) : forbidden ? (
        <section className="portal-panel">
          <h2>
            {zh ? "此頁面僅供管理員使用" : "Administrator access required"}
          </h2>
          <p>
            {zh
              ? "目前帳號沒有管理後台權限。你仍可前往自己的帳戶。"
              : "This account does not have administration permissions. You can still access your own account."}
          </p>
          <Link className="portal-button" href="/account">
            {zh ? "前往我的帳戶" : "Go to your account"}
          </Link>
        </section>
      ) : session.error ? (
        <ResourceState {...session}>{null}</ResourceState>
      ) : authorized ? (
        <>
          {section === "overview" && <OverviewSection />}
          {section === "customers" && (
            <CustomersSection currentUserId={session.data?.user.id} />
          )}
          {section === "keys" && <AdminKeysSection />}
          {section === "usage" && <AdminUsageSection />}
          {section === "gateway" && <AdminGatewaySection />}
          {section === "personas" && <AdminPersonasSection />}
          {section === "allocation" && <AdminAllocationSection />}
          {section === "credits" && <CreditsSection />}
          {section === "audit" && <AuditSection />}
        </>
      ) : null}
    </div>
  );
}
