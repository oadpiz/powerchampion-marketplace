"use client";

import { useState, type ReactNode } from "react";
import { useLocale } from "./locale-provider";

const destinations = [
  { href: "/tasks", icon: "↗", en: "Agent tasks", zh: "智能體任務", group: "build" },
  { href: "/chat", icon: "✳", en: "Model chat", zh: "AI 對話", group: "build" },
  { href: "/agents", icon: "◈", en: "Agents & services", zh: "智能體與建置", group: "build" },
  {
    href: "/platform",
    icon: "⌂",
    en: "Overview",
    zh: "平台總覽",
    group: "build",
  },
  {
    href: "/models",
    icon: "◈",
    en: "Model catalog",
    zh: "模型目錄",
    group: "build",
  },
  {
    href: "/compare",
    icon: "⇄",
    en: "Compare models",
    zh: "模型比較",
    group: "build",
  },
  {
    href: "/playground",
    icon: "▷",
    en: "Playground",
    zh: "模型測試",
    group: "build",
  },
  {
    href: "/integrations",
    icon: "⌘",
    en: "Integrations",
    zh: "串接設定",
    group: "build",
  },
  {
    href: "/docs",
    icon: "▤",
    en: "API documentation",
    zh: "API 文件",
    group: "build",
  },
  {
    href: "/account",
    icon: "◎",
    en: "My account",
    zh: "我的帳戶",
    group: "manage",
  },
  {
    href: "/console",
    icon: "◉",
    en: "Balance",
    zh: "餘額查詢",
    group: "manage",
  },
  {
    href: "/pricing",
    icon: "＄",
    en: "Pricing & credits",
    zh: "費率與儲值",
    group: "manage",
  },
  {
    href: "/status",
    icon: "⌁",
    en: "Service status",
    zh: "服務狀態",
    group: "manage",
  },
] as const;

export function isPlatformPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/") || destinations.some(
    ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
  );
}

export function PlatformFrame({
  children,
  pathname,
}: {
  children: ReactNode;
  pathname: string;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const current = pathname === "/admin" || pathname.startsWith("/admin/")
    ? { href: "/admin", en: "Administration", zh: "管理後台" } :
    destinations.find(
      ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
    ) ?? destinations[0];
  async function copyBaseUrl() {
    try {
      await navigator.clipboard.writeText("https://b300.powerchampion.ai/v1");
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="platform-frame">
      <aside className="platform-sidebar">
        <a href="/platform" className="platform-workspace">
          <span className="platform-workspace-mark" aria-hidden="true">
            P
          </span>
          <span>
            Power Champion
            <small>{zh ? "模型開發平台" : "MODEL PLATFORM"}</small>
          </span>
        </a>
        <nav aria-label={zh ? "平台功能" : "Platform navigation"}>
          {(["build", "manage"] as const).map((group) => (
            <div className="platform-nav-group" key={group}>
              <p>
                {group === "build"
                  ? zh
                    ? "探索與開發"
                    : "BUILD"
                  : zh
                    ? "管理與支援"
                    : "MANAGE"}
              </p>
              {destinations
                .filter((item) => item.group === group)
                .map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    aria-current={
                      current.href === item.href ? "page" : undefined
                    }
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item[locale]}
                    {item.href === "/playground" && (
                      <small>{zh ? "測試" : "API"}</small>
                    )}
                  </a>
                ))}
            </div>
          ))}
        </nav>
        <div className="platform-sidebar-bottom">
          <p>{zh ? "需要專屬算力？" : "Need dedicated compute?"}</p>
          <a href="/infrastructure">
            {zh ? "探索 GPU 服務" : "Explore GPU infrastructure"}
            <span aria-hidden="true">↗</span>
          </a>
          <div>
            <a href="/company">{zh ? "公司" : "Company"}</a>
            <a href="/contact">{zh ? "聯絡我們" : "Contact"}</a>
            <a href="/privacy">{zh ? "隱私" : "Privacy"}</a>
            <a href="/terms">{zh ? "條款" : "Terms"}</a>
          </div>
        </div>
      </aside>
      <div className="platform-body">
        <div className="platform-toolbar">
          <p>
            <a href="/platform">{zh ? "平台" : "Platform"}</a>
            <span aria-hidden="true">/</span>
            <strong>{current[locale]}</strong>
          </p>
          <button
            type="button"
            onClick={copyBaseUrl}
            className="platform-endpoint-copy"
          >
            {copied
              ? zh
                ? "已複製端點 ✓"
                : "Endpoint copied ✓"
              : "b300.powerchampion.ai/v1"}
            <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
          </button>
          {copyError && (
            <span className="platform-copy-error" role="status">
              {zh
                ? "請從串接設定頁手動複製端點。"
                : "Copy the endpoint manually from Integrations."}
            </span>
          )}
        </div>
        <label className="platform-mobile-nav">
          <span>{zh ? "開啟平台功能" : "Open a platform tool"}</span>
          <select
            value={current.href}
            onChange={(event) => window.location.assign(event.target.value)}
          >
            {current.href === "/admin" && <option value="/admin">{zh ? "管理後台" : "Administration"}</option>}
            {destinations.map((item) => (
              <option key={item.href} value={item.href}>
                {item[locale]}
              </option>
            ))}
          </select>
        </label>
        <div className="platform-content">{children}</div>
      </div>
    </div>
  );
}
