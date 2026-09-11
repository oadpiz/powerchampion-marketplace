"use client";

import { useState } from "react";
import { MODEL_CATALOG } from "../lib/models";
import { CREDIT_PACKS, calculateUsageCost } from "../lib/pricing";
import { internationalPath } from "../lib/languages";
import {
  APPLICATION_METADATA,
  PLATFORM_STORY_COPY,
  type ApplicationId,
  type StoryLanguage,
} from "../lib/platform-story-copy";
import { useLocale } from "./locale-provider";
import { openLaunchAccess } from "./demo-checkout";

type StoryProps = { language?: StoryLanguage };

export function ApplicationExplorer({ language }: StoryProps = {}) {
  const { locale } = useLocale();
  const activeLanguage = language ?? (locale === "zh" ? "zh-Hant" : "en");
  const copy = PLATFORM_STORY_COPY[activeLanguage];
  const [activeId, setActiveId] = useState<ApplicationId>("assistants");
  const active = APPLICATION_METADATA.find((item) => item.id === activeId)!;
  const activeCopy = copy.applications[activeId];
  const modelPath = internationalPath(activeLanguage, "models");

  return (
    <section
      className="ps-applications"
      aria-labelledby="applications-title"
      lang={activeLanguage}
    >
      <div className="pc-frame pc-section">
        <div className="pc-section-heading">
          <div>
            <p className="pc-overline">
              <span className="pc-section-number">02 /</span>
              {copy.applicationIntro}
            </p>
            <h2 id="applications-title">
              {copy.applicationHeading[0]}
              <br />
              <em>{copy.applicationHeading[1]}</em>
            </h2>
          </div>
          <div className="pc-section-aside">
            <p>{copy.applicationAside}</p>
          </div>
        </div>
        <div className="ps-app-layout">
          <div
            className="ps-app-options"
            role="group"
            aria-label={copy.exploreApplications}
          >
            {APPLICATION_METADATA.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={activeId === item.id}
                aria-controls="application-detail"
                onClick={() => setActiveId(item.id)}
              >
                <span className="ps-option-number">0{i + 1}</span>
                <span>{copy.applications[item.id].label}</span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          <div
            className="ps-app-detail"
            id="application-detail"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="ps-app-copy">
              <p className="ps-kicker">{activeCopy.audience}</p>
              <h3>{activeCopy.title}</h3>
              <p>{activeCopy.description}</p>
            </div>
            <div className="ps-workflow">
              <div className="ps-workflow-end">
                <span>{copy.input}</span>
                <p>{activeCopy.input}</p>
              </div>
              <div className="ps-workflow-connector" aria-hidden="true">
                ↓
              </div>
              <div className="ps-workflow-core">
                <span aria-hidden="true">{active.symbol}</span>
                <div>
                  <strong>Power Champion</strong>
                  <small>{activeCopy.capability}</small>
                </div>
              </div>
              <div className="ps-workflow-connector" aria-hidden="true">
                ↓
              </div>
              <div className="ps-workflow-end">
                <span>{copy.output}</span>
                <p>{activeCopy.output}</p>
              </div>
            </div>
            <div className="ps-app-models">
              <span>{copy.exploreModels}</span>
              <div>
                {active.models.map((id) => (
                  <a
                    key={id}
                    href={`${modelPath}#${activeLanguage === "en" ? "" : "intl-"}${id}`}
                  >
                    {MODEL_CATALOG.find((model) => model.id === id)?.name}
                    <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
        <p className="ps-disclaimer">{copy.disclaimer}</p>
      </div>
    </section>
  );
}

export function ModelServiceDetails({ language }: StoryProps = {}) {
  const { locale } = useLocale();
  const activeLanguage = language ?? (locale === "zh" ? "zh-Hant" : "en");
  const copy = PLATFORM_STORY_COPY[activeLanguage];
  const starter = CREDIT_PACKS.find((pack) => pack.id === "starter")!;
  const [estimateId, setEstimateId] = useState("glm-5.2-fp8");
  const estimateModels = MODEL_CATALOG.filter(
    (model) => model.id === "glm-5.2-fp8" || model.id === "qwen3-vl-30b",
  );
  const model = estimateModels.find((item) => item.id === estimateId)!;
  const cost = calculateUsageCost(1_000_000, 250_000, model);

  return (
    <section
      className="pc-frame pc-section ps-commercial"
      aria-labelledby="model-service-title"
      lang={activeLanguage}
    >
      <div className="pc-section-heading">
        <div>
          <p className="pc-overline">
            <span className="pc-section-number">04 /</span>
            {copy.serviceIntro}
          </p>
          <h2 id="model-service-title">
            {copy.serviceHeading[0]}
            <br />
            <em>{copy.serviceHeading[1]}</em>
          </h2>
        </div>
        <div className="pc-section-aside">
          <p>{copy.serviceAside}</p>
          <a
            className="pc-link"
            href={internationalPath(activeLanguage, "pricing")}
          >
            {copy.pricingLink}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
      <div className="ps-service-layout">
        <div className="ps-inclusions">
          <p className="ps-kicker">{copy.inclusionsTitle}</p>
          {copy.inclusions.map(([title, detail], index) => (
            <article key={title}>
              <span className="ps-inclusion-number">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
            </article>
          ))}
          <div className="ps-service-links">
            <button
              type="button"
              className="pc-button"
              onClick={() => openLaunchAccess()}
            >
              {copy.requestAccess}
              <span aria-hidden="true">↗</span>
            </button>
            <a className="pc-link" href="/console">
              {copy.checkBalance}
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
        <div className="ps-credit-example">
          <div className="ps-example-header">
            <span>{copy.illustration}</span>
            <span>USD</span>
          </div>
          <div className="ps-starting-credit">
            <span>{copy.starterPack}</span>
            <strong>
              <small>$</small>
              {starter.price}
              <span>.00</span>
            </strong>
            <p>
              {copy.creditAmount.replace("{amount}", starter.credit.toFixed(2))}
            </p>
          </div>
          <label className="ps-estimate-select">
            {copy.selectModel}
            <select
              value={estimateId}
              onChange={(event) => setEstimateId(event.target.value)}
            >
              {estimateModels.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <dl className="ps-cost-lines">
            <div>
              <dt>{copy.inputTokens}</dt>
              <dd>${model.inputPerMillion.toFixed(2)}</dd>
            </div>
            <div>
              <dt>{copy.outputTokens}</dt>
              <dd>${(model.outputPerMillion * 0.25).toFixed(2)}</dd>
            </div>
            <div className="ps-cost-total">
              <dt>{copy.exampleCost}</dt>
              <dd aria-live="polite">${cost.toFixed(2)}</dd>
            </div>
          </dl>
          <p className="ps-example-note">{copy.exampleNote}</p>
        </div>
      </div>
      <div className="ps-getting-started">
        <p className="ps-kicker">{copy.gettingStarted}</p>
        <ol>
          {copy.steps.map(([title, detail], i) => (
            <li key={title}>
              <span>0{i + 1}</span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
