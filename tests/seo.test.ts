import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { metadataForRoute, metadataForPage, metadataForLocalizedPage } from "../lib/metadata";
import { MODEL_CATALOG } from "../lib/models";
import { internationalPath } from "../lib/languages";
import {
  INTERNATIONAL_LOCALES, LOCALIZED_SECTIONS, SITE_ORIGIN, SOCIAL_IMAGE,
  isIndexableRequest, languageForPath, languageAlternates, localizedPath,
  publicSitemapPaths,
} from "../lib/seo";

describe("Search visibility boundaries", () => {
  it("indexes public content only on the canonical HTTPS origin", () => {
    expect(isIndexableRequest(new URL("https://powerchampion.ai/models"))).toBe(true);
    for (const url of [
      "http://powerchampion.ai/models", "https://preview.powerchampion.ai/models",
      "http://localhost:3010/models", "https://powerchampion.ai.evil.test/models",
      "https://powerchampion.ai:8443/models", "https://powerchampion.ai/account",
      "https://powerchampion.ai/admin/users", "https://powerchampion.ai/login",
      "https://powerchampion.ai/register", "https://powerchampion.ai/console",
      "https://powerchampion.ai/api/portal/me", "https://powerchampion.ai/chat",
      "https://powerchampion.ai/agents/build", "https://powerchampion.ai/agents/build/export",
      "https://powerchampion.ai/tasks", "https://powerchampion.ai/tasks?task=private",
    ]) expect(isIndexableRequest(new URL(url)), url).toBe(false);
    expect(isIndexableRequest(new URL("https://powerchampion.ai/platform"))).toBe(true);
    expect(isIndexableRequest(new URL("https://powerchampion.ai/agents"))).toBe(true);
    expect(isIndexableRequest(new URL("https://powerchampion.ai/solutions"))).toBe(true);
  });

  it("marks account and key tools as non-indexable in HTML metadata too", () => {
    for (const path of ["/account", "/admin", "/login", "/register", "/console", "/chat", "/tasks", "/agents/build"] as const) {
      expect(metadataForRoute(path).robots).toEqual({ index: false, follow: false });
    }
    // Preview policy belongs to the request boundary, so public page metadata
    // must not override a parent's noindex with a static index:true.
    expect(metadataForRoute("/models").robots).toBeUndefined();
  });
});

