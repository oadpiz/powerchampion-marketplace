import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { InternationalSite } from "../../../components/international-site";
import { JsonLd } from "../../../components/json-ld";
import { HOME_COPY } from "../../../lib/home-copy";
import { agentPlatformCopy } from "../../../lib/agent-platform-copy";
import { faqPageJsonLd } from "../../../lib/structured-data";
import { INTERNATIONAL_CONTENT } from "../../../lib/international-content";
import {
  getInternationalRoute,
  internationalPath,
  INTERNATIONAL_LANGUAGES,
  INTERNATIONAL_SECTIONS,
} from "../../../lib/languages";
import { metadataForLocalizedPage } from "../../../lib/metadata";
import { pickFeaturedTextModel } from "../../../lib/featured-model";
import { fetchGatewayStatus, type GatewayStatus } from "../../../lib/gateway-status";

// Localized homepages feature the text model the gateway reports as online.
export const revalidate = 60;

type PageProps = {
  params: Promise<{ language: string; segments?: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function resolvePage(
  params: PageProps["params"],
  searchParams?: PageProps["searchParams"],
) {
  const { language, segments = [] } = await params;
  if (language === "zh-Hans") {
    const section = segments[0] ?? "";
    if (
      segments.length > 1 ||
      !INTERNATIONAL_SECTIONS.some((candidate) => candidate === section)
    )
      notFound();
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries((await searchParams) ?? {})) {
      if (Array.isArray(value)) {
        for (const item of value) query.append(key, item);
      } else if (value !== undefined) {
        query.append(key, value);
      }
    }
    const destination = internationalPath(
      "zh-Hant",
      section as (typeof INTERNATIONAL_SECTIONS)[number],
    );
    const suffix = query.size ? `?${query.toString()}` : "";
    permanentRedirect(`${destination}${suffix}`);
  }
  const route = getInternationalRoute(
    `/${language}${segments.length ? `/${segments.join("/")}` : ""}`,
  );
  if (!route) notFound();
  return route;
}

export function generateStaticParams() {
  const current = INTERNATIONAL_LANGUAGES.flatMap((language) =>
    INTERNATIONAL_SECTIONS.map((section) => ({
      language,
      segments: section ? [section] : [],
    })),
  );
  const legacySimplifiedChinese = INTERNATIONAL_SECTIONS.map((section) => ({
    language: "zh-Hans",
    segments: section ? [section] : [],
  }));
  return [...current, ...legacySimplifiedChinese];
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { language, section } = await resolvePage(params, searchParams);
  const page = INTERNATIONAL_CONTENT[language].pages[section];
  return metadataForLocalizedPage(
    language,
    section === "" ? "/" : `/${section}`,
    `${page.title} | Power Champion`,
    page.description,
  );
}

export default async function InternationalPage({
  params,
  searchParams,
}: PageProps) {
  const route = await resolvePage(params, searchParams);
  let featuredTextModelId: string | undefined;
  if (route.section === "") {
    let gateway: GatewayStatus | null = null;
    try {
      gateway = await fetchGatewayStatus();
    } catch {
      gateway = null;
    }
    featuredTextModelId = pickFeaturedTextModel(gateway);
  }
  const faq = route.section === ""
    ? faqPageJsonLd(`/${route.language}`, HOME_COPY[route.language].faqs.map(([question, answer]) => ({ question, answer })))
    : route.section === "agent-platform"
      ? faqPageJsonLd(`/${route.language}/agent-platform`, agentPlatformCopy[route.language].faqs)
    : null;
  return (
    <>
      {faq ? <JsonLd data={faq} /> : null}
      <InternationalSite {...route} featuredTextModelId={featuredTextModelId} />
    </>
  );
}
