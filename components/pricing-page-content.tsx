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
      starter: "A small-scope planning reference.",
      builder: "A team planning reference.",
      scale: "A larger-scope planning reference.",
    }
    : {
      starter: "小規模規劃參考。",
      builder: "團隊規劃參考。",
      scale: "較大規模規劃參考。",
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
          <p className="eyebrow">{copy.shared.illustrative}</p>
          <h2 id="planning-packages-title">{locale === "en" ? "Launch planning references" : "啟動規劃參考"}</h2>
        </div>
        <div className="credit-grid">
          {CREDIT_PACKS.map((pack) => (
            <article className="credit-column" key={pack.id}>
              <p className="credit-pack-name">{packLabels[pack.id]}</p>
              <p className="credit-bonus">{packDescriptions[pack.id]}</p>
              <p className="credit-value">
                {locale === "en"
                  ? "Availability and service access are not enabled."
                  : "可用性與服務存取尚未啟用。"}
              </p>
            </article>
          ))}
        </div>
        <button className="credit-button pricing-launch-action" onClick={() => openLaunchAccess()} type="button">
          {copy.nav.getTokens}
        </button>
      </section>

      <section aria-labelledby="billing-title" className="pricing-calculator">
        <div className="pricing-block-heading">
          <p className="eyebrow">{copy.shared.illustrative}</p>
          <h2 id="billing-title">{locale === "en" ? "How token billing works" : "Token 計費方式"}</h2>
        </div>
        <p className="pricing-billing-copy">
          {locale === "en"
            ? "Input and output tokens are priced separately at the illustrative per-million rates in the table below. The estimator applies those same rates locally in your browser."
            : "輸入與輸出 Token 會依下方表格中的展示每百萬費率分別計價。估算器會在你的瀏覽器中以相同費率計算。"}
        </p>
      </section>

      <PricingCalculator />

      <section aria-labelledby="rates-title" className="model-rates">
        <div className="pricing-block-heading">
          <p className="eyebrow">{copy.shared.illustrative}</p>
          <h2 id="rates-title">{copy.pricing.ratesTitle}</h2>
        </div>
        <div className="rate-table" role="table">
          <div className="rate-table-head" role="row">
            <span role="columnheader">{locale === "en" ? "Model" : "模型"}</span>
            <span role="columnheader">{copy.models.input}</span>
            <span role="columnheader">{copy.models.output}</span>
          </div>
          {MODEL_CATALOG.map((model) => (
            <div className="rate-table-row" key={model.id} role="row">
              <span role="cell">{model.name}</span>
              <span role="cell"><strong>{formatRate(model.inputPerMillion)}</strong> {copy.shared.perMillionInput}</span>
              <span role="cell"><strong>{formatRate(model.outputPerMillion)}</strong> {copy.shared.perMillionOutput}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="pricing-credit-note">
        {locale === "en"
          ? "All rates and planning references are illustrative. A launch-access request stays local to this demonstration and does not create access, credits, capacity, or a reservation."
          : "所有費率與規劃參考皆為展示資料。啟動存取請求只會保留在此展示中，不會建立存取、額度、容量或保留名額。"}
      </p>
    </main>
  );
}
