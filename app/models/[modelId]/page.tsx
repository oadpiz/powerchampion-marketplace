import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModelDetailContent } from "../../../components/model-detail-content";
import { MODEL_CATALOG } from "../../../lib/models";

type ModelPageProps = { params: Promise<{ modelId: string }> };

export async function generateMetadata({ params }: ModelPageProps): Promise<Metadata> {
  const { modelId } = await params;
  const model = MODEL_CATALOG.find((entry) => entry.id === modelId);
  if (!model) return { title: "Model not found | Power Champion" };

  const title = `${model.name} — API, pricing & capabilities | Power Champion`;
  return {
    title,
    description: model.servingRole.en,
    alternates: { canonical: `/models/${model.id}` },
    openGraph: { title, description: model.servingRole.en, url: `/models/${model.id}` },
  };
}

export default async function ModelPage({ params }: ModelPageProps) {
  const { modelId } = await params;
  const model = MODEL_CATALOG.find((entry) => entry.id === modelId);
  if (!model) notFound();
  return <ModelDetailContent model={model} />;
}
