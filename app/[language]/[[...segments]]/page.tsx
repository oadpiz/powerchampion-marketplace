import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InternationalSite } from "../../../components/international-site";
import { INTERNATIONAL_CONTENT } from "../../../lib/international-content";
import {
  getInternationalRoute,
  INTERNATIONAL_LANGUAGES,
  INTERNATIONAL_SECTIONS,
} from "../../../lib/languages";
import { metadataForLocalizedPage } from "../../../lib/metadata";

type PageProps = { params: Promise<{ language: string; segments?: string[] }> };

async function resolvePage(params: PageProps["params"]) {
  const { language, segments = [] } = await params;
  const route = getInternationalRoute(
    `/${language}${segments.length ? `/${segments.join("/")}` : ""}`,
  );
  if (!route) notFound();
  return route;
}

export function generateStaticParams() {
  return INTERNATIONAL_LANGUAGES.flatMap((language) =>
    INTERNATIONAL_SECTIONS.map((section) => ({
      language,
      segments: section ? [section] : [],
    })),
  );
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { language, section } = await resolvePage(params);
  const page = INTERNATIONAL_CONTENT[language].pages[section];
  return metadataForLocalizedPage(
    language,
    section === "" ? "/" : `/${section}`,
    `${page.title} | Power Champion`,
    page.description,
  );
}

export default async function InternationalPage({ params }: PageProps) {
  const route = await resolvePage(params);
  return <InternationalSite {...route} />;
}
