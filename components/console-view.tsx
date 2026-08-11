"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { MODEL_USAGE, RECENT_REQUESTS, SEVEN_DAY_USAGE } from "../lib/console-data";
import { openCheckout } from "./demo-checkout";
import { useLocale } from "./locale-provider";

type ConsoleViewProps = {
  compact?: boolean;
  empty?: boolean;
};

const recentRequests = [
  ["pc/qwen-coder", "2.8K", "242 ms"],
  ["pc/deepseek-reasoning", "6.1K", "1.2 s"],
  ["pc/llama-general", "1.4K", "318 ms"],
] as const;

const DEMO_KEY = "pc_demo_••••••••••••7X4Q";

export function ConsoleView({ compact = false, empty = false }: ConsoleViewProps) {
  const { copy, locale } = useLocale();
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "unavailable" | null>(null);
  const Heading = compact ? "h3" : "h2";
  const totalTokens = SEVEN_DAY_USAGE.reduce((total, day) => total + day.tokensMillions, 0);
  const totalSpend = SEVEN_DAY_USAGE.reduce((total, day) => total + day.spend, 0);
  const maxTokens = Math.max(...SEVEN_DAY_USAGE.map((day) => day.tokensMillions));
  const spendFormatter = new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-Hant", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formattedSpend = spendFormatter.format(totalSpend);
  const dayLabels = locale === "en"
    ? { Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri", Sat: "Sat", Sun: "Sun" }
    : { Mon: "週一", Tue: "週二", Wed: "週三", Thu: "週四", Fri: "週五", Sat: "週六", Sun: "週日" };
  const dailyTrend = SEVEN_DAY_USAGE.map((day) => locale === "en"
    ? `${dayLabels[day.day]} ${day.tokensMillions.toFixed(1)}M tokens / ${spendFormatter.format(day.spend)}`
    : `${dayLabels[day.day]} ${day.tokensMillions.toFixed(1)}M 詞元 / ${spendFormatter.format(day.spend)}`
  ).join(locale === "en" ? ", " : "、");
  const modelSplitLabel = locale === "en"
    ? `Model usage split: ${MODEL_USAGE.map((item) => `${item.model} ${item.percent} percent`).join(", ")}`
    : `模型用量分布：${MODEL_USAGE.map((item) => `${item.model} ${item.percent}%`).join("、")}`;
  const usageChartLabel = locale === "en"
    ? `Seven-day illustrative usage: ${totalTokens.toFixed(1)} million tokens; illustrative spend ${formattedSpend}. Daily trend: ${dailyTrend}`
    : `七日展示用量：${totalTokens.toFixed(1)}M 詞元；展示支出 ${formattedSpend}。每日趨勢：${dailyTrend}`;

  async function copyDemoKey() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText("pc_demo_YOUR_KEY");
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("unavailable");
    }
  }

  return (
    <div className={`console-view${compact ? " console-view-compact" : ""}`}>
      <div className="console-topline">
        <p><span className="status-dot" />{copy.console.previewLabel}</p>
        <span>{copy.console.previewDescription}</span>
      </div>

      <div className="console-summary">
        <div className="balance-block">
          <Heading>{copy.console.balance}</Heading>
          <strong>$184.20</strong>
          {!compact && <button className="console-add-credit" onClick={() => openCheckout()} type="button">{copy.nav.getTokens}</button>}
        </div>
        <div className="usage-block">
          <div className="usage-heading">
            <Heading>{copy.console.sevenDay}</Heading>
            <strong>{empty ? "0" : `${totalTokens.toFixed(1)}M`} <span>{copy.console.tokens}</span></strong>
          </div>
          {!empty && <p className="spend-summary">{copy.console.illustrativeSpend}{locale === "en" ? ": " : "："}{formattedSpend}</p>}
          {empty ? (
            <p className="empty-usage">{copy.console.noUsage}</p>
          ) : (
            <div aria-label={usageChartLabel} className="usage-chart" role="img">
              {SEVEN_DAY_USAGE.map((day) => (
                <span aria-hidden="true" key={day.day} style={{ "--bar-height": `${(day.tokensMillions / maxTokens) * 100}%` } as CSSProperties} />
              ))}
            </div>
          )}
        </div>
      </div>

      {!empty && (
        <section className="model-usage-section">
          <Heading className="console-subheading">{copy.console.modelSplit}</Heading>
          <div aria-label={modelSplitLabel} className="model-usage" role="img">
            {MODEL_USAGE.map((item) => (
              <div className="model-usage-row" key={item.model}>
                <span>{item.model}</span>
                <div className="model-usage-track">
                  <span className={`model-usage-fill ${item.model.toLowerCase()}`} style={{ width: `${item.percent}%` }} />
                </div>
                <strong>{item.percent}%{!compact ? ` · ${item.tokens}` : ""}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {!compact && (
        <div className="console-details">
          <section aria-labelledby="recent-requests-title" className="recent-requests">
            <h2 id="recent-requests-title">{copy.console.recent}</h2>
            {empty ? (
              <p className="empty-usage">{copy.console.noRecent}</p>
            ) : (
              <div className="request-list">
                {compact ? recentRequests.map(([model, tokens, latency]) => (
                  <div className="request-row" key={model}>
                    <code>{model}</code>
                    <span>{tokens} {copy.console.tokens}</span>
                    <span>{latency}</span>
                  </div>
                )) : RECENT_REQUESTS.map((request) => (
                  <div className="request-row" key={request.id}>
                    <code>{request.id}</code>
                    <span>{request.model} · {request.tokens} {copy.console.tokens}</span>
                    <span>{request.cost} · {locale === "en" ? request.status : "完成"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section aria-labelledby="demo-key-title" className="demo-key">
            <h2 id="demo-key-title">{copy.console.apiKey}</h2>
            <code>{DEMO_KEY}</code>
            <div className="demo-key-actions">
              <button onClick={copyDemoKey} type="button">{copy.console.copy}</button>
              <span aria-live="polite" role="status">
                {copyFeedback === "copied" ? copy.console.copied : copyFeedback === "unavailable" ? copy.shared.copyUnavailable : ""}
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
