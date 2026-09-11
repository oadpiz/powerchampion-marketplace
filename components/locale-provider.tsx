"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { COPY, type CopyDictionary, type Locale } from "../lib/content";
import { usePathname } from "next/navigation";
import { getInternationalRoute } from "../lib/languages";

type LocaleContextValue = {
  locale: Locale;
  copy: CopyDictionary;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = "pc-locale";

function savedLocale(): Locale {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") return stored;
    } catch {
      // Browsers may block storage; the default experience still works.
    }
  }
  return "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const canonicalEnglish = [
    "/",
    "/solutions",
    "/models",
    "/pricing",
    "/infrastructure",
    "/company",
  ].includes(pathname);
  // English is the first-visit default, including for Chinese browsers.
  // Restore an explicit saved choice after hydration to keep SSR consistent.
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    // The browser-only preference is deliberately restored after the English
    // server render has hydrated, avoiding a server/client markup mismatch.
    const regional = getInternationalRoute(pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(
      canonicalEnglish
        ? "en"
        : regional
          ? regional.language === "zh-Hant"
            ? "zh"
            : "en"
          : savedLocale(),
    );
  }, [pathname, canonicalEnglish]);

  // Sync <html lang>, handing the attribute back to the
  // host page on unmount (capture/restore on every run keeps the chain
  // intact across locale switches).
  useEffect(() => {
    const previousLanguage = document.documentElement.getAttribute("lang");
    document.documentElement.lang =
      getInternationalRoute(pathname)?.language ??
      (locale === "en" ? "en" : "zh-Hant");
    return () => {
      if (previousLanguage === null) {
        document.documentElement.removeAttribute("lang");
      } else {
        document.documentElement.lang = previousLanguage;
      }
    };
  }, [locale, pathname]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(canonicalEnglish ? "en" : next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Keep the current page usable when persistence is unavailable.
      }
    },
    [canonicalEnglish],
  );

  const value = useMemo(
    () => ({ locale, copy: COPY[locale], setLocale }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }

  return context;
}
