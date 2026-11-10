import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiReferenceContent } from "../../../../components/api-reference-content";
import { JsonLd } from "../../../../components/json-ld";
import { API_REFERENCE_PAGES, apiReferencePageForSlug } from "../../../../lib/api-reference";
import { fetchGatewayStatus, type GatewayStatus } from "../../../../lib/gateway-status";
import { metadataForPage } from "../../../../lib/metadata";
import { SITE_ORIGIN } from "../../../../lib/seo";

type SectionPageProps = { params: Promise<{ section: string }> };

// Each guide section is its own citable page. The models section still shows
// live readiness from the gateway's status feed.
export const revalidate = 60;

export function generateStaticParams() {
  return API_REFERENCE_PAGES.map((page) => ({ section: page.slug }));
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { section } = await params;
  const page = apiReferencePageForSlug(section);
  if (!page) return { title: "Not found | Power Champion", robots: { index: false, follow: false } };
  return metadataForPage(`/docs/api/${page.slug}`, page.title, page.description);
}

export default async function ApiSectionPage({ params }: SectionPageProps) {
  const { section } = await params;
  const page = apiReferencePageForSlug(section);
  if (!page) notFound();

  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null;
  }

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Documentation", item: `${SITE_ORIGIN}/docs` },
      { "@type": "ListItem", position: 2, name: "API Reference", item: `${SITE_ORIGIN}/docs/api` },
      { "@type": "ListItem", position: 3, name: page.card.en.title, item: `${SITE_ORIGIN}/docs/api/${page.slug}` },
    ],
  };

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <ApiReferenceContent gateway={gateway} slug={page.slug} />
    </>
  );
}
