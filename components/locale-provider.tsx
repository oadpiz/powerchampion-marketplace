"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { COPY, type CopyDictionary, type Locale } from "../lib/content";

type LocaleContextValue = {
  locale: Locale;
  copy: CopyDictionary;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    const previousLanguage = document.documentElement.getAttribute("lang");
    document.documentElement.lang = locale === "en" ? "en" : "zh-Hant";

    return () => {
      if (previousLanguage === null) {
        document.documentElement.removeAttribute("lang");
      } else {
        document.documentElement.lang = previousLanguage;
      }
    };
  }, [locale]);
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
