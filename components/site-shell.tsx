"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "./locale-provider";
import { useModalIsolation } from "./use-modal-isolation";
import { PlatformFrame, isPlatformPath } from "./platform-frame";
import { useScrollReveal } from "./use-scroll-reveal";
import type { CopyDictionary, Locale } from "../lib/content";

type NavigationKey = keyof CopyDictionary["nav"];
type FooterDestinationKey = NavigationKey | "about" | "terms" | "privacy";

const primaryDestinations: readonly [NavigationKey, string][] = [
  ["models", "/models"],
  ["pricing", "/pricing"],
  ["infrastructure", "/infrastructure"],
  ["docs", "/docs"],
  ["company", "/company"],
];

const mobileDestinations: readonly [NavigationKey, string][] = [
  ...primaryDestinations,
  ["deploymentReview", "/contact"],
];

const footerDestinationGroups: readonly {
  label: keyof CopyDictionary["footer"];
  destinations: readonly [FooterDestinationKey, string][];
}[] = [
  {
    label: "product",
    destinations: [
      ["models", "/models"],
      ["pricing", "/pricing"],
      ["docs", "/docs"],
      ["console", "/console"],
    ],
  },
  {
    label: "companyGroup",
    destinations: [
      ["about", "/company"],
      ["infrastructure", "/infrastructure"],
      ["trust", "/trust"],
      ["status", "/status"],
      ["contact", "/contact"],
    ],
  },
  {
    label: "policies",
    destinations: [
      ["faq", "/faq"],
      ["terms", "/terms"],
      ["privacy", "/privacy"],
    ],
  },
];

const focusableSelector = "a[href], button:not([disabled])";

function navigationLabel(
  copy: CopyDictionary,
  locale: Locale,
  key: NavigationKey,
) {
  if (key === "infrastructure")
    return locale === "en" ? "GPU Cloud" : "算力服務";
  if (key === "docs") return locale === "en" ? "Developers" : "開發文件";
  return copy.nav[key];
}

function footerDestinationLabel(
  copy: CopyDictionary,
  locale: Locale,
  key: FooterDestinationKey,
) {
  if (
    key === "about" ||
    key === "terms" ||
    key === "privacy" ||
    key === "status"
  ) {
    return copy.footer[key];
  }

  return navigationLabel(copy, locale, key);
}

function BrandMark() {
  return (
    <svg
      aria-hidden="true"
      className="site-brand-mark"
      fill="none"
      viewBox="0 0 36 36"
    >
      <rect width="36" height="36" rx="8" fill="currentColor" />
      <path
        d="m8 24 4-8h4l-4 8H8Zm7 0 7-14h4l-7 14h-4Zm7 0 5-10h4l-5 10h-4Z"
        fill="#191817"
      />
    </svg>
  );
}

