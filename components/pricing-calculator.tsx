"use client";

import { useState } from "react";
import { MODEL_CATALOG } from "../lib/models";
import { calculateUsageCost } from "../lib/pricing";
import { useLocale } from "./locale-provider";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function parseTokenAmount(value: string) {
  if (!value.trim()) {
    return null;
  }
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function PricingCalculator() {
  const { copy, locale } = useLocale();
  const [modelId, setModelId] = useState(MODEL_CATALOG[0].id);
  const [inputTokens, setInputTokens] = useState("0");
  const [outputTokens, setOutputTokens] = useState("0");
  const model = MODEL_CATALOG.find((candidate) => candidate.id === modelId) ?? MODEL_CATALOG[0];
  const inputAmount = parseTokenAmount(inputTokens);
  const outputAmount = parseTokenAmount(outputTokens);
  const isInvalid = inputAmount === null || outputAmount === null;
  const estimate = isInvalid
    ? null
    : calculateUsageCost(inputAmount, outputAmount, {
      inputPerMillion: model.inputPerMillion,
      outputPerMillion: model.outputPerMillion,
    });

  return (
    <section aria-labelledby="calculator-title" className="pricing-calculator">
      <div className="pricing-block-heading">
        <p className="eyebrow">{copy.pricing.kicker}</p>
        <h2 id="calculator-title">{copy.pricing.calculator}</h2>
      </div>
      <div className="calculator-fields">
        <label>
          <span>{copy.pricing.selectModel}</span>
          <select autoComplete="off" name="estimator-model" onChange={(event) => setModelId(event.target.value)} value={modelId}>
            {MODEL_CATALOG.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{copy.pricing.inputTokens}</span>
          <input
            autoComplete="off"
            inputMode="numeric"
            name="input-tokens"
            onChange={(event) => setInputTokens(event.target.value)}
            spellCheck={false}
            type="text"
            value={inputTokens}
          />
        </label>
        <label>
          <span>{copy.pricing.outputTokens}</span>
          <input
            autoComplete="off"
            inputMode="numeric"
            name="output-tokens"
            onChange={(event) => setOutputTokens(event.target.value)}
            spellCheck={false}
            type="text"
            value={outputTokens}
          />
        </label>
      </div>
      {isInvalid ? (
        <p className="calculator-validation" role="alert">{copy.pricing.invalid}</p>
      ) : (
        <p aria-live="polite" className="calculator-estimate">
          <span>{copy.pricing.estimate}</span>
          <strong>{currencyFormatter.format(estimate)}</strong>
        </p>
      )}
      <p className="calculator-note">{locale === "en" ? "This browser-only estimate uses illustrative model rates." : "此瀏覽器內估算使用展示模型費率。"}</p>
    </section>
  );
}
