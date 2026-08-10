"use client";

import { MODEL_CATALOG } from "../../lib/models";
import { CREDIT_PACKS, type CreditPack } from "../../lib/pricing";
import { openCheckout } from "../../components/demo-checkout";
import { useLocale } from "../../components/locale-provider";
import { PricingCalculator } from "../../components/pricing-calculator";

function formatRate(rate: number) {
  return `$${rate.toFixed(2)}`;
}

export default function PricingPage() {
  const { copy, locale } = useLocale();
  const packLabels: Record<CreditPack["id"], string> = locale === "en"
    ? { starter: "Starter", builder: "Builder", scale: "Scale" }
    : { starter: "入門", builder: "建置", scale: "規模" };

  return (
    <main className="pricing-page">
      <section aria-labelledby="pricing-title" className="pricing-intro">
        <p className="eyebrow">{copy.pricing.kicker}</p>
        <h1 id="pricing-title">{copy.pricing.title}</h1>
        <p>{copy.pricing.lead}</p>
        <p className="pricing-notice">{copy.pricing.demoNotice}</p>
      </section>

      <section aria-label={copy.nav.getTokens} className="pricing-packs">
        <div className="credit-grid">
          {CREDIT_PACKS.map((pack) => (
            <article className="credit-column" key={pack.id}>
              <p className="credit-pack-name">{packLabels[pack.id]}</p>
              <p className="credit-price"><span>$</span>{pack.price}</p>
              <p className="credit-value">${pack.credit.toFixed(2)} {locale === "en" ? "account credit" : "帳戶額度"}</p>
              <p className="credit-bonus">{pack.bonusPercent > 0 ? `${pack.bonusPercent}% ${locale === "en" ? "showcase bonus" : "展示加碼"}` : locale === "en" ? "Straightforward account credit" : "直接帳戶額度"}</p>
              <button className="credit-button" onClick={() => openCheckout(pack.id)} type="button">{copy.nav.getTokens}</button>
            </article>
          ))}
        </div>
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

      <p className="pricing-credit-note">{locale === "en" ? "Account credit is currency-denominated. The token volume it covers varies by the selected model’s input and output rates." : "帳戶額度以貨幣計價；可涵蓋的 Token 數量會依選擇模型的輸入與輸出費率而不同。"}</p>
    </main>
  );
}
