"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "./locale-provider";
import { useModalIsolation } from "./use-modal-isolation";
import { useScrollReveal } from "./use-scroll-reveal";
import type { CopyDictionary } from "../lib/content";

type NavigationKey = keyof CopyDictionary["nav"];
type FooterDestinationKey = NavigationKey | "about" | "terms" | "privacy";

const primaryDestinations: readonly [NavigationKey, string][] = [
  ["models", "/models"],
  ["pricing", "/pricing"],
  ["infrastructure", "/infrastructure"],
  ["docs", "/docs"],
  ["trust", "/trust"],
  ["company", "/company"],
  ["status", "/status"],
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
    destinations: [["models", "/models"], ["pricing", "/pricing"], ["docs", "/docs"], ["console", "/console"]],
  },
  {
    label: "companyGroup",
    destinations: [["about", "/company"], ["infrastructure", "/infrastructure"], ["trust", "/trust"], ["status", "/status"], ["contact", "/contact"]],
  },
  {
    label: "policies",
    destinations: [["faq", "/faq"], ["terms", "/terms"], ["privacy", "/privacy"]],
  },
];

const focusableSelector = 'a[href], button:not([disabled])';

function footerDestinationLabel(copy: CopyDictionary, key: FooterDestinationKey) {
  if (key === "about" || key === "terms" || key === "privacy" || key === "status") {
    return copy.footer[key];
  }

  return copy.nav[key];
}

function dispatchLaunchAccess(restoreFocusTarget?: HTMLElement | null) {
  window.dispatchEvent(new CustomEvent("powerchampion:launch-access", {
    detail: restoreFocusTarget ? { restoreFocusTarget } : undefined,
  }));
}

export function SiteShell({ children }: { children: ReactNode }) {
  const { copy, locale, setLocale } = useLocale();
  const pathname = usePathname();
  const showHeaderLaunchAccess = true;
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
    <div className="site-shell">
      <a className="skip-link" href="#main-content">{copy.nav.skipToContent}</a>
      <div className="site-header-wrapper">
      <header className="site-header">
        {/* vinext's Vite runtime does not provide next/link; this remains a root-relative semantic link. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="site-brand" href="/">Power Champion</a>
        <nav aria-label={copy.nav.primaryLabel} className="site-navigation">
          {primaryDestinations.map(([key, href]) => (
            <a href={href} key={key}>{copy.nav[key]}</a>
          ))}
        </nav>
        <div className="site-actions">
          <div aria-label={copy.shared.language} className="locale-toggle" role="group">
            <button aria-pressed={locale === "en"} onClick={() => setLocale("en")} type="button">English</button>
            <button aria-pressed={locale === "zh"} onClick={() => setLocale("zh")} type="button">繁中</button>
          </div>
          {showHeaderLaunchAccess && <button className="token-button" onClick={() => dispatchLaunchAccess()} type="button">{copy.nav.getTokens}</button>}
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
          <button aria-label={copy.nav.closeMenu} onClick={closeMobileMenu} type="button">×</button>
          <nav aria-label={copy.nav.mobileLabel}>
            {mobileDestinations.map(([key, href]) => (
              <a href={href} key={key} onClick={closeMobileMenu}>{copy.nav[key]}</a>
            ))}
          </nav>
          {showHeaderLaunchAccess && (
            <button className="token-button" onClick={openLaunchAccessFromMobileMenu} type="button">
              {copy.nav.getTokens}
            </button>
          )}
        </div>
      )}

      {children}

      <footer aria-label={copy.footer.label} className="site-footer">
        <div aria-label={copy.footer.navigation} className="footer-navigation">
          {footerDestinationGroups.map((group) => (
            <nav aria-label={copy.footer[group.label]} key={group.label}>
              <h2>{copy.footer[group.label]}</h2>
              {group.destinations.map(([key, href]) => (
                <a href={href} key={key}>{footerDestinationLabel(copy, key)}</a>
              ))}
            </nav>
          ))}
        </div>
        <div className="footer-company">
          <p><strong>PowerChampion</strong> — 7F, No. 38-1, Section 1, Ren&rsquo;ai Rd, Zhongzheng District, Taipei City 100, Taiwan</p>
          <p>
            Tel <a href="tel:+886223960605">+886 2 2396 0605</a>
            {" · "}Email <a href="mailto:info@powerchampion.org">info@powerchampion.org</a>
            {" · "}API <a href="https://b300.powerchampion.ai">b300.powerchampion.ai</a>
          </p>
        </div>
        <div aria-label={copy.shared.language} className="footer-locale-toggle" role="group">
          <button aria-pressed={locale === "en"} onClick={() => setLocale("en")} type="button">English</button>
          <button aria-pressed={locale === "zh"} onClick={() => setLocale("zh")} type="button">繁中</button>
        </div>
      </footer>
    </div>
  );
}
