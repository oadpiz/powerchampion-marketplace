"use client";

import { ModelMarketplace } from "./model-marketplace";
import { useLocale } from "./locale-provider";

export function ModelsPageContent() {
  const { copy } = useLocale();

  return (
    <main className="models-page" id="main-content">
      <section aria-labelledby="models-title" className="models-intro">
        <p className="eyebrow">{copy.models.kicker}</p>
        <h1 id="models-title">{copy.models.title}</h1>
        <p>{copy.models.lead}</p>
        <p className="models-notice">{copy.shared.illustrative}</p>
      </section>
      <ModelMarketplace />
    </main>
  );
}
