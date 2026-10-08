"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useLocale } from "./locale-provider";
import { portalRequest } from "../lib/portal-client";

const NAV = [
  { href: "/admin", en: "Overview", zh: "總覽" },
  { href: "/admin/customers", en: "Customers", zh: "客戶" },
  { href: "/admin/credits", en: "Credit requests", zh: "儲值申請" },
  { href: "/admin/audit", en: "Audit log", zh: "操作紀錄" },
] as const;

export function AdminShell({
  pathname,
  children,
  onSignedOut = () => window.location.assign("/login"),
}: {
  pathname: string;
  children: ReactNode;
  onSignedOut?: () => void;
}) {
  const zh = useLocale().locale === "zh";
  const [signingOut, setSigningOut] = useState(false);
  const current = NAV.find((item) => item.href === pathname)?.href ?? "/admin";
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await portalRequest("/auth/logout", { method: "POST" });
    } catch {
      // A failed logout still leaves the page; the cookie is HttpOnly and expires server-side.
    }
    onSignedOut();
  }
  return (
    <div className="admin-shell">
      <a className="sr-only" href="#main-content">{zh ? "跳到主要內容" : "Skip to content"}</a>
      <aside className="admin-shell-sidebar">
        <p className="admin-shell-brand">Power Champion<span>{zh ? "管理後台" : "Administration"}</span></p>
        <nav aria-label={zh ? "管理後台導覽" : "Administration navigation"}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={current === item.href ? "page" : undefined}>
              {zh ? item.zh : item.en}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="admin-shell-main">
        <header className="admin-shell-topbar">
          <Link href="/">← {zh ? "回官網" : "Back to site"}</Link>
          <div className="admin-shell-topbar-actions">
            <Link href="/account">{zh ? "我的帳戶" : "My account"}</Link>
            <button type="button" onClick={signOut} disabled={signingOut}>
              {zh ? "登出" : "Sign out"}
            </button>
          </div>
        </header>
        <main id="main-content" className="admin-shell-content">{children}</main>
      </div>
    </div>
  );
}
