import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModelDetailContent } from "../../../components/model-detail-content";
import { MODEL_CATALOG } from "../../../lib/models";
import { metadataForPage } from "../../../lib/metadata";
import { SITE_ORIGIN } from "../../../lib/seo";

type ModelPageProps = { params: Promise<{ modelId: string }> };

export async function generateMetadata({ params }: ModelPageProps): Promise<Metadata> {
  const { modelId } = await params;
  const model = MODEL_CATALOG.find((entry) => entry.id === modelId);
  if (!model) return { title: "Model not found | Power Champion", robots: { index: false, follow: false } };

  const title = `${model.name} — API, pricing & capabilities | Power Champion`;
  return metadataForPage(`/models/${model.id}`, title, model.servingRole.en);
}

export default async function ModelPage({ params }: ModelPageProps) {
  const { modelId } = await params;
  const model = MODEL_CATALOG.find((entry) => entry.id === modelId);
  if (!model) notFound();
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Model catalog", item: `${SITE_ORIGIN}/models` },
      { "@type": "ListItem", position: 2, name: model.name, item: `${SITE_ORIGIN}/models/${model.id}` },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs).replace(/</g, "\\u003c") }} />
    <ModelDetailContent model={model} />
  </>;
}
