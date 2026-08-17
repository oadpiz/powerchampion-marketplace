"use client";

import { COMPANY_CONTENT } from "../lib/company";
import { MODEL_CATALOG } from "../lib/models";
import { TRUST_CONTENT } from "../lib/trust";
import { AudiencePaths } from "./audience-paths";
import { ConsoleView } from "./console-view";
import { useLocale } from "./locale-provider";

export function HomeContent() {
  const { copy, locale } = useLocale();
  const company = COMPANY_CONTENT[locale];
  const trust = TRUST_CONTENT[locale];
  const catalogCount = MODEL_CATALOG.length;
  const maxContext = MODEL_CATALOG.reduce((max, model) => {
    const parsed = Number.parseInt(model.context, 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  const startingRate = Math.min(...MODEL_CATALOG.map((model) => model.inputPerMillion));
  const text = locale === "en" ? {
    compareRates: "Compare token rates",
    deploymentReview: "Deployment review",
    facts: "Marketplace facts",
    catalogEntries: "live models in the catalog",
    maximumContext: "maximum catalog context",
    startingRate: "starting input rate",
    price: "Live price",
    provenance: "Provenance review",
    release: "Release state",
    access: "How access works",
    compare: "Compare",
    estimate: "Estimate",
    request: "Request",
    accessLead: "Compare decision fields, estimate usage, then request an API key by email.",
    rateAccess: "Prepaid access",
    rateLead: "One key, pay per use from your prepaid balance.",
    enterprise: "Enterprise planning",
    enterpriseLead: "Start with qualified public capacity context and the release inputs needed for a future deployment conversation.",
    infrastructure: "Review infrastructure context",
    trust: "Trust and readiness",
    trustLead: "Public boundaries and release readiness remain separate from future service access.",
    trustBoundary: "Trust boundary",
    serviceStatus: "Service status",
  } : {
    compareRates: "比較 Token 費率",
    deploymentReview: "部署審查",
    facts: "市集事實",
    catalogEntries: "目錄中的即時模型",
    maximumContext: "目錄最大上下文",
    startingRate: "起始輸入費率",
    price: "即時價格",
    provenance: "來源審查",
    release: "發布狀態",
    access: "存取方式",
    compare: "比較",
    estimate: "估算",
    request: "申請",
    accessLead: "先比較決策欄位、估算用量，再透過 email 申請 API 金鑰。",
    rateAccess: "預付存取",
    rateLead: "一把金鑰，從預付餘額按量計費。",
    enterprise: "企業規劃",
    enterpriseLead: "先檢視限定的公開容量脈絡，以及未來部署對話所需的發布輸入。",
    infrastructure: "檢視基礎設施脈絡",
    trust: "信任與就緒狀態",
    trustLead: "公開邊界與發布就緒狀態，和未來服務存取分開呈現。",
    trustBoundary: "信任邊界",
    serviceStatus: "服務狀態",
  };
  const requestLaunchAccess = () => window.dispatchEvent(new Event("powerchampion:launch-access"));

  return (
    <main className="home-page" id="main-content">
      <section aria-labelledby="home-title" className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{copy.home.kicker}</p>
          <h1 id="home-title">{copy.home.title}<span>{copy.home.accent}</span></h1>
          <p className="hero-lead">{locale === "en"
            ? "One OpenAI-compatible endpoint for text, vision, image, speech, and retrieval — live now, pay per use."
            : "單一 OpenAI 相容端點，涵蓋文字、視覺、圖像、語音與檢索 — 已上線，按量計費。"}</p>
          <p className="hero-launch-status" role="status">{copy.home.launchStatus}</p>
          <div className="hero-actions">
            <a className="primary-link" href="/pricing">{text.compareRates}</a>
            <a className="text-link" href="/contact">{text.deploymentReview} <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </section>

      <section aria-label={text.facts} className="proof-strip">
        <div className="proof-item"><strong>{catalogCount}</strong><span>{text.catalogEntries}</span></div>
        <div className="proof-item"><strong>{maxContext}K</strong><span>{text.maximumContext}</span></div>
        <div className="proof-item"><strong>${startingRate.toFixed(2)}</strong><span>{text.startingRate}</span></div>
      </section>

      <section aria-labelledby="featured-models-title" className="home-section model-marketplace">
        <div className="section-intro">
          <p className="eyebrow">{copy.models.kicker}</p>
          <h2 id="featured-models-title">{copy.home.modelsTitle}</h2>
          <p>{copy.home.modelsLead}</p>
        </div>
        <div className="model-list">
          {MODEL_CATALOG.map((model, index) => (
            <article aria-label={model.name} className={`model-row model-row-${model.id}`} key={model.id}>
              <span aria-hidden="true" className="model-rail" />
              <div className="model-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="model-identity"><h3>{model.name}</h3><p>{model.servingRole[locale]}</p></div>
              <dl className="model-facts">
                <div><dt>{copy.models.context}</dt><dd>{model.context}</dd></div>
                <div><dt>{copy.models.maxOutput}</dt><dd>{model.maxOutput}</dd></div>
                <div><dt>{text.price}</dt><dd>${model.inputPerMillion.toFixed(2)} {copy.shared.perMillionInput}</dd><dd>${model.outputPerMillion.toFixed(2)} {copy.shared.perMillionOutput}</dd></div>
                <div><dt>{text.provenance}</dt><dd>{model.provenance.label[locale]}</dd></div>
                <div><dt>{text.release}</dt><dd>{model.available ? copy.models.available : copy.models.unavailable}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section aria-label={text.access} className="home-section home-access-section">
        <div className="section-intro section-intro-split"><div><p className="eyebrow">{copy.home.stepsKicker}</p><h2>{copy.home.stepsTitle}</h2></div><p>{text.accessLead}</p></div>
        <ol className="home-access-steps">
          {[[text.compare, copy.home.steps.discover], [text.estimate, copy.home.steps.review], [text.request, copy.home.steps.request]].map(([title, detail]) => (
            <li key={title}><h3>{title}</h3><p>{detail}</p></li>
          ))}
        </ol>
        <div aria-label={text.rateAccess} className="home-rate-access" role="region">
          <p className="eyebrow">{copy.pricing.kicker}</p>
          <p>{text.rateLead}</p>
          <p className="home-rate-value">${startingRate.toFixed(2)} {copy.shared.perMillionInput}</p>
          <button className="credit-button" onClick={requestLaunchAccess} type="button">{copy.nav.getTokens}</button>
          <p className="showcase-note">{copy.pricing.demoNotice}</p>
        </div>
        <div className="home-console-preview"><ConsoleView compact /></div>
      </section>

      <section aria-label={text.enterprise} className="home-section home-enterprise-bridge">
        <div className="section-intro section-intro-split"><div><p className="eyebrow">{trust.infrastructure.kicker}</p><h2>{text.enterprise}</h2></div><p>{text.enterpriseLead}</p></div>
        <p className="home-enterprise-capacity"><strong>{company.capacity.initialMw}</strong>{company.home.context}</p>
        <a className="text-link" href="/infrastructure">{text.infrastructure}</a>
        <a className="primary-link" href="/contact">{text.deploymentReview}</a>
      </section>

      <section aria-label={text.trust} className="home-section home-trust-strip">
        <p className="eyebrow">{trust.status.kicker}</p>
        <h2>{text.trust}</h2>
        <p>{text.trustLead}</p>
        <div><a href="/trust">{text.trustBoundary}</a><a href="/status">{text.serviceStatus}</a></div>
      </section>

      <AudiencePaths />
    </main>
  );
}
