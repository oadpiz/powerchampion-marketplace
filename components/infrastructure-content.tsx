"use client";

import { COMPANY_CONTENT, COMPANY_SOURCES } from "../lib/company";
import { SERVICE_READINESS, TRUST_CONTENT, isReady } from "../lib/trust";
import { useLocale } from "./locale-provider";

const stages = [
  { id: "capacity", state: "counterparty-context" },
  { id: "serving", state: "live" },
  { id: "delivery", state: "live" },
] as const;

export function InfrastructureContent() {
  const { locale } = useLocale();
  const company = COMPANY_CONTENT[locale];
  const trust = TRUST_CONTENT[locale];
  const source = COMPANY_SOURCES[0];
  const sourceCopy = source.copy[locale];
  const servingState = SERVICE_READINESS.inference;
  const deliveryState = SERVICE_READINESS.website;

  const stageCopy = {
    capacity: {
      title: company.capacity.title,
      body: trust.infrastructure.capacityStage,
      status: locale === "en" ? "Counterparty context" : "交易對手脈絡",
    },
    serving: {
      title: locale === "en" ? "Serving controls" : "服務控制",
      body: trust.infrastructure.servingStage,
      status: trust.status.states[servingState],
    },
    delivery: {
      title: locale === "en" ? "Delivery preview" : "交付預覽",
      body: trust.infrastructure.deliveryStage,
      status: trust.status.states[deliveryState],
    },
  } as const;

  return (
    <main className="enterprise-review-page" id="main-content">
      <div className="enterprise-review-hero">
        <p className="eyebrow">{trust.infrastructure.kicker}</p>
        <h1 id="infrastructure-title">{trust.infrastructure.title}</h1>
        <p>{trust.infrastructure.lead}</p>
      </div>

      <section aria-labelledby="capacity-context-title" className="enterprise-capacity-context">
        <h2 id="capacity-context-title">{company.capacity.title}</h2>
        <div className="enterprise-capacity-fact">
          <p>{company.capacity.initialLabel}</p>
          <strong>{company.capacity.initialMw}</strong>
          <p>{trust.infrastructure.capacityStage}</p>
          <a href={source.href} rel="noreferrer" target="_blank">{sourceCopy.kind}</a>
        </div>
        <p className="enterprise-qualification">{company.capacity.qualification}</p>
      </section>

      <section aria-labelledby="infrastructure-stages-title" className="enterprise-stages">
        <h2 id="infrastructure-stages-title">{locale === "en" ? "Review stages" : "審查階段"}</h2>
        <ol>
          {stages.map((stage) => {
            const detail = stageCopy[stage.id];
            const readiness = stage.id === "serving" ? servingState : stage.id === "delivery" ? deliveryState : undefined;

            return (
              <li data-ready={isReady(readiness)} data-stage-state={stage.state} key={stage.id}>
                <p>{detail.status}</p>
                <h3>{detail.title}</h3>
                <p>{detail.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="deployment-inputs-title" className="enterprise-inputs">
        <h2 id="deployment-inputs-title">{trust.infrastructure.checklistTitle}</h2>
        <ul>
          {trust.infrastructure.checklist.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <a className="enterprise-review-link" href="/contact">{trust.deploymentReview}</a>
      </section>
    </main>
  );
}
