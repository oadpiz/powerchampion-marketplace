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
    <main className="pricing-page" id="main-content">
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
              <p className="credit-value">${pack.credit.toFixed(2)} {locale === "en" ? "indicative account credit" : "指示性帳戶額度"}</p>
              <p className="credit-bonus">{pack.bonusPercent > 0 ? `${pack.bonusPercent}% ${locale === "en" ? "indicative launch bonus" : "指示性啟動加碼"}` : locale === "en" ? "Indicative account credit" : "指示性帳戶額度"}</p>
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

      <p className="pricing-credit-note">{locale === "en" ? "Package values are illustrative only. A launch-access request is local to this demonstration and does not create credit, capacity, or a reservation." : "方案數值僅供展示。啟動存取請求只會儲存在此展示中，不會建立額度、容量或保留名額。"}</p>
    </main>
  );
}
