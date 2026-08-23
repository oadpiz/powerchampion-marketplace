"use client";

import { useLocale } from "../components/locale-provider";

const SUGGESTED_LINKS = [
  { href: "/", labelEn: "Home", labelZh: "首頁", descEn: "Overview of models, pricing, and access", descZh: "模型、價格與存取概覽" },
  { href: "/models", labelEn: "Model catalog", labelZh: "模型目錄", descEn: "Compare live token rates and features", descZh: "比較即時 Token 費率與功能" },
  { href: "/pricing", labelEn: "Pricing", labelZh: "價格", descEn: "Pay per use from prepaid balance", descZh: "從預付餘額按量計費" },
  { href: "/docs", labelEn: "Documentation", labelZh: "文件", descEn: "Quick start with cURL, Python, JavaScript", descZh: "cURL、Python、JavaScript 快速開始" },
  { href: "/status", labelEn: "Service status", labelZh: "服務狀態", descEn: "Live gateway and model availability", descZh: "即時閘道與模型可用性" },
  { href: "/contact", labelEn: "Contact", labelZh: "聯絡", descEn: "Deployment review and enterprise inquiries", descZh: "部署審查與企業洽詢" },
] as const;

export default function NotFound() {
  const { locale } = useLocale();
  const isEn = locale === "en";

  return (
    <main className="not-found-page" id="main-content">
      <section className="not-found-hero">
        <p className="eyebrow">404</p>
        <h1>{isEn ? "This page could not be found." : "找不到此頁面。"}</h1>
        <p className="not-found-lead">
          {isEn
            ? "The page you're looking for doesn't exist or may have been moved. Try one of these instead:"
            : "你尋找的頁面不存在或可能已被移動。請嘗試以下連結："}
        </p>
      </section>
      <nav aria-label={isEn ? "Suggested pages" : "建議頁面"} className="not-found-links">
        {SUGGESTED_LINKS.map((link) => (
          <a key={link.href} href={link.href} className="not-found-link-card">
            <span className="not-found-link-label">{isEn ? link.labelEn : link.labelZh}</span>
            <span className="not-found-link-desc">{isEn ? link.descEn : link.descZh}</span>
          </a>
        ))}
      </nav>
    </main>
  );
}
