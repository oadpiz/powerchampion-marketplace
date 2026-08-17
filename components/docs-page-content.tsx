"use client";

import { MODEL_CATALOG } from "../lib/models";
import { SERVICE_READINESS, TRUST_CONTENT, isReady, type ReadinessState } from "../lib/trust";
import { CodeSamples } from "./code-samples";
import { useLocale } from "./locale-provider";

const BASE_URL = "https://b300.powerchampion.ai/v1";
const DEMO_KEY = "sk-b300-YOUR-KEY";

type ModelFeatureGate = "streaming" | "tools" | "structuredOutput";

export function modelFeatureGateState(
  inference: ReadinessState,
  models: ReadonlyArray<Pick<(typeof MODEL_CATALOG)[number], "available" | "features">>,
  feature: ModelFeatureGate,
): ReadinessState {
  return isReady(inference) && models.length > 0 && models.every((model) => model.available && model.features[feature])
    ? "ready"
    : "not-ready";
}

export function DocsPageContent() {
  const { copy, locale } = useLocale();
  const readiness = TRUST_CONTENT[locale].status.states;
  const releaseGates = [
    { id: "streaming", label: locale === "en" ? "Streaming" : "串流", state: modelFeatureGateState(SERVICE_READINESS.inference, MODEL_CATALOG, "streaming") },
    { id: "usage", label: locale === "en" ? "Usage accounting" : "用量計算", state: SERVICE_READINESS.usageAccounting },
    { id: "tools", label: locale === "en" ? "Tool use" : "工具呼叫", state: modelFeatureGateState(SERVICE_READINESS.inference, MODEL_CATALOG, "tools") },
    { id: "structured", label: locale === "en" ? "Structured output" : "結構化輸出", state: modelFeatureGateState(SERVICE_READINESS.inference, MODEL_CATALOG, "structuredOutput") },
    { id: "manifest", label: locale === "en" ? "Provider manifest" : "供應商 Manifest", state: SERVICE_READINESS.manifest },
    { id: "status", label: locale === "en" ? "Operational status" : "營運狀態", state: SERVICE_READINESS.inference },
  ] as const;

  return (
    <main className="docs-page" id="main-content">
      <section aria-labelledby="docs-title" className="docs-intro">
        <p className="eyebrow">{copy.docs.kicker}</p>
        <h1 id="docs-title">{copy.docs.title}</h1>
        <p>{copy.docs.lead}</p>
        <p className="docs-notice">{locale === "en" ? "Live — the endpoint below is operational" : "已上線 — 下方端點皆可運作"}</p>
      </section>

      <section aria-labelledby="public-preview-title" className="docs-quick-start">
        <h2 id="public-preview-title">{locale === "en" ? "Quick start" : "快速開始"}</h2>
        <p className="docs-guidance">
          {locale === "en"
            ? "The request shape, model names, and rates below are live. Point any OpenAI-compatible client at the base URL with your API key."
            : "下方請求格式、模型名稱與費率皆為即時資訊。將任何 OpenAI 相容客戶端指向此 base URL 並附上你的 API 金鑰即可。"}
        </p>
        <dl className="docs-values">
          <div><dt>{copy.docs.baseUrl}</dt><dd><code>{BASE_URL}</code></dd></div>
          <div><dt>{copy.docs.chooseModel}</dt><dd><code>glm-5.2-fp8</code></dd></div>
          <div><dt>{locale === "en" ? "Endpoint status" : "端點狀態"}</dt><dd>{locale === "en" ? "Live" : "已上線"}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="protected-access-title" className="docs-quick-start docs-protected-access">
        <h2 id="protected-access-title">{locale === "en" ? "Protected access" : "受保護存取"}</h2>
        <p className="docs-guidance">
          {locale === "en"
            ? "API keys are issued per customer with prepaid balance (nano-USD precision). Check your balance anytime with GET /dashboard/billing/subscription using your key; top up with redeem codes."
            : "API 金鑰以預付餘額形式逐客戶發行（nano-USD 精度）。使用金鑰可隨時呼叫 GET /dashboard/billing/subscription 查詢餘額，並可使用儲值碼加值。"}
        </p>
        <dl className="docs-values docs-values-single">
          <div><dt>{locale === "en" ? "API key" : "API 金鑰"}</dt><dd><code>{DEMO_KEY}</code> — <a href="#protected-access-title">{locale === "en" ? "request yours by email" : "透過 email 申請"}</a></dd></div>
        </dl>
      </section>

      <section aria-labelledby="release-gates-title" className="docs-quick-start docs-release-gates">
        <h2 id="release-gates-title">{locale === "en" ? "Release gates" : "發布門檻"}</h2>
        <ul>
          {releaseGates.map((gate) => <li key={gate.id}>{gate.label}: {readiness[gate.state]}</li>)}
        </ul>
      </section>

      <CodeSamples />
    </main>
  );
}
