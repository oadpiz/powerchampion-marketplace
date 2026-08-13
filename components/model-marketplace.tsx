"use client";

import { useState } from "react";
import {
  MODEL_CATALOG,
  filterModels,
  type ModelCategory,
  type ModelDefinition,
} from "../lib/models";
import { useLocale } from "./locale-provider";

const categories: ModelCategory[] = [
  "all",
  "coding",
  "reasoning",
  "general",
  "multilingual",
];

function formatRate(rate: number) {
  return `$${rate.toFixed(2)}`;
}

export function ModelMarketplace() {
  const { copy, locale } = useLocale();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ModelCategory>("all");
  const [expandedId, setExpandedId] = useState<ModelDefinition["id"] | null>(null);
  const models = filterModels(MODEL_CATALOG, query, category);
  const categoryLabels: Record<ModelCategory, string> = {
    all: copy.models.all,
    coding: copy.models.coding,
    reasoning: copy.models.reasoning,
    general: copy.models.general,
    multilingual: copy.models.multilingual,
  };
  const speedLabels: Record<ModelDefinition["speed"], string> = {
    Fast: copy.models.fast,
    Balanced: copy.models.balanced,
    Deep: copy.models.deep,
  };
  const decisionLabels = {
    maxOutput: locale === "en" ? "Max output" : copy.models.maxOutput,
    region: locale === "en" ? "Region" : copy.models.region,
  };
  const unavailablePublication = locale === "en" ? "not published" : "尚未發布";
  const provenanceStatus = (model: ModelDefinition) => (
    locale === "en" ? model.provenance.label.en.toLowerCase() : model.provenance.label[locale]
  );

  const clearFilters = () => {
    setQuery("");
    setCategory("all");
  };

  return (
    <section aria-label={copy.models.title} className="marketplace-panel">
      <div className="marketplace-controls">
        <label className="marketplace-search">
          <span>{copy.models.search}</span>
          <input
            aria-label={copy.models.search}
            autoComplete="off"
            name="model-query"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`${copy.models.search}…`}
            spellCheck={false}
            type="search"
            value={query}
          />
        </label>
        <div aria-label={copy.models.kicker} className="marketplace-categories" role="group">
          {categories.map((option) => (
            <button
              aria-pressed={category === option}
              key={option}
              onClick={() => setCategory(option)}
              type="button"
            >
              {categoryLabels[option]}
            </button>
          ))}
        </div>
      </div>

      {models.length === 0 ? (
        <div className="marketplace-empty" role="status">
          <p>{copy.models.noResults}</p>
          <button onClick={clearFilters} type="button">{copy.models.clearFilters}</button>
        </div>
      ) : (
        <div className="marketplace-list">
          {models.map((model, index) => {
            const isExpanded = expandedId === model.id;
            const detailsId = `model-details-${model.id}`;

            return (
              <article aria-labelledby={`model-name-${model.id}`} className={`marketplace-row marketplace-row-${model.id}`} key={model.id}>
                <span aria-hidden="true" className="marketplace-rail" />
                <div className="marketplace-index">{String(index + 1).padStart(2, "0")}</div>
                <div className="marketplace-identity">
                  <div className="marketplace-name-line">
                    <h2 id={`model-name-${model.id}`}>{model.name}</h2>
                    <span>{categoryLabels[model.categories[0]]}</span>
                  </div>
                  <p className="marketplace-tagline">{model.servingRole[locale]}</p>
                </div>
                <dl className="marketplace-summary-fact">
                  <dt>{copy.models.context}</dt>
                  <dd>{model.context}</dd>
                </dl>
                <dl className="marketplace-summary-fact">
                  <dt>{copy.models.input}</dt>
                  <dd>{formatRate(model.inputPerMillion)} <span className="marketplace-rate-unit">{copy.shared.perMillionInput}</span></dd>
                </dl>
                <dl className="marketplace-summary-fact">
                  <dt>{copy.models.output}</dt>
                  <dd>{formatRate(model.outputPerMillion)} <span className="marketplace-rate-unit">{copy.shared.perMillionOutput}</span></dd>
                </dl>
                <button
                  aria-controls={detailsId}
                  aria-expanded={isExpanded}
                  aria-label={model.name}
                  className="marketplace-expand"
                  onClick={() => setExpandedId(isExpanded ? null : model.id)}
                  type="button"
                >
                  <span aria-hidden="true">{isExpanded ? "−" : "+"}</span>
                </button>
                <div aria-label={`${model.name} ${copy.models.details}`} className="marketplace-details" hidden={!isExpanded} id={detailsId} role="region">
                  <p className="marketplace-mobile-tagline">{model.tagline[locale]}</p>
                  <dl>
                    <div>
                      <dt>{copy.models.modelId}</dt>
                      <dd><code translate="no">{model.modelId}</code></dd>
                    </div>
                    <div>
                      <dt>{copy.models.speed}</dt>
                      <dd>{speedLabels[model.speed]}</dd>
                    </div>
                    {isExpanded && <>
                      <div>
                        <dt>{decisionLabels.maxOutput}</dt>
                        <dd>{model.maxOutput}</dd>
                      </div>
                      <div>
                        <dt>{copy.models.tools}</dt>
                        <dd>{model.features.tools ? copy.models.enabled : unavailablePublication}</dd>
                      </div>
                      <div>
                        <dt>{copy.models.structuredOutput}</dt>
                        <dd>{model.features.structuredOutput ? copy.models.enabled : unavailablePublication}</dd>
                      </div>
                      <div>
                        <dt>{copy.models.reasoningCapability}</dt>
                        <dd>{model.features.reasoning ? copy.models.enabled : unavailablePublication}</dd>
                      </div>
                      <div>
                        <dt>{copy.models.streaming}</dt>
                        <dd>{model.features.streaming ? copy.models.enabled : unavailablePublication}</dd>
                      </div>
                      <div>
                        <dt>{copy.models.provenance} </dt>
                        <dd>
                          {model.provenance.licenseHref ? (
                            <a href={model.provenance.licenseHref}>{provenanceStatus(model)}</a>
                          ) : provenanceStatus(model)}
                        </dd>
                      </div>
                      <div>
                        <dt>{copy.models.servingRole}</dt>
                        <dd>{model.servingRole[locale]}</dd>
                      </div>
                      <div>
                        <dt>{decisionLabels.region} </dt>
                        <dd>{model.region ?? unavailablePublication}</dd>
                      </div>
                      <div>
                        <dt>{copy.models.availability}</dt>
                        <dd className={model.available ? "marketplace-available" : "marketplace-unavailable"}>
                          {model.available ? copy.models.available : copy.models.unavailable}
                        </dd>
                      </div>
                    </>}
                  </dl>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
