"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
 *   3. fallback      — what the server resolved from Accept-Language
 *                      (initialLocale), what the Path B bootstrap script
 *                      stamped on <html>, or "en"
 *
 * navigator.languages is deliberately NOT consulted here: Accept-Language is
 * read once on the server, so re-deriving it in the browser would only be able
 * to contradict the SSR markup. A visitor who never chose a language keeps the
 * language the server picked, and nothing implicit is persisted.
 */
export function detectLocale(fallback: Locale = "en"): Locale {
  const fromCookie = readLocaleCookie();
  if (fromCookie) return fromCookie;

  if (typeof window !== "undefined") {
    try {
      const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
      if (stored) return stored;
    } catch {
      // Browsers may block storage; the rest of the chain still works.
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
    // The browser-only preference is deliberately resolved after the server
    // render has hydrated, avoiding a server/client markup mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(detectLocale(initialLocale ?? readBootstrapLocale() ?? "en"));
    setHydrated(true);
  }, [initialLocale]);

  // Sync <html lang>, handing the attribute back to the
  // host page on unmount (capture/restore on every run keeps the chain
  // intact across locale switches).
  useEffect(() => {
    const previousLanguage = document.documentElement.getAttribute("lang");
    document.documentElement.lang = htmlLangFor(locale);
    if (hydrated) {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      } catch {
        // Keep the current page usable when persistence is unavailable.
      }
    }

    return () => {
      if (previousLanguage === null) {
        document.documentElement.removeAttribute("lang");
      } else {
        document.documentElement.lang = previousLanguage;
      }
    };
    // `hydrated` is deliberately NOT a dependency: re-running this effect the
    // moment hydration flips would persist the auto-detected locale, turning a
    // default into an implicit stored preference. Only a real `locale` change
    // (i.e. an explicit toggle, which happens after hydration) may write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // Only an explicit toggle writes the cookie. Auto-detection must not, or a
  // Chinese-browser visitor who never touched the switch would be pinned to zh
  // on every later device-independent server render.
  const setLocale = useCallback((next: Locale) => {
    writeLocaleCookie(next);
    setLocaleState(next);
  }, []);

  const value = useMemo(
    () => ({ locale, copy: COPY[locale], setLocale }),
    [locale, setLocale],
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
