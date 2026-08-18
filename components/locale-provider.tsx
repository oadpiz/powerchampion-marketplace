"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { COPY, type CopyDictionary, type Locale } from "../lib/content";

type LocaleContextValue = {
  locale: Locale;
  copy: CopyDictionary;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = "pc-locale";

function detectLocale(): Locale {
  // 1. User's explicit choice (persisted)
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  }
  // 2. Browser language preference
  if (typeof navigator !== "undefined") {
    const langs = navigator.languages ?? [navigator.language];
    for (const lang of langs) {
      const lower = lang.toLowerCase();
      if (lower.startsWith("zh")) return "zh";
      if (lower.startsWith("en")) return "en";
    }
  }
  // 3. Default
  return "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Start with "en" for SSR hydration safety, then switch on mount
  const [locale, setLocaleState] = useState<Locale>("en");
  const [hydrated, setHydrated] = useState(false);

  // On mount: detect browser language (localStorage > navigator)
  useEffect(() => {
    setLocaleState(detectLocale());
    setHydrated(true);
  }, []);

  // Persist choice + sync <html lang>, handing the attribute back to the
  // host page on unmount (capture/restore on every run keeps the chain
  // intact across locale switches).
  useEffect(() => {
    const previousLanguage = document.documentElement.getAttribute("lang");
    document.documentElement.lang = locale === "en" ? "en" : "zh-Hant";
    if (hydrated) {
      window.localStorage.setItem(STORAGE_KEY, locale);
    }

    return () => {
      if (previousLanguage === null) {
        document.documentElement.removeAttribute("lang");
      } else {
        document.documentElement.lang = previousLanguage;
      }
    };
  }, [locale, hydrated]);

  const setLocale = (next: Locale) => setLocaleState(next);

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
