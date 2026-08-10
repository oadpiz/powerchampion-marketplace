"use client";

import { ConsoleView } from "../../components/console-view";
import { useLocale } from "../../components/locale-provider";

export default function ConsolePage() {
  const { copy, locale } = useLocale();

  return (
    <main className="console-page">
      <section aria-labelledby="console-title" className="console-intro">
        <p className="eyebrow">{copy.console.demo}</p>
        <h1 id="console-title">{copy.console.title}</h1>
        <p>{locale === "en" ? "Illustrative local usage only. Refreshing resets this display state." : "僅顯示本機展示用量；重新整理會重設此顯示狀態。"}</p>
      </section>
      <ConsoleView />
    </main>
  );
}
