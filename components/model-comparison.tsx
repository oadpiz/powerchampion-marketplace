"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { MODEL_CATALOG } from "../lib/models";
import { billingKind, estimateModelCost } from "../lib/model-comparison";
import { useLocale } from "./locale-provider";

function initialSelection(query: string | null) {
  const valid = [...new Set(query?.split(","))]
    .filter((id) => MODEL_CATALOG.some((model) => model.id === id))
    .slice(0, 3);
  return valid.length
    ? ([...valid, ...Array(3 - valid.length).fill("")] as string[])
    : ["glm-5.2-fp8", "qwen3-vl-30b", ""];
}

export function ModelComparison() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const searchParams = useSearchParams();
  const [ids, setIds] = useState(() =>
    initialSelection(searchParams.get("models")),
  );
  const [amounts, setAmounts] = useState({
    input: "1000000",
    output: "250000",
    images: "100",
    minutes: "60",
  });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const selected = ids
    .filter(Boolean)
    .map((id) => MODEL_CATALOG.find((model) => model.id === id)!);
  const usage = Object.fromEntries(
    Object.entries(amounts).map(([key, value]) => [
      key,
      value.trim() ? Number(value) : NaN,
    ]),
  ) as Record<keyof typeof amounts, number>;
  const kinds = new Set(selected.map(billingKind));
  const fields = [
    {
      id: "input",
      label: zh ? "輸入 Token" : "Input tokens",
      show: kinds.has("tokens"),
    },
    {
      id: "output",
      label: zh ? "輸出 Token" : "Output tokens",
      show: kinds.has("tokens"),
    },
    {
      id: "images",
      label: zh ? "圖片張數" : "Number of images",
      show: kinds.has("image"),
    },
    {
      id: "minutes",
      label: zh ? "音訊分鐘" : "Audio minutes",
      show: kinds.has("audio"),
    },
  ] as const;
  async function shareComparison() {
    const url = new URL("/compare", window.location.origin);
    url.searchParams.set("models", ids.filter(Boolean).join(","));
    try {
      await navigator.clipboard.writeText(url.href);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  const unit = (kind: string) =>
    kind === "image"
      ? zh
        ? "每張圖片"
        : "per image"
      : kind === "audio"
        ? zh
          ? "每分鐘音訊"
          : "per audio minute"
        : zh
          ? "每百萬輸入 Token"
          : "per 1M input tokens";

  return (
    <main id="main-content" className="platform-page comparison-page">
      <div className="platform-page-heading">
        <div>
          <p className="platform-eyebrow">
            {zh ? "模型選擇工具" : "MODEL SELECTION TOOLS"}
          </p>
          <h1>{zh ? "找到適合的模型。" : "Find the right fit."}</h1>
          <p>
            {zh
              ? "並排比較能力與費率，再用你的預估用量試算。"
              : "Compare capabilities and rates, then estimate costs for your own workload."}
          </p>
        </div>
        <button
          className="platform-secondary-button"
          type="button"
          disabled={!selected.length}
          onClick={shareComparison}
        >
          {copied
            ? zh
              ? "已複製模型組合連結 ✓"
              : "Model selection link copied ✓"
            : zh
              ? "複製模型組合連結"
              : "Copy model selection link"}
        </button>
      </div>
      {copyError && (
        <p role="status">
          {zh
            ? "無法複製，請手動分享目前選擇的模型名稱。"
            : "Copy unavailable. Share the selected model names manually."}
        </p>
      )}
      <div className="comparison-selectors">
        {ids.map((id, index) => (
          <label key={index}>
            <span>{zh ? `模型 ${index + 1}` : `Model ${index + 1}`}</span>
            <select
              aria-label={zh ? `模型 ${index + 1}` : `Model ${index + 1}`}
              value={id}
              onChange={(event) => {
                setIds((current) =>
                  current.map((value, i) =>
                    i === index ? event.target.value : value,
                  ),
                );
                setCopied(false);
              }}
            >
              <option value="">{zh ? "選擇模型" : "Choose a model"}</option>
              {MODEL_CATALOG.map((model) => (
                <option
                  key={model.id}
                  value={model.id}
                  disabled={ids.includes(model.id) && id !== model.id}
                >
                  {model.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {selected.length ? (
        <>
          <section
            className="comparison-workload"
            aria-labelledby="workload-title"
          >
            <div>
              <h2 id="workload-title">
                {zh ? "你的預估用量" : "Your estimated workload"}
              </h2>
              <p>
                {zh
                  ? "依各模型的計費單位計算；不同能力的模型不代表可互相替代。"
                  : "Calculated in each model’s billing unit. Models with different capabilities are not interchangeable."}
              </p>
            </div>
            <div className="comparison-inputs">
              {fields
                .filter((field) => field.show)
                .map((field) => (
                  <label key={field.id}>
                    <span>{field.label}</span>
                    <input
                      type="number"
                      min="0"
                      step={field.id === "minutes" ? "any" : "1"}
                      value={amounts[field.id]}
                      onChange={(event) =>
                        setAmounts((value) => ({
                          ...value,
                          [field.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
            </div>
          </section>
          <div
            className="comparison-scroll"
            role="region"
            aria-label={zh ? "模型比較表" : "Model comparison table"}
            // Keyboard users can scroll wide comparison tables.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
          >
            <table className="comparison-table">
              <thead>
                <tr>
                  <th scope="col">{zh ? "模型與費用" : "Model & cost"}</th>
                  {selected.map((model) => (
                    <th scope="col" key={model.id}>
                      <a href={`/models/${model.id}`}>
                        {model.name} <span aria-hidden="true">↗</span>
                      </a>
                      <small>{model.servingRole[locale]}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="comparison-estimate">
                  <th scope="row">
                    {zh ? "預估費用" : "Estimated cost"}
                    <small>USD</small>
                  </th>
                  {selected.map((model) => {
                    const cost = estimateModelCost(model, usage);
                    return (
                      <td key={model.id} aria-live="polite">
                        {cost === null ? (
                          <span className="comparison-invalid">
                            {zh ? "請輸入有效用量" : "Enter valid usage"}
                          </span>
                        ) : (
                          <strong>
                            $
                            {cost.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 4,
                            })}
                          </strong>
                        )}
                        <small>
                          {billingKind(model) === "image"
                            ? zh
                              ? "依圖片張數"
                              : "Based on image count"
                            : billingKind(model) === "audio"
                              ? zh
                                ? "依音訊分鐘"
                                : "Based on audio minutes"
                              : zh
                                ? "依輸入與輸出 Token"
                                : "Based on input & output tokens"}
                        </small>
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">
                    {zh ? "輸入／單位費率" : "Input / unit rate"}
                  </th>
                  {selected.map((model) => (
                    <td key={model.id}>
                      ${model.inputPerMillion.toFixed(2)}
                      <small>{unit(billingKind(model))}</small>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{zh ? "輸出費率" : "Output rate"}</th>
                  {selected.map((model) => (
                    <td key={model.id}>
                      {model.outputPerMillion > 0 ? (
                        <>
                          ${model.outputPerMillion.toFixed(2)}
                          <small>
                            {zh ? "每百萬輸出 Token" : "per 1M output tokens"}
                          </small>
                        </>
                      ) : zh ? (
                        "無獨立輸出費率"
                      ) : (
                        "No separate output rate"
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{zh ? "上下文長度" : "Context window"}</th>
                  {selected.map((model) => (
                    <td key={model.id}>{model.context}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{zh ? "輸出上限" : "Maximum output"}</th>
                  {selected.map((model) => (
                    <td key={model.id}>{model.maxOutput}</td>
                  ))}
                </tr>
                {(
                  [
                    ["streaming", zh ? "串流回應" : "Streaming"],
                    ["tools", zh ? "工具呼叫" : "Tool calling"],
                    [
                      "structuredOutput",
                      zh ? "結構化輸出" : "Structured output",
                    ],
                  ] as const
                ).map(([feature, label]) => (
                  <tr key={feature}>
                    <th scope="row">{label}</th>
                    {selected.map((model) => (
                      <td key={model.id}>
                        {model.features[feature] ? (
                          <span className="comparison-feature">
                            ✓ {zh ? "支援" : "Supported"}
                          </span>
                        ) : (
                          <span className="comparison-unavailable">
                            {zh ? "未列為支援" : "Not listed"}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row">{zh ? "開始使用" : "Get started"}</th>
                  {selected.map((model) => (
                    <td key={model.id}>
                      <a
                        className="platform-text-link"
                        href={`/integrations?model=${model.id}`}
                      >
                        {zh ? "設定串接" : "Configure integration"} ↗
                      </a>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="platform-note">
            {zh
              ? "依模型目錄已刊登的費率與規格計算，並非效能實測或即時帳單。模型可用性請見服務狀態。"
              : "Based on published catalog rates and specifications, not performance benchmarks or a live bill. See service status for model availability."}{" "}
            <a href="/status">{zh ? "查看狀態 ↗" : "Check status ↗"}</a>
          </p>
        </>
      ) : (
        <div className="platform-empty-state">
          <span aria-hidden="true">⇄</span>
          <h2>{zh ? "選擇模型開始比較" : "Choose models to compare"}</h2>
          <p>
            {zh ? "可選擇最多三個模型。" : "Select up to three models above."}
          </p>
        </div>
      )}
    </main>
  );
}
