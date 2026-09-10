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
        <p className="models-notice">{locale === "en" ? "Explore the model catalog. " : "探索模型目錄。"}<a href="/status">{locale === "en" ? "Check current service availability →" : "查看即時服務狀態 →"}</a></p>
      </section>
      <ModelMarketplace />
    </main>
  );
}
