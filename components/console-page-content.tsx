"use client";

import { ConsoleView } from "./console-view";
import { useLocale } from "./locale-provider";

export function ConsolePageContent() {
  const { locale } = useLocale();

  const text = locale === "en"
    ? { eyebrow: "Live balance check", lead: "Enter your key to query the b300 gateway directly. Your key is sent only to the gateway and never stored." }
    : { eyebrow: "即時餘額查詢", lead: "輸入你的 Key 直接查詢 b300 閘道。Key 只會送往閘道，不會被儲存。" };

  return (
    <main className="console-page" id="main-content">
      <section aria-label={text.eyebrow} className="console-boundary">
        <p className="eyebrow">{text.eyebrow}</p>
        <p>{text.lead}</p>
      </section>
      <section aria-labelledby="console-title" className="console-intro">
        <p className="eyebrow">{text.eyebrow}</p>
        <h1 id="console-title">{locale === "en" ? "Your balance, live." : "你的餘額，即時呈現。"}</h1>
        <p>{locale === "en" ? "Prepaid credit for every model — one key, nano-USD precision." : "所有模型共用預付餘額——一把 Key，nano-USD 精度。"}</p>
      </section>
      <ConsoleView />
    </main>
  );
}
