/**
 * One definition of "which language is this request in".
 *
 * The server (app/layout.tsx) resolves the locale from the request before the
 * first byte of HTML, so <html lang> and the first paint are already correct;
 * the client (components/locale-provider.tsx) resolves the same thing from the
 * browser. Both read the same cookie, so a visitor who picks a language once
 * gets it on every subsequent server render — that is the whole point of the
 * cookie, and why localStorage alone was not enough.
 *
 * This module is deliberately framework-free: it must be importable from a
 * server component, a "use client" component, and a plain vitest file. Nothing
 * here may import "next/headers" (vitest has no alias for it) or React.
 */

import type { Locale } from "./content";

/** Shared with the server. Read on every request in app/layout.tsx. */
export const LOCALE_COOKIE = "pc-locale";

/**
 * Same string, different store. Kept as its own constant because the two have
 * independent lifetimes: the cookie is what the server can see, localStorage is
 * the pre-cookie preference that still has to keep working for returning
 * visitors who have not toggled the language since this shipped.
 */
export const LOCALE_STORAGE_KEY = "pc-locale";

/** One year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Set by the Path B bootstrap script before hydration; absent under Path A. */
export const LOCALE_BOOTSTRAP_ATTRIBUTE = "data-locale";

export function normalizeLocale(value: string | null | undefined): Locale | null {
  return value === "en" || value === "zh" ? value : null;
}

export function htmlLangFor(locale: Locale): "en" | "zh-Hant" {
  return locale === "zh" ? "zh-Hant" : "en";
}

type WeightedTag = { tag: string; quality: number; order: number };

function parseAcceptLanguage(header: string): WeightedTag[] {
  return header
    .split(",")
    .map((part, order) => {
      const [rawTag, ...params] = part.split(";");
      const tag = rawTag.trim().toLowerCase();
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const parsed = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      const quality = Number.isFinite(parsed) ? parsed : 0;
      return { tag, quality, order };
    })
    .filter((entry) => entry.tag.length > 0 && entry.quality > 0)
    // Array.prototype.sort is stable, so equal q-values keep header order —
    // which is what a browser means when it omits q entirely.
    .sort((a, b) => b.quality - a.quality || a.order - b.order);
}

/**
 * The first tag the gateway's two locales can serve wins. Ordering is by
 * q-value, not raw header order, so "en;q=0.4,zh-TW;q=0.9" is a Chinese
 * browser. Anything else (ja, fr, "*") yields null so the caller can decide.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const { tag } of parseAcceptLanguage(header)) {
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("en")) return "en";
  }
  return null;
}

/**
 * Server-side precedence: an explicit choice (cookie) beats the browser's
 * advertised preference (Accept-Language), which beats English.
 */
export function resolveInitialLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  return (
    normalizeLocale(input.cookie)
    ?? localeFromAcceptLanguage(input.acceptLanguage)
    ?? "en"
  );
}

export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`),
  );
  return match ? normalizeLocale(decodeURIComponent(match[1])) : null;
}

export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  // Secure only over https — jsdom and `vinext dev` both serve over http and
  // would silently drop a Secure cookie, which would make the toggle look
  // like it works and then forget the choice on the next request.
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/**
 * Path B only: the inline bootstrap script stamps data-locale on <html> before
 * hydration. Returns null under Path A, where the server already passed
 * initialLocale down as a prop.
 */
export function readBootstrapLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  return normalizeLocale(
    document.documentElement.getAttribute(LOCALE_BOOTSTRAP_ATTRIBUTE),
  );
}
