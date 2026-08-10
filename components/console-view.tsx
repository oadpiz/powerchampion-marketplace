"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { MODEL_USAGE, RECENT_REQUESTS } from "../lib/console-data";
import { openCheckout } from "./demo-checkout";
import { useLocale } from "./locale-provider";

type ConsoleViewProps = {
  compact?: boolean;
  empty?: boolean;
};

const weeklyUsage = [42, 61, 49, 76, 58, 91, 72];
const modelUsage = [
  { model: "Qwen", percent: 48, className: "qwen" },
  { model: "DeepSeek", percent: 31, className: "deepseek" },
  { model: "Llama", percent: 21, className: "llama" },
] as const;

const recentRequests = [
  ["pc/qwen-coder", "2.8K", "242 ms"],
  ["pc/deepseek-reasoning", "6.1K", "1.2 s"],
  ["pc/llama-general", "1.4K", "318 ms"],
] as const;

const DEMO_KEY = "pc_demo_••••••••••••7X4Q";

export function ConsoleView({ compact = false, empty = false }: ConsoleViewProps) {
  const { copy, locale } = useLocale();
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "unavailable" | null>(null);
  const usage = compact
    ? modelUsage.map(({ model, percent }) => ({ model, percent, tokens: null }))
    : MODEL_USAGE;
  const modelSplitLabel = compact
    ? copy.console.modelSplitLabel
    : locale === "en"
      ? "Model usage split: Qwen 48 percent, DeepSeek 32 percent, Llama 20 percent"
      : "模型用量分布：Qwen 48%、DeepSeek 32%、Llama 20%";

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
        <p><span className="status-dot" />{copy.console.demo}</p>
        <span>{copy.shared.illustrative}</span>
      </div>

      <div className="console-summary">
        <div className="balance-block">
          <p>{copy.console.balance}</p>
          <strong>$184.20</strong>
          {!compact && <button className="console-add-credit" onClick={() => openCheckout()} type="button">{copy.console.addCredit}</button>}
        </div>
        <div className="usage-block">
          <div className="usage-heading">
            <p>{copy.console.sevenDay}</p>
            <strong>{empty ? "0" : "18.7M"} <span>{copy.console.tokens}</span></strong>
          </div>
          {empty ? (
            <p className="empty-usage">{copy.console.noUsage}</p>
          ) : (
            <div aria-label={copy.console.usageChartLabel} className="usage-chart" role="img">
              {weeklyUsage.map((height, index) => (
                <span key={index} style={{ "--bar-height": `${height}%` } as CSSProperties} />
              ))}
            </div>
          )}
        </div>
      </div>

      {!empty && (
        <div aria-label={modelSplitLabel} className="model-usage" role="img">
          {usage.map((item) => (
            <div className="model-usage-row" key={item.model}>
              <span>{item.model}</span>
              <div className="model-usage-track">
                <span className={`model-usage-fill ${item.model.toLowerCase()}`} style={{ width: `${item.percent}%` }} />
              </div>
              <strong>{item.percent}%{item.tokens ? ` · ${item.tokens}` : ""}</strong>
            </div>
          ))}
        </div>
      )}

      {!compact && (
        <div className="console-details">
          <section aria-labelledby="recent-requests-title" className="recent-requests">
            <h3 id="recent-requests-title">{copy.console.recent}</h3>
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
            <h3 id="demo-key-title">{copy.console.apiKey}</h3>
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
