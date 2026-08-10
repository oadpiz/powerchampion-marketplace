"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { useLocale } from "./locale-provider";

const destinations = [
  ["models", "/models"],
  ["pricing", "/pricing"],
  ["docs", "/docs"],
  ["console", "/console"],
] as const;

const footerLinks = [
  ["Models", "/models"],
  ["Pricing", "/pricing"],
  ["Docs", "/docs"],
  ["Console", "/console"],
  ["Status", "#"],
  ["Terms", "#"],
  ["Privacy", "#"],
] as const;

export function SiteShell({ children }: { children: ReactNode }) {
  const { copy, locale, setLocale } = useLocale();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const preventDisabledNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
  };

  const dispatchCheckout = () => {
    window.dispatchEvent(new Event("powerchampion:checkout"));
  };

  return (
    <div className="site-shell">
      <header className="site-header">
        {/* vinext's Vite runtime does not provide next/link; this remains a root-relative semantic link. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="site-brand" href="/">Power Champion</a>
        <nav aria-label="Primary navigation" className="site-navigation">
          {destinations.map(([key, href]) => (
            <a href={href} key={key}>{copy.nav[key]}</a>
          ))}
        </nav>
        <div className="site-actions">
          <div aria-label={copy.shared.language} className="locale-toggle" role="group">
            <button aria-pressed={locale === "en"} onClick={() => setLocale("en")} type="button">English</button>
            <button aria-pressed={locale === "zh"} onClick={() => setLocale("zh")} type="button">繁中</button>
          </div>
          <button className="token-button" onClick={dispatchCheckout} type="button">{copy.nav.getTokens}</button>
          <button
            aria-controls="mobile-navigation"
            aria-expanded={isMobileMenuOpen}
            aria-label={copy.nav.openMenu}
            className="menu-trigger"
            onClick={() => setIsMobileMenuOpen(true)}
            type="button"
          >
            ☰
          </button>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="mobile-navigation" id="mobile-navigation">
          <button aria-label={copy.nav.closeMenu} onClick={() => setIsMobileMenuOpen(false)} type="button">×</button>
          <nav aria-label="Mobile navigation">
            {destinations.map(([key, href]) => (
              <a href={href} key={key} onClick={() => setIsMobileMenuOpen(false)}>{copy.nav[key]}</a>
            ))}
          </nav>
        </div>
      )}

      {children}

      <footer className="site-footer">
        {footerLinks.map(([label, href]) => {
          const disabled = href === "#";
          return (
            <a aria-disabled={disabled || undefined} aria-label={`Footer ${label}`} href={href} key={label} onClick={disabled ? preventDisabledNavigation : undefined}>
              {label}
            </a>
          );
        })}
      </footer>
    </div>
  );
}