function dispatchLaunchAccess(restoreFocusTarget?: HTMLElement | null) {
  window.dispatchEvent(
    new CustomEvent("powerchampion:launch-access", {
      detail: restoreFocusTarget ? { restoreFocusTarget } : undefined,
    }),
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  const { copy, locale, setLocale } = useLocale();
  const pathname = usePathname();
  const isPlatform = isPlatformPath(pathname);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingMobileCheckoutRef = useRef(false);

  useModalIsolation(isMobileMenuOpen, mobileMenuRef);
  useScrollReveal();

  useEffect(() => {
    if (!isMobileMenuOpen || !mobileMenuRef.current) {
      return;
    }

    const menu = mobileMenuRef.current;
    const focusableElements = () =>
      Array.from(menu.querySelectorAll<HTMLElement>(focusableSelector));
    const [firstFocusable] = focusableElements();
    firstFocusable?.focus();

    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsMobileMenuOpen(false);
        queueMicrotask(() => menuTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const elements = focusableElements();
      const first = elements[0];
      const last = elements.at(-1);

      if (!first || !last) {
        return;
      }

      const activeElement = document.activeElement;
      if (
        event.shiftKey &&
        (activeElement === first || !menu.contains(activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (activeElement === last || !menu.contains(activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", containFocus);
    return () => document.removeEventListener("keydown", containFocus);
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (isMobileMenuOpen || !pendingMobileCheckoutRef.current) {
      return;
    }

    pendingMobileCheckoutRef.current = false;
    queueMicrotask(() => dispatchLaunchAccess(menuTriggerRef.current));
  }, [isMobileMenuOpen]);

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
    queueMicrotask(() => menuTriggerRef.current?.focus());
  };

  const openMobileMenu = () => {
    setIsMobileMenuOpen(true);
  };

  const openLaunchAccessFromMobileMenu = () => {
    pendingMobileCheckoutRef.current = true;
    setIsMobileMenuOpen(false);
  };

  return (
    <div className={`site-shell${isPlatform ? " site-shell-platform" : ""}`}>
      <a className="skip-link" href="#main-content">
        {copy.nav.skipToContent}
      </a>
      <div className="site-header-wrapper">
        <header className="site-header">
          {/* vinext's Vite runtime does not provide next/link; this remains a root-relative semantic link. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="site-brand" href="/">
            <BrandMark />
            <span>Power Champion</span>
          </a>
          <nav aria-label={copy.nav.primaryLabel} className="site-navigation">
            {primaryDestinations.map(([key, href]) => (
              <a
                aria-current={
                  pathname === href || pathname.startsWith(`${href}/`)
                    ? "page"
                    : undefined
                }
                href={href}
                key={key}
              >
                {navigationLabel(copy, locale, key)}
              </a>
            ))}
          </nav>
          <div className="site-actions">
            {!isPlatform && (
              <a className="platform-entry-link" href="/platform">
                {locale === "en" ? "Open platform" : "進入平台"}
                <span aria-hidden="true">↗</span>
              </a>
            )}
            <div
              aria-label={copy.shared.language}
              className="locale-toggle"
              role="group"
            >
              <button
                aria-pressed={locale === "en"}
                onClick={() => setLocale("en")}
                type="button"
              >
                English
              </button>
              <button
                aria-pressed={locale === "zh"}
                onClick={() => setLocale("zh")}
                type="button"
              >
                繁中
              </button>
            </div>
            <button
              className="token-button"
              onClick={() => dispatchLaunchAccess()}
              type="button"
            >
              {copy.nav.getTokens}
              <span aria-hidden="true">↗</span>
            </button>
            <button
              aria-controls="mobile-navigation"
              aria-expanded={isMobileMenuOpen}
              aria-label={copy.nav.openMenu}
              className="menu-trigger"
              onClick={openMobileMenu}
              ref={menuTriggerRef}
              type="button"
            >
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
              >
                <path
                  d="M3 6h14M3 14h14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
          </div>
        </header>
      </div>

      {isMobileMenuOpen && (
        <div
          aria-label={copy.nav.openMenu}
          aria-modal="true"
          className="mobile-navigation"
          id="mobile-navigation"
          ref={mobileMenuRef}
          role="dialog"
        >
          <button
            aria-label={copy.nav.closeMenu}
            className="mobile-menu-close"
            onClick={closeMobileMenu}
            type="button"
          >
            ×
          </button>
          <p className="mobile-menu-brand">
            <BrandMark />
            <span>Power Champion</span>
          </p>
          <nav aria-label={copy.nav.mobileLabel}>
            <a href="/platform" onClick={closeMobileMenu}>
              {locale === "en" ? "Open platform" : "進入平台"}
              <span aria-hidden="true">↗</span>
            </a>
            {mobileDestinations.map(([key, href]) => (
              <a
                aria-current={
                  pathname === href || pathname.startsWith(`${href}/`)
                    ? "page"
                    : undefined
                }
                href={href}
                key={key}
                onClick={closeMobileMenu}
              >
                {navigationLabel(copy, locale, key)}
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </nav>
          <button
            className="token-button"
            onClick={openLaunchAccessFromMobileMenu}
            type="button"
          >
            {copy.nav.getTokens}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      )}

      {isPlatform ? (
        <PlatformFrame pathname={pathname}>{children}</PlatformFrame>
      ) : (
        children
      )}

      <footer
        hidden={isPlatform}
        aria-label={copy.footer.label}
        className="site-footer"
      >
        <div className="footer-brand">
          {/* vinext's Vite runtime uses semantic root-relative links. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="site-brand" href="/">
            <BrandMark />
            <span>Power Champion</span>
          </a>
          <p>
            {locale === "en"
              ? "Intelligence, ready to build on."
              : "智慧就緒，讓創新即刻展開。"}
          </p>
          <a
            className="footer-contact-link"
            href="mailto:info@powerchampion.org"
          >
            info@powerchampion.org<span aria-hidden="true">↗</span>
          </a>
        </div>
        <div aria-label={copy.footer.navigation} className="footer-navigation">
          {footerDestinationGroups.map((group) => (
            <nav aria-label={copy.footer[group.label]} key={group.label}>
              <h2>{copy.footer[group.label]}</h2>
              {group.destinations.map(([key, href]) => (
                <a href={href} key={key}>
                  {footerDestinationLabel(copy, locale, key)}
                </a>
              ))}
            </nav>
          ))}
        </div>
        <div className="footer-company">
          <div>
            <p className="footer-legal-name">
              Power Champion Investment Limited
            </p>
            <p>
              {locale === "en"
                ? "7F, No. 38-1, Section 1, Ren'ai Rd, Zhongzheng District, Taipei City 100, Taiwan"
                : "100 台北市中正區仁愛路一段 38-1 號 7 樓"}
            </p>
          </div>
          <div className="footer-contact-details">
            <a href="tel:+886223960605">+886 2 2396 0605</a>
            <a href="https://b300.powerchampion.ai">
              b300.powerchampion.ai<span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
        <div
          aria-label={copy.shared.language}
          className="footer-locale-toggle"
          role="group"
        >
          <button
            aria-pressed={locale === "en"}
            onClick={() => setLocale("en")}
            type="button"
          >
            English
          </button>
          <button
            aria-pressed={locale === "zh"}
            onClick={() => setLocale("zh")}
            type="button"
          >
            繁中
          </button>
        </div>
      </footer>
    </div>
  );
}
