"use client";

import { MODEL_CATALOG } from "../lib/models";
import { CREDIT_PACKS, type CreditPack } from "../lib/pricing";
import { openLaunchAccess } from "./demo-checkout";
import { useLocale } from "./locale-provider";
import { PricingCalculator } from "./pricing-calculator";

function formatRate(rate: number) {
  return `$${rate.toFixed(2)}`;
}

export function PricingPageContent() {
  const { copy, locale } = useLocale();
  const packLabels: Record<CreditPack["id"], string> = locale === "en"
    ? { starter: "Starter", builder: "Builder", scale: "Scale" }
    : { starter: "入門", builder: "建置", scale: "規模" };
  const packDescriptions: Record<CreditPack["id"], string> = locale === "en"
    ? {
      starter: "Prepaid balance for trying every endpoint.",
      builder: "More runway for continuous workloads.",
      scale: "For production traffic and teams.",
    }
    : {
      starter: "預付餘額，試用所有端點。",
      builder: "更多額度，支應持續工作負載。",
      scale: "供正式流量與團隊使用。",
    };

  return (
    <main className="pricing-page" id="main-content">
      <section aria-labelledby="pricing-title" className="pricing-intro">
        <p className="eyebrow">{copy.pricing.kicker}</p>
        <h1 id="pricing-title">{copy.pricing.title}</h1>
        <p>{copy.pricing.lead}</p>
        <p className="pricing-notice">{copy.pricing.demoNotice}</p>
      </section>

      <section aria-labelledby="planning-packages-title" className="pricing-packs">
        <div className="pricing-block-heading">
          <p className="eyebrow">{locale === "en" ? "Prepaid balance" : "預付餘額"}</p>
          <h2 id="planning-packages-title">{locale === "en" ? "Top up your key" : "為金鑰儲值"}</h2>
        </div>
        <div className="credit-grid">
          {CREDIT_PACKS.map((pack) => (
            <article className="credit-column" key={pack.id}>
              <p className="credit-pack-name">{packLabels[pack.id]}</p>
              <p className="credit-bonus">{packDescriptions[pack.id]}</p>
              <p className="credit-value">
                {locale === "en"
                  ? `US$${pack.price} → US$${pack.credit.toFixed(2)} prepaid balance${pack.bonusPercent > 0 ? ` (incl. ${pack.bonusPercent}% bonus)` : ""}.`
                  : `US$${pack.price} → US$${pack.credit.toFixed(2)} 預付餘額${pack.bonusPercent > 0 ? `（含 ${pack.bonusPercent}% 加贈）` : ""}。`}
              </p>
            </article>
          ))}
        </div>
        <p className="pricing-credit-note" style={{ marginTop: 8 }}>
          {locale === "en"
            ? "Packs are fulfilled manually with redeem codes — request a key and top-up by email."
            : "方案以人工儲值碼發放 — 請透過 email 申請金鑰與儲值。"}
        </p>
        <button className="credit-button pricing-launch-action" onClick={() => openLaunchAccess()} type="button">
          {copy.nav.getTokens}
        </button>
      </section>

      <section aria-labelledby="billing-title" className="pricing-calculator">
        <div className="pricing-block-heading">
          <p className="eyebrow">{locale === "en" ? "Live rates" : "即時費率"}</p>
          <h2 id="billing-title">{locale === "en" ? "How token billing works" : "Token 計費方式"}</h2>
        </div>
        <p className="pricing-billing-copy">
          {locale === "en"
            ? "Input and output tokens are priced separately at the live per-million rates in the table below. The estimator applies those same rates locally in your browser."
            : "輸入與輸出 Token 會依下方表格中的即時每百萬費率分別計價。估算器會在你的瀏覽器中以相同費率計算。"}
        </p>
      </section>

      <PricingCalculator />

      <section aria-labelledby="rates-title" className="model-rates">
        <div className="pricing-block-heading">
          <p className="eyebrow">{locale === "en" ? "Live rates" : "即時費率"}</p>
          <h2 id="rates-title">{copy.pricing.ratesTitle}</h2>
        </div>
        <p className="rate-table-cue" id="rate-table-scroll-cue">{copy.pricing.ratesScrollCue}</p>
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- The labelled overflow region must receive focus and arrow-key events for keyboard scrolling. */}
        <div
          aria-describedby="rate-table-scroll-cue"
          aria-label={copy.pricing.ratesRegionLabel}
          className="rate-table-scroll"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

            event.preventDefault();
            const distance = Math.max(64, Math.round(event.currentTarget.clientWidth * 0.8));
            const maximum = Math.max(0, event.currentTarget.scrollWidth - event.currentTarget.clientWidth);
            const next = event.currentTarget.scrollLeft + (event.key === "ArrowRight" ? distance : -distance);
            event.currentTarget.scrollLeft = Math.max(0, Math.min(maximum, next));
          }}
          role="region"
          tabIndex={0}
        >
          <table aria-label={copy.pricing.ratesRegionLabel} className="rate-table">
            <thead>
              <tr className="rate-table-head">
                <th scope="col">{locale === "en" ? "Model" : "模型"}</th>
                <th scope="col">{copy.models.input}</th>
                <th scope="col">{copy.models.output}</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_CATALOG.map((model) => (
                <tr className="rate-table-row" key={model.id}>
                  <td>{model.name}</td>
                  <td><strong>{formatRate(model.inputPerMillion)}</strong> {copy.shared.perMillionInput}</td>
                  <td><strong>{formatRate(model.outputPerMillion)}</strong> {copy.shared.perMillionOutput}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      </section>

      <p className="pricing-credit-note">
        {locale === "en"
          ? "Rates are live and billed exactly as listed. Prepaid keys bill on measured usage; failed requests are not billed."
          : "費率為即時生效價格，按實際用量計費；預付金鑰用多少扣多少，失敗的請求不計費。"}
      </p>
    </main>
  );
}
