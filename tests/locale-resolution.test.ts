import { describe, expect, it } from "vitest";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  htmlLangFor,
  localeFromAcceptLanguage,
  normalizeLocale,
  resolveInitialLocale,
} from "../lib/locale";

describe("normalizeLocale", () => {
  it("accepts exactly the two supported values", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh")).toBe("zh");
  });

  it("rejects everything else instead of guessing", () => {
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale("zh-TW")).toBeNull();
    expect(normalizeLocale("EN")).toBeNull();
    expect(normalizeLocale("ja")).toBeNull();
  });
});

describe("localeFromAcceptLanguage", () => {
  it("maps a Traditional Chinese browser to zh", () => {
    expect(localeFromAcceptLanguage("zh-TW,zh;q=0.9,en;q=0.8")).toBe("zh");
  });

  it("maps a plain English browser to en", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("honours q-values rather than raw header order", () => {
    expect(localeFromAcceptLanguage("en;q=0.4,zh-TW;q=0.9")).toBe("zh");
    expect(localeFromAcceptLanguage("zh-TW;q=0.4,en-GB;q=0.9")).toBe("en");
  });

  it("skips unsupported languages and keeps looking", () => {
    expect(localeFromAcceptLanguage("ja-JP,fr-FR,en-GB")).toBe("en");
    expect(localeFromAcceptLanguage("ja-JP,fr-FR,zh-HK")).toBe("zh");
  });

  it("returns null when nothing usable is offered", () => {
    expect(localeFromAcceptLanguage("ja-JP,fr-FR")).toBeNull();
    expect(localeFromAcceptLanguage("*")).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });
});

describe("resolveInitialLocale", () => {
  it("prefers the cookie over the header", () => {
    expect(resolveInitialLocale({ cookie: "en", acceptLanguage: "zh-TW,zh;q=0.9" })).toBe("en");
    expect(resolveInitialLocale({ cookie: "zh", acceptLanguage: "en-US,en;q=0.9" })).toBe("zh");
  });

  it("falls through a junk cookie to the header", () => {
    expect(resolveInitialLocale({ cookie: "zh-TW", acceptLanguage: "zh-TW,zh;q=0.9" })).toBe("zh");
  });

  it("falls through to English when neither source decides", () => {
    expect(resolveInitialLocale({ cookie: null, acceptLanguage: "ja-JP" })).toBe("en");
    expect(resolveInitialLocale({})).toBe("en");
  });
});

describe("htmlLangFor", () => {
  it("uses the document language tags the site already ships", () => {
    expect(htmlLangFor("en")).toBe("en");
    expect(htmlLangFor("zh")).toBe("zh-Hant");
  });
});

describe("cookie constants", () => {
  it("keeps the cookie name aligned with the localStorage key and lasts a year", () => {
    expect(LOCALE_COOKIE).toBe("pc-locale");
    expect(LOCALE_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
  });
});
