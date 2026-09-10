"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { COPY, type CopyDictionary, type Locale } from "../lib/content";
import {
  LOCALE_STORAGE_KEY,
  htmlLangFor,
  normalizeLocale,
  readBootstrapLocale,
  readLocaleCookie,
  writeLocaleCookie,
} from "../lib/locale";

type LocaleContextValue = {
  locale: Locale;
  copy: CopyDictionary;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Client-side precedence, deliberately parallel to resolveInitialLocale():
 *
 *   1. cookie        — the explicit choice the server can also see
 *   2. localStorage  — the same choice from before the cookie existed
 *   3. navigator     — what the browser advertises
 *   4. fallback      — whatever the server already decided (initialLocale), or
 *                      what the Path B bootstrap script stamped on <html>
 *
 * The fallback comes last, not first: a visitor whose browser says zh should
 * see Chinese even if a cache handed them an English-resolved shell.
 */
export function detectLocale(fallback: Locale = "en"): Locale {
  const fromCookie = readLocaleCookie();
  if (fromCookie) return fromCookie;

  if (typeof window !== "undefined") {
    const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    if (stored) return stored;
  }

  if (typeof navigator !== "undefined") {
    const langs = navigator.languages ?? [navigator.language];
    for (const lang of langs) {
      const lower = lang.toLowerCase();
      if (lower.startsWith("zh")) return "zh";
      if (lower.startsWith("en")) return "en";
    }
  }

  return fallback;
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  // The server already resolved the request's locale, so the first render — and
  // therefore the SSR HTML — is in the right language. Absent the prop (tests,
  // and Path B) this is "en", exactly as before.
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? "en");
  const [hydrated, setHydrated] = useState(false);

  // On mount: re-resolve from the browser, falling back to whatever the server
  // (Path A) or the bootstrap script (Path B) decided.
  useEffect(() => {
    setLocaleState(detectLocale(initialLocale ?? readBootstrapLocale() ?? "en"));
    setHydrated(true);
  }, [initialLocale]);

  // Persist choice + sync <html lang>, handing the attribute back to the
  // host page on unmount (capture/restore on every run keeps the chain
  // intact across locale switches).
  useEffect(() => {
    const previousLanguage = document.documentElement.getAttribute("lang");
    document.documentElement.lang = htmlLangFor(locale);
    if (hydrated) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }

    return () => {
      if (previousLanguage === null) {
        document.documentElement.removeAttribute("lang");
      } else {
        document.documentElement.lang = previousLanguage;
      }
    };
  }, [locale, hydrated]);

  // Only an explicit toggle writes the cookie. Auto-detection must not, or a
  // Chinese-browser visitor who never touched the switch would be pinned to zh
  // on every later device-independent server render.
  const setLocale = (next: Locale) => {
    writeLocaleCookie(next);
    setLocaleState(next);
  };

  const value = useMemo(
    () => ({ locale, copy: COPY[locale], setLocale }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }

  return context;
}
