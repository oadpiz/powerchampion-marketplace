"use client";

import { ConsoleView } from "./console-view";
import { useLocale } from "./locale-provider";

export function ConsolePageContent() {
  const { locale } = useLocale();

  const text = locale === "en"
    ? { eyebrow: "Live balance check", lead: "Your key is forwarded through this site to the Power Champion gateway to query your balance. It is not saved in browser storage." }
    : { eyebrow: "即時餘額查詢", lead: "輸入金鑰，透過本站轉送至 Power Champion 閘道查詢餘額。金鑰不會存入瀏覽器儲存空間。" };

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
