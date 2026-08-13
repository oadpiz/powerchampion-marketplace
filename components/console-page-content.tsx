"use client";

import { ConsoleView } from "./console-view";
import { useLocale } from "./locale-provider";

export function ConsolePageContent() {
  const { copy, locale } = useLocale();

  return (
    <main className="console-page" id="main-content">
      <section aria-label={copy.console.previewLabel} className="console-boundary">
        <p className="eyebrow">{copy.console.previewLabel}</p>
        <p>{copy.console.previewDescription}</p>
      </section>
      <section aria-labelledby="console-title" className="console-intro">
        <p className="eyebrow">{copy.console.demo}</p>
        <h1 id="console-title">{copy.console.title}</h1>
        <p>{locale === "en" ? "Illustrative local display state. Refreshing resets this preview." : "展示用本機顯示狀態；重新整理會重設此預覽。"}</p>
      </section>
      <ConsoleView />
    </main>
  );
}
