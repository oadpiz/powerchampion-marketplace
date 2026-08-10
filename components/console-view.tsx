"use client";

import type { CSSProperties } from "react";
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

export function ConsoleView({ compact = false, empty = false }: ConsoleViewProps) {
  const { copy } = useLocale();

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
        </div>
        <div className="usage-block">
          <div className="usage-heading">
            <p>{copy.console.sevenDay}</p>
            <strong>{empty ? "0" : "18.7M"} <span>tokens</span></strong>
          </div>
          {empty ? (
            <p className="empty-usage">{copy.console.noUsage}</p>
          ) : (
            <div aria-label="Seven-day usage: 18.7 million tokens" className="usage-chart" role="img">
              {weeklyUsage.map((height, index) => (
                <span key={index} style={{ "--bar-height": `${height}%` } as CSSProperties} />
              ))}
            </div>
          )}
        </div>
      </div>

      {!empty && (
        <div aria-label="Model usage split: Qwen 48 percent, DeepSeek 31 percent, Llama 21 percent" className="model-usage" role="img">
          {modelUsage.map((item) => (
            <div className="model-usage-row" key={item.model}>
              <span>{item.model}</span>
              <div className="model-usage-track">
                <span className={`model-usage-fill ${item.className}`} style={{ width: `${item.percent}%` }} />
              </div>
              <strong>{item.percent}%</strong>
            </div>
          ))}
        </div>
      )}

      {!compact && (
        <div className="console-details">
          <section aria-labelledby="recent-requests-title" className="recent-requests">
            <h3 id="recent-requests-title">{copy.console.recent}</h3>
            {empty ? (
              <p className="empty-usage">{copy.console.noUsage}</p>
            ) : (
              <div className="request-list">
                {recentRequests.map(([model, tokens, latency]) => (
                  <div className="request-row" key={model}>
                    <code>{model}</code>
                    <span>{tokens} tokens</span>
                    <span>{latency}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section aria-labelledby="demo-key-title" className="demo-key">
            <h3 id="demo-key-title">{copy.console.apiKey}</h3>
            <code>pc_demo_••••••••••••4f8a</code>
          </section>
        </div>
      )}
    </div>
  );
}
