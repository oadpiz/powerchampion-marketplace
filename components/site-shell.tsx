"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useLocale } from "./locale-provider";
import { useModalIsolation } from "./use-modal-isolation";

const destinations = [
  ["models", "/models"],
  ["pricing", "/pricing"],
  ["docs", "/docs"],
  ["company", "/company"],
  ["contact", "/contact"],
  ["console", "/console"],
] as const;

const focusableSelector = 'a[href], button:not([disabled])';

function dispatchCheckout(restoreFocusTarget?: HTMLElement | null) {
  window.dispatchEvent(new CustomEvent("powerchampion:checkout", {
    detail: restoreFocusTarget ? { restoreFocusTarget } : undefined,
  }));
}

export function SiteShell({ children }: { children: ReactNode }) {
  const { copy, locale, setLocale } = useLocale();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingMobileCheckoutRef = useRef(false);

  useModalIsolation(isMobileMenuOpen, mobileMenuRef);

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
      if (event.shiftKey && (activeElement === first || !menu.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !menu.contains(activeElement))) {
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
    queueMicrotask(() => dispatchCheckout(menuTriggerRef.current));
  }, [isMobileMenuOpen]);

  const preventDisabledNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
    queueMicrotask(() => menuTriggerRef.current?.focus());
  };

  const openMobileMenu = () => {
    setIsMobileMenuOpen(true);
  };

  const openCheckoutFromMobileMenu = () => {
    pendingMobileCheckoutRef.current = true;
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">{copy.nav.skipToContent}</a>
      <header className="site-header">
        {/* vinext's Vite runtime does not provide next/link; this remains a root-relative semantic link. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="site-brand" href="/">Power Champion</a>
        <nav aria-label={copy.nav.primaryLabel} className="site-navigation">
          {destinations.map(([key, href]) => (
            <a href={href} key={key}>{copy.nav[key]}</a>
          ))}
        </nav>
        <div className="site-actions">
          <div aria-label={copy.shared.language} className="locale-toggle" role="group">
            <button aria-pressed={locale === "en"} onClick={() => setLocale("en")} type="button">English</button>
            <button aria-pressed={locale === "zh"} onClick={() => setLocale("zh")} type="button">繁中</button>
          </div>
          <button className="token-button" onClick={() => dispatchCheckout()} type="button">{copy.nav.getTokens}</button>
          <button
            aria-controls="mobile-navigation"
            aria-expanded={isMobileMenuOpen}
            aria-label={copy.nav.openMenu}
            className="menu-trigger"
            onClick={openMobileMenu}
            ref={menuTriggerRef}
            type="button"
          >
            ☰
          </button>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div
          aria-label={copy.nav.openMenu}
          aria-modal="true"
          className="mobile-navigation"
          id="mobile-navigation"
          ref={mobileMenuRef}
          role="dialog"
        >
          <button aria-label={copy.nav.closeMenu} onClick={closeMobileMenu} type="button">×</button>
          <nav aria-label={copy.nav.mobileLabel}>
            {destinations.map(([key, href]) => (
              <a href={href} key={key} onClick={closeMobileMenu}>{copy.nav[key]}</a>
            ))}
          </nav>
          <button className="token-button" onClick={openCheckoutFromMobileMenu} type="button">
            {copy.nav.getTokens}
          </button>
        </div>
      )}

      {children}

      <footer aria-label={copy.footer.label} className="site-footer">
        <nav aria-label={copy.footer.navigation}>
        {([
          [copy.footer.about, "/company"],
          [copy.nav.models, "/models"],
          [copy.nav.pricing, "/pricing"],
          [copy.nav.docs, "/docs"],
          [copy.nav.console, "/console"],
          [copy.footer.status, "#"],
          [copy.footer.terms, "#"],
          [copy.footer.privacy, "#"],
        ] as const).map(([label, href]) => {
          const disabled = href === "#";
          return (
            <a aria-disabled={disabled || undefined} href={href} key={label} onClick={disabled ? preventDisabledNavigation : undefined}>
              {label}
            </a>
          );
        })}
        </nav>
        <div aria-label={copy.shared.language} className="footer-locale-toggle" role="group">
          <button aria-pressed={locale === "en"} onClick={() => setLocale("en")} type="button">English</button>
          <button aria-pressed={locale === "zh"} onClick={() => setLocale("zh")} type="button">繁中</button>
        </div>
      </footer>
    </div>
  );
}
