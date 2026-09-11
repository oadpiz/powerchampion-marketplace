"use client";

import { useState, type ReactNode } from "react";
import { useLocale } from "./locale-provider";

function BrandMark() { return <svg viewBox="0 0 36 36" aria-hidden="true"><rect width="36" height="36" rx="10" fill="currentColor"/><path d="m8 24 4-8h4l-4 8H8Zm7 0 7-14h4l-7 14h-4Zm7 0 5-10h4l-5 10h-4Z" fill="#191817"/></svg>; }

export function isAiWorkspacePath(path: string) {
  return path === "/chat" || path === "/agents" || path === "/agents/build";
}

export function AiWorkspaceShell({ children, pathname }: { children: ReactNode; pathname: string }) {
  const { locale, setLocale } = useLocale();
  const zh = locale === "zh";
  const [open, setOpen] = useState(false);
  const destinations = [
    ["/chat", "✳", zh ? "開始對話" : "New conversation"],
    ["/agents", "◈", zh ? "探索智能體" : "Explore agents"],
    ["/agents/build", "⊞", zh ? "建立智能體" : "Build an agent"],
  ];
  function newChat(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    setOpen(false);
    if (href === "/chat" && pathname === "/chat") {
      event.preventDefault();
      window.dispatchEvent(new Event("pc:new-conversation"));
    }
  }
  return <div className="ai-workspace-shell">
    <a className="skip-link" href="#main-content">{zh ? "跳到主要內容" : "Skip to main content"}</a>
    <header className="ai-mobile-header"><a href="/" aria-label="Power Champion"><span className="ai-brand-icon"><BrandMark/></span>Power Champion</a><button type="button" aria-expanded={open} aria-controls="ai-sidebar" aria-label={zh ? "工具選單" : "Tools menu"} onClick={() => setOpen(!open)}>{open ? "×" : "☰"}</button></header>
    <aside className={`ai-sidebar${open ? " ai-sidebar-open" : ""}`} id="ai-sidebar">
      <a className="ai-brand" href="/"><BrandMark/><span>Power Champion<small>{zh ? "模型工具" : "MODEL TOOLS"}</small></span></a>
      <nav className="ai-primary-nav" aria-label={zh ? "模型工具" : "Model tools"}>{destinations.map(([href, icon, label]) => <a key={href} href={href} onClick={(e) => newChat(e, href)} aria-current={pathname === href ? "page" : undefined}><span aria-hidden="true">{icon}</span>{label}{href === "/agents/build" && <small>NEW</small>}</a>)}</nav>
      <div className="ai-side-service"><span className="ai-mini-star" aria-hidden="true">✳</span><p>{zh ? "為你的業務打造 AI。" : "AI, built around your business."}</p><a href="/agents#agent-services">{zh ? "探索建置服務" : "Agent building services"}<span aria-hidden="true">↗</span></a></div>
      <nav className="ai-secondary-nav" aria-label={zh ? "產品與公司" : "Products and company"}><p>{zh ? "更多可能" : "GO FURTHER"}</p><a href="/models"><span aria-hidden="true">⌘</span>{zh ? "模型 API" : "Model APIs"}<span aria-hidden="true">↗</span></a><a href="/infrastructure"><span aria-hidden="true">▤</span>{zh ? "GPU 算力" : "GPU infrastructure"}</a><a href="/"><span aria-hidden="true">◎</span>{zh ? "返回品牌首頁" : "Back to main website"}</a><a href="/company"><span aria-hidden="true">◇</span>{zh ? "關於我們" : "Our company"}</a></nav>
      <div className="ai-sidebar-bottom"><a className="ai-account" href="/account"><span aria-hidden="true">↗</span>{zh ? "我的帳戶" : "Your account"}</a><div className="ai-language-controls" aria-label={zh ? "語言" : "Language"}><button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>English</button><button type="button" aria-pressed={locale === "zh"} onClick={() => setLocale("zh")}>繁中</button><a href="/solutions#languages" aria-label={zh ? "更多語言" : "More languages"}>◎</a></div><div className="ai-legal"><a href="/privacy">{zh ? "隱私" : "Privacy"}</a><a href="/terms">{zh ? "條款" : "Terms"}</a><a href="/status">{zh ? "服務狀態" : "Status"}</a></div></div>
    </aside>
    <div className="ai-workspace-content">{children}</div>
  </div>;
}
