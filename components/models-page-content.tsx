"use client";

import { ModelMarketplace } from "./model-marketplace";
import { useLocale } from "./locale-provider";

export function ModelsPageContent() {
  const { copy, locale } = useLocale();

  return (
    <main className="models-page" id="main-content">
      <section aria-labelledby="models-title" className="models-intro">
        <p className="eyebrow">{copy.models.kicker}</p>
        <h1 id="models-title">{copy.models.title}</h1>
        <p>{copy.models.lead}</p>
        <p className="models-notice">{locale === "en" ? "Live catalog — all models served by the b300 gateway." : "即時目錄——所有模型由 b300 閘道提供服務。"}</p>
      </section>
      <ModelMarketplace />
    </main>
  );
}
