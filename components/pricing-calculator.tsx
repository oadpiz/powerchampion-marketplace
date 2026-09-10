"use client";

import { useState } from "react";
import type { ModelDefinition } from "../lib/models";
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
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function PricingCalculator({ models }: { models: ModelDefinition[] }) {
  const { copy, locale } = useLocale();
  const [modelId, setModelId] = useState(models[0].id);
  const [inputTokens, setInputTokens] = useState("0");
  const [outputTokens, setOutputTokens] = useState("0");
  const model = models.find((candidate) => candidate.id === modelId) ?? models[0];

  // Media models bill per image / per minute of audio, not per token —
  // a token-pair estimator would be meaningless for them.
  const isTokenBilled = model.billingUnit === "token";

  const inputAmount = parseTokenAmount(inputTokens);
  const outputAmount = parseTokenAmount(outputTokens);
  const isInvalid = inputAmount === null || outputAmount === null;
  const estimate = isInvalid
    ? null
    : calculateUsageCost(inputAmount, outputAmount, {
      inputPerMillion: model.inputPerMillion,
      outputPerMillion: model.outputPerMillion,
    });

  const mediaUnit = model.billingUnit === "audio-minute"
    ? (locale === "en" ? "minute of audio" : "分鐘音訊")
    : (locale === "en" ? "image" : "張圖片");
  const mediaPrice = currencyFormatter.format(model.unitPrice ?? 0);
  const mediaNote = locale === "en"
    ? `${model.name} is billed per ${mediaUnit} at ${mediaPrice} each — see the rates table below.`
    : `${model.name} 以每${mediaUnit}計費，單價 ${mediaPrice} — 見下方費率表。`;
  const tokenNote = locale === "en"
    ? "Estimate runs in your browser using the same live rates the meter bills from."
    : "估算在你的瀏覽器內執行，採用與計費表相同的即時費率。";

  return (
    <section aria-labelledby="calculator-title" className="pricing-calculator">
      <div className="pricing-block-heading">
        <p className="eyebrow">{copy.pricing.kicker}</p>
        <h2 id="calculator-title">{copy.pricing.calculator}</h2>
      </div>
      {isTokenBilled ? (
        <>
          <div className="calculator-fields">
            <label>
              <span>{copy.pricing.selectModel}</span>
              <select autoComplete="off" name="estimator-model" onChange={(event) => setModelId(event.target.value)} value={modelId}>
                {models.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{copy.pricing.inputTokens}</span>
              <input
                autoComplete="off"
                inputMode="numeric"
                min={0}
                name="input-tokens"
                onChange={(event) => setInputTokens(event.target.value)}
                spellCheck={false}
                step={1}
                type="number"
                value={inputTokens}
              />
            </label>
            <label>
              <span>{copy.pricing.outputTokens}</span>
              <input
                autoComplete="off"
                inputMode="numeric"
                min={0}
                name="output-tokens"
                onChange={(event) => setOutputTokens(event.target.value)}
                spellCheck={false}
                step={1}
                type="number"
                value={outputTokens}
              />
            </label>
          </div>
          {isInvalid ? (
            <p className="calculator-validation" role="alert">{copy.pricing.invalid}</p>
          ) : (
            <p aria-live="polite" className="calculator-estimate">
              <span>{copy.pricing.estimate}</span>
              <strong>{estimate === null ? "—" : currencyFormatter.format(estimate)}</strong>
            </p>
          )}
        </>
      ) : (
        <div className="calculator-fields">
          <label>
            <span>{copy.pricing.selectModel}</span>
            <select autoComplete="off" name="estimator-model" onChange={(event) => setModelId(event.target.value)} value={modelId}>
              {models.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p className="calculator-note">{isTokenBilled ? tokenNote : mediaNote}</p>
    </section>
  );
}
