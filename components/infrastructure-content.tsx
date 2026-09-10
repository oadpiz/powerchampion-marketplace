"use client";

import { useState } from "react";
import { SERVICE_CONTENT } from "../lib/service-content";
import { COMPANY_CONTENT, COMPANY_SOURCES } from "../lib/company";
import { SERVICE_READINESS, TRUST_CONTENT, deriveGatewayReadiness, isReady } from "../lib/trust";
import type { GatewayStatus } from "../lib/gateway-status";
import { useLocale } from "./locale-provider";

const stages = [
  { id: "capacity", state: "counterparty-context" },
  { id: "serving", state: "live" },
  { id: "delivery", state: "live" },
] as const;

type Props = {
  gateway: GatewayStatus | null;
};

export function InfrastructureContent({ gateway }: Props) {
  const { locale } = useLocale();
  const company = COMPANY_CONTENT[locale];
  const service = SERVICE_CONTENT[locale];
  const infrastructure = service.infrastructure;
  const platformRows = [service.nextGenerationPlatform, ...company.gpuPlatforms.rows];
  const [workloadIndex, setWorkloadIndex] = useState(0);
  const selectedWorkload = infrastructure.workloads[workloadIndex];
  const trust = TRUST_CONTENT[locale];
  const source = COMPANY_SOURCES[0];
  const sourceCopy = source.copy[locale];
  const servingState = deriveGatewayReadiness(gateway).inference;
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
    <main className="enterprise-review-page service-page infrastructure-service-page" id="main-content">
      <section aria-labelledby="infrastructure-title" className="enterprise-review-hero service-page-hero">
        <div>
          <p className="eyebrow">{infrastructure.kicker}</p>
          <h1 id="infrastructure-title">{infrastructure.title}</h1>
          <p className="service-hero-lead">{infrastructure.lead}</p>
          <div className="service-page-actions">
            <a href="/contact">{locale === "en" ? "Discuss infrastructure" : "討論基礎設施"}<span aria-hidden="true">↗</span></a>
            <a href="#infrastructure-workloads-title">{locale === "en" ? "Explore your workload" : "探索工作負載"}<span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="service-hero-aside infrastructure-service-map">
          <p className="service-audience">{locale === "en" ? "Deployment paths" : "部署路徑"}</p>
          {company.deploymentModels.items.map((item, index) => <div key={item.title}>
            <span className="service-item-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <p>{item.title}</p>
          </div>)}
          <a href="/docs">{locale === "en" ? "Building with an API? Start here." : "透過 API 開發？從這裡開始。"}<span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <section aria-labelledby="infrastructure-platforms-title" className="service-editorial-section">
        <div className="service-section-heading">
          <p className="eyebrow">{locale === "en" ? "01 / GPU platforms" : "01 / GPU 平台"}</p>
          <div><h2 id="infrastructure-platforms-title">{infrastructure.overviewTitle}</h2><p>{infrastructure.overviewLead}</p></div>
        </div>
        <div className="service-platform-table-wrap">
          <table className="service-platform-table">
            <thead><tr>
              <th scope="col">{company.gpuPlatforms.headers.category}</th>
              <th scope="col">{company.gpuPlatforms.headers.platform}</th>
              <th scope="col">{company.gpuPlatforms.headers.useCase}</th>
            </tr></thead>
            <tbody>{platformRows.map((row) => <tr key={row.platform}>
              <th scope="row">{row.category}</th><td>{row.platform}</td><td>{row.useCase}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="service-inline-note">{infrastructure.overviewNote}</p>
      </section>

      <section aria-labelledby="infrastructure-workloads-title" className="service-editorial-section">
        <div className="service-section-heading">
          <p className="eyebrow">{locale === "en" ? "02 / Workload planning" : "02 / 工作負載規劃"}</p>
          <div><h2 id="infrastructure-workloads-title">{infrastructure.workloadTitle}</h2><p>{infrastructure.workloadHint}</p></div>
        </div>
        <div className="infrastructure-workload-planner">
          <div className="infrastructure-workload-options" role="group" aria-labelledby="infrastructure-workloads-title">
            {infrastructure.workloads.map((workload, index) => <button
              aria-controls="infrastructure-workload-details"
              aria-pressed={workloadIndex === index}
              key={index}
              onClick={() => setWorkloadIndex(index)}
              type="button"
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{workload.title}<span aria-hidden="true">↗</span>
            </button>)}
          </div>
          <div aria-live="polite" className="infrastructure-workload-details" id="infrastructure-workload-details">
            <h3>{selectedWorkload.title}</h3>
            <p>{selectedWorkload.description}</p>
            <h4>{infrastructure.questionsTitle}</h4>
            <ul>{selectedWorkload.questions.map((question) => <li key={question}>{question}</li>)}</ul>
            <a href="/contact">{locale === "en" ? "Discuss this workload" : "討論此工作負載"}<span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </section>

      <section aria-labelledby="infrastructure-process-title" className="service-editorial-section">
        <div className="service-section-heading">
          <p className="eyebrow">{locale === "en" ? "03 / Deployment process" : "03 / 部署流程"}</p>
          <div><h2 id="infrastructure-process-title">{infrastructure.processTitle}</h2><p>{infrastructure.processLead}</p></div>
        </div>
        <ol className="service-process-list">
          {infrastructure.process.map((step, index) => <li key={step.title}>
            <span className="service-item-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <h3>{step.title}</h3><p>{step.description}</p>
          </li>)}
        </ol>
      </section>

      <section aria-labelledby="deployment-inputs-title" className="enterprise-inputs service-editorial-section service-deployment-inputs">
        <div className="service-section-heading">
          <p className="eyebrow">{locale === "en" ? "04 / Your project brief" : "04 / 專案需求"}</p>
          <div><h2 id="deployment-inputs-title">{trust.infrastructure.checklistTitle}</h2><p>{infrastructure.inputLead}</p></div>
        </div>
        <dl className="service-input-details">
          {trust.infrastructure.checklist.map((item, index) => <div key={item}>
            <dt>{item}</dt><dd>{infrastructure.inputs[index]}</dd>
          </div>)}
        </dl>
        <a className="enterprise-review-link" href="/contact">{trust.deploymentReview}</a>
      </section>

      <section aria-labelledby="capacity-context-title" className="enterprise-capacity-context service-public-record">
        <h2 id="capacity-context-title">{company.capacity.title}</h2>
        <p className="service-evidence-lead">{infrastructure.evidenceLead}</p>
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

      <nav className="company-related-links" aria-label={locale === "en" ? "Infrastructure sources and service status" : "基礎設施來源與服務狀態"}>
        <a href="/company">{locale === "en" ? "Company sources & disclosures" : "公司資料來源與揭露"}</a>
        <a href="/status">{locale === "en" ? "Check current service status" : "查看目前服務狀態"}</a>
      </nav>
    </main>
  );
}
