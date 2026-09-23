export const INTERNATIONAL_LANGUAGES = [
  "zh-Hant",
  "zh-Hans",
  "ja",
  "ko",
] as const;
export type InternationalLanguage = (typeof INTERNATIONAL_LANGUAGES)[number];
export const INTERNATIONAL_SECTIONS = [
  "",
  "models",
  "agent-platform",
  "pricing",
  "infrastructure",
  "company",
] as const;
export type InternationalSection = (typeof INTERNATIONAL_SECTIONS)[number];

export const LANGUAGE_NAMES: Record<InternationalLanguage | "en", string> = {
  en: "English",
  "zh-Hant": "繁體中文",
  "zh-Hans": "简体中文",
  ja: "日本語",
  ko: "한국어",
};

export function isInternationalLanguage(
  value: string,
): value is InternationalLanguage {
  return INTERNATIONAL_LANGUAGES.some((language) => language === value);
}

export function internationalPath(
  language: InternationalLanguage | "en",
  section: InternationalSection = "",
): string {
  if (language === "en") return section ? `/${section}` : "/";
  return `/${language}${section ? `/${section}` : ""}`;
}

export function getInternationalRoute(
  pathname: string,
): { language: InternationalLanguage; section: InternationalSection } | null {
  const match = pathname.match(/^\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match || !isInternationalLanguage(match[1])) return null;
  const section = match[2] ?? "";
  if (!INTERNATIONAL_SECTIONS.some((candidate) => candidate === section))
    return null;
  return { language: match[1], section: section as InternationalSection };
}
