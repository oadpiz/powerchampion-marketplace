/** Public URL and indexation rules shared by page metadata and the edge entry. */
export const SITE_ORIGIN = "https://powerchampion.ai";
export const SOCIAL_IMAGE = `${SITE_ORIGIN}/og-platform.png`;
export const INTERNATIONAL_LOCALES = ["zh-Hant", "zh-Hans", "ja", "ko"] as const;
export type InternationalLocale = (typeof INTERNATIONAL_LOCALES)[number];
export const LOCALIZED_SECTIONS = ["/", "/models", "/pricing", "/infrastructure", "/company", "/agent-platform"] as const;
export type LocalizedSection = (typeof LOCALIZED_SECTIONS)[number];
export const PUBLIC_ROUTES = [
  "/", "/agents", "/agent-platform", "/platform", "/models", "/compare", "/pricing", "/playground",
  "/integrations", "/docs", "/infrastructure", "/company", "/contact",
  "/trust", "/status", "/faq", "/terms", "/privacy",
] as const;
const PRIVATE_ROUTES = ["/chat", "/tasks", "/agents/build", "/account", "/admin", "/login", "/register", "/console", "/api"];

export function isInternationalLocale(value: string | null | undefined): value is InternationalLocale {
  return INTERNATIONAL_LOCALES.some((locale) => locale === value);
}

export function languageForPath(pathname: string): InternationalLocale | "en" {
  const segment = pathname.split("/")[1];
  return isInternationalLocale(segment) ? segment : "en";
}

export function localizedPath(locale: InternationalLocale | "en", section: LocalizedSection): string {
  if (locale === "en") return section;
  return `/${locale}${section === "/" ? "" : section}`;
}

export function languageAlternates(section: LocalizedSection): Record<string, string> {
  return Object.fromEntries([
    ["en", new URL(localizedPath("en", section), SITE_ORIGIN).href],
    ...INTERNATIONAL_LOCALES.map((locale) => [locale, new URL(localizedPath(locale, section), SITE_ORIGIN).href]),
    ["x-default", new URL(localizedPath("en", section), SITE_ORIGIN).href],
  ]);
}

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isIndexableRequest(url: URL): boolean {
  return url.origin === SITE_ORIGIN && !isPrivatePath(url.pathname);
}

export function publicSitemapPaths(modelIds: readonly string[]): string[] {
  return [
    ...PUBLIC_ROUTES,
    ...modelIds.map((id) => `/models/${encodeURIComponent(id)}`),
    ...INTERNATIONAL_LOCALES.flatMap((locale) => LOCALIZED_SECTIONS.map((section) => localizedPath(locale, section))),
  ];
}
