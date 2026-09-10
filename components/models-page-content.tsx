"use client";

import type { ModelDefinition } from "../lib/models";
import { CatalogSnapshotNotice } from "./catalog-snapshot-notice";
import { ModelMarketplace } from "./model-marketplace";
import { useLocale } from "./locale-provider";

type Props = {
  models: ModelDefinition[];
  snapshotDate: string | null;
};

export function ModelsPageContent({ models, snapshotDate }: Props) {
  const { copy, locale } = useLocale();

  return (
    <main className="models-page" id="main-content">
      <section aria-labelledby="models-title" className="models-intro">
        <p className="eyebrow">{copy.models.kicker}</p>
        <h1 id="models-title">{copy.models.title}</h1>
        <p>{copy.models.lead}</p>
        <p className="models-notice">{locale === "en" ? "Live catalog — all models served by the b300 gateway." : "即時目錄——所有模型由 b300 閘道提供服務。"}</p>
        <CatalogSnapshotNotice snapshotDate={snapshotDate} />
      </section>
      <ModelMarketplace models={models} />
    </main>
  );
}