describe("Localized search metadata", () => {
  it("shares the Agent introduction with its own social image and five public translations", () => {
    const metadata = metadataForRoute("/agent-platform");
    expect(metadata.alternates?.canonical).toBe(`${SITE_ORIGIN}/agent-platform`);
    expect(metadata.alternates?.languages).toEqual(languageAlternates("/agent-platform"));
    expect(metadata.openGraph).toMatchObject({ images: [{ url: `${SITE_ORIGIN}/og-agents.png`, width: 1200, height: 630 }] });
    expect(metadata.twitter).toMatchObject({ images: [{ url: `${SITE_ORIGIN}/og-agents.png` }] });
    expect(readFileSync(`${process.cwd()}/public/og-agents.png`).subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  });
  it("gives every complete translation reciprocal same-section alternates", () => {
    for (const section of LOCALIZED_SECTIONS) {
      const alternates = languageAlternates(section);
      expect(alternates.en).toBe(new URL(section, SITE_ORIGIN).href);
      expect(alternates["x-default"]).toBe(alternates.en);
      expect(Object.keys(alternates)).toHaveLength(6);
      expect(metadataForRoute(section).alternates?.languages).toEqual(alternates);
      for (const language of INTERNATIONAL_LOCALES) {
        const metadata = metadataForLocalizedPage(language, section, "Localized title", "Localized description");
        expect(metadata.alternates?.canonical).toBe(alternates[language]);
        expect(metadata.alternates?.languages).toEqual(alternates);
        expect(metadata.title).toBe("Localized title");
        expect(languageForPath(localizedPath(language, section))).toBe(language);
      }
    }
    expect(languageForPath("/ja-jp/models")).toBe("en");
    expect(languageForPath("/models/ja")).toBe("en");
    expect(metadataForRoute("/playground").alternates?.languages).toBeUndefined();
  });

  it("keeps the brand homepage canonical and the chat tool independently scoped", () => {
    expect(metadataForRoute("/").title).toBe("Power Champion — One API. Every possibility.");
    expect(metadataForRoute("/").alternates?.languages).toEqual(languageAlternates("/"));
    expect(metadataForRoute("/").alternates?.canonical).toBe(`${SITE_ORIGIN}/`);
    expect(metadataForRoute("/solutions").alternates?.canonical).toBe(`${SITE_ORIGIN}/`);
    expect(metadataForRoute("/solutions").title).toEqual(metadataForRoute("/").title);
    expect(metadataForRoute("/solutions").alternates?.languages).toEqual(languageAlternates("/"));
    expect(metadataForRoute("/solutions").openGraph).toMatchObject({ url: `${SITE_ORIGIN}/` });
    expect(metadataForRoute("/chat").alternates?.canonical).toBe(`${SITE_ORIGIN}/chat`);
    expect(metadataForRoute("/chat").title).not.toEqual(metadataForRoute("/").title);
    expect(metadataForRoute("/chat").alternates?.languages).toBeUndefined();
    expect(metadataForRoute("/chat").openGraph).toMatchObject({ url: `${SITE_ORIGIN}/chat` });
    expect(metadataForRoute("/agents/build").alternates?.canonical).toBe(`${SITE_ORIGIN}/agents/build`);
    expect(localizedPath("en", "/")).toBe("/");
    expect(internationalPath("en", "")).toBe("/");
    expect(languageAlternates("/")["x-default"]).toBe(`${SITE_ORIGIN}/`);
  });

  it("keeps model titles and images consistent across social cards", () => {
    const metadata = metadataForPage("/models/bge-m3", "BGE-M3 API", "Retrieval embeddings");
    expect(metadata.alternates?.canonical).toBe(`${SITE_ORIGIN}/models/bge-m3`);
    expect(metadata.openGraph).toMatchObject({ title: "BGE-M3 API", url: `${SITE_ORIGIN}/models/bge-m3`, images: [{ url: SOCIAL_IMAGE, width: 1200, height: 630 }] });
    expect(metadata.twitter).toMatchObject({ title: "BGE-M3 API", card: "summary_large_image", images: [{ url: SOCIAL_IMAGE }] });
  });
});

describe("Public sitemap", () => {
  it("matches the route registry and excludes personal or nonexistent pages", () => {
    const xml = readFileSync(`${process.cwd()}/public/sitemap.xml`, "utf8");
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    const expected = publicSitemapPaths(MODEL_CATALOG.map((model) => model.id)).map((path) => new URL(path, SITE_ORIGIN).href);
    expect(urls).toEqual(expected);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(50);
    expect(urls).not.toContain(`${SITE_ORIGIN}/solutions`);
    expect(urls).toContain(`${SITE_ORIGIN}/agents`);
    expect(urls).not.toContain(`${SITE_ORIGIN}/chat`);
    expect(urls).not.toContain(`${SITE_ORIGIN}/agents/build`);
    for (const url of urls) expect(isIndexableRequest(new URL(url)), url).toBe(true);
    expect(xml).not.toContain("2026-08-21");
  });

  it("retains the content policy without blocking crawling of noindex pages", () => {
    const robots = readFileSync(`${process.cwd()}/public/robots.txt`, "utf8");
    expect(robots).toContain("User-agent: *\nAllow: /");
    expect(robots).toContain("ai-input: no");
    expect(robots).toContain("ai-train: no");
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    expect(robots).not.toMatch(/^Disallow:\s*\/(?:account|admin|console)/m);
  });
});
