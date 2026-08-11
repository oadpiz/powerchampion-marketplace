"use client";

import { CREDIT_PACKS } from "../lib/pricing";
import { MODEL_CATALOG } from "../lib/models";
import { COMPANY_CONTENT } from "../lib/company";
import { ConsoleView } from "./console-view";
import { useLocale } from "./locale-provider";
import { AudiencePaths } from "./audience-paths";

export function HomeContent() {
  const { copy, locale } = useLocale();
  const company = COMPANY_CONTENT[locale];
  const featuredModels = MODEL_CATALOG.slice(0, 4);
  const proofPoints = [
    ["28", copy.home.activeRoutes],
    ["128K+", copy.home.contextAvailable],
    ["99.98%", copy.home.illustrativeAvailability],
  ] as const;
  const speedLabels = {
    Fast: copy.models.fast,
    Balanced: copy.models.balanced,
    Deep: copy.models.deep,
  } as const;
  const packLabels = {
    starter: copy.home.starterPack,
    builder: copy.home.builderPack,
    scale: copy.home.scalePack,
  } as const;
  const requestCheckout = () => {
    window.dispatchEvent(new Event("powerchampion:checkout"));
  };

  return (
    <main className="home-page" id="main-content">
      <section aria-labelledby="home-title" className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{copy.home.kicker}</p>
          <h1 id="home-title">
            {copy.home.title}
            <span>{copy.home.accent}</span>
          </h1>
          <p className="hero-lead">{copy.home.lead}</p>
          <p className="hero-launch-status" role="status">{copy.home.launchStatus}</p>
          <div className="hero-actions">
            <a className="primary-link" href="/models">{copy.home.developerPath}</a>
            <a className="text-link" href="/contact">{copy.home.enterprisePath} <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </section>

      <AudiencePaths />

      <section aria-describedby="proof-disclosure" aria-label={copy.home.proofLabel} className="proof-strip">
        {proofPoints.map(([value, label]) => (
          <div className="proof-item" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
        <p className="proof-disclosure" id="proof-disclosure">{copy.shared.illustrative}</p>
      </section>

      <section
        aria-describedby="home-infrastructure-disclosure"
        aria-label={company.home.heading}
        className="home-infrastructure-brief"
      >
        <p className="home-infrastructure-heading">{company.home.heading}</p>
        <div className="home-infrastructure-fact">
          <strong aria-describedby="home-infrastructure-disclosure">
            {company.capacity.initialMw}
          </strong>
          <p id="home-infrastructure-disclosure">
            {company.home.context}
          </p>
        </div>
        <a href="/company">{company.home.linkLabel}</a>
      </section>

      <section aria-labelledby="featured-models-title" className="home-section model-marketplace">
        <div className="section-intro">
          <p className="eyebrow">{copy.models.kicker}</p>
          <h2 id="featured-models-title">{copy.home.modelsTitle}</h2>
          <p>{copy.home.modelsLead}</p>
        </div>
        <div className="model-list">
          {featuredModels.map((model, index) => (
            <article aria-label={model.name} className={`model-row model-row-${model.id}`} key={model.id}>
              <span aria-hidden="true" className="model-rail" />
              <div className="model-index">0{index + 1}</div>
              <div className="model-identity">
                <h3>{model.name}</h3>
                <p>{model.tagline[locale]}</p>
              </div>
              <dl className="model-facts">
                <div>
                  <dt>{copy.models.context}</dt>
                  <dd>{model.context}</dd>
                </div>
                <div>
                  <dt>{copy.models.speed}</dt>
                  <dd>{speedLabels[model.speed]}</dd>
                </div>
                <div>
                  <dt>{copy.home.startingInputRate}</dt>
                  <dd>${model.inputPerMillion.toFixed(2)} {copy.shared.perMillionInput}</dd>
                </div>
              </dl>
              <a aria-label={`${copy.home.explore}: ${model.name}`} href="/models">↗</a>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="credit-title" className="home-section credit-section">
        <div className="section-intro section-intro-split">
          <div>
            <p className="eyebrow">{copy.pricing.kicker}</p>
            <h2 id="credit-title">{copy.home.creditTitle}</h2>
          </div>
          <p>{copy.home.creditLead}</p>
        </div>
        <div className="credit-grid">
          {CREDIT_PACKS.map((pack) => (
            <article className="credit-column" key={pack.id}>
              <p className="credit-pack-name">{packLabels[pack.id]}</p>
              <p className="credit-price"><span>$</span>{pack.price}</p>
              <p className="credit-value">${pack.credit} {copy.home.accountCredit}</p>
              <p className="credit-bonus">
                {pack.bonusPercent > 0 ? `${copy.home.includesBonus} ${pack.bonusPercent}% ${copy.home.bonusCredit}` : copy.home.paygCredit}
              </p>
              <button className="credit-button" onClick={requestCheckout} type="button">{copy.nav.getTokens}</button>
            </article>
          ))}
        </div>
        <p className="showcase-note">{copy.pricing.demoNotice}</p>
      </section>

      <section aria-labelledby="console-title" className="home-section console-section">
        <div className="section-intro section-intro-split">
          <div>
            <p className="eyebrow">{copy.console.demo}</p>
            <h2 id="console-title">{copy.home.consoleTitle}</h2>
          </div>
          <p>{copy.home.consoleLead}</p>
        </div>
        <ConsoleView compact />
      </section>

      <section aria-labelledby="closing-title" className="closing-cta" id="about">
        <p className="eyebrow">Power Champion</p>
        <h2 id="closing-title">{copy.home.finalTitle}</h2>
        <p>{copy.home.finalLead}</p>
        <a className="primary-link" href="/docs">{copy.home.getStarted}</a>
      </section>
    </main>
  );
}
