"use client";

import { MODEL_CATALOG } from "../lib/models";
import { TRUST_CONTENT, deriveGatewayReadiness, isReady, type ReadinessState } from "../lib/trust";
import type { GatewayStatus } from "../lib/gateway-status";
import { CodeSamples } from "./code-samples";
import { useLocale } from "./locale-provider";

const BASE_URL = "https://b300.powerchampion.ai/v1";
const DEMO_KEY = "«redacted:sk-…»";

type ModelFeatureGate = "streaming" | "tools" | "structuredOutput";

export function modelFeatureGateState(
  inference: ReadinessState,
  models: ReadonlyArray<Pick<(typeof MODEL_CATALOG)[number], "available" | "features">>,
  feature: ModelFeatureGate,
): ReadinessState {
  // An unverified/degraded inference signal is passed through as-is — the
  // gate must not claim "ready" on unverified input, nor mask "unknown"
  // behind a definitive "not-ready".
  if (!isReady(inference)) return inference;
  return models.length > 0 && models.every((model) => model.available && model.features[feature])
    ? "ready"
    : "not-ready";
}

type Props = {
  gateway: GatewayStatus | null;
};

export function DocsPageContent({ gateway }: Props) {
  const { copy, locale } = useLocale();
  const readiness = TRUST_CONTENT[locale].status.states;
  const derived = deriveGatewayReadiness(gateway);
  const releaseGates = [
    { id: "streaming", label: locale === "en" ? "Streaming" : "串流", state: modelFeatureGateState(derived.inference, MODEL_CATALOG, "streaming") },
    { id: "usage", label: locale === "en" ? "Usage accounting" : "用量計算", state: derived.usageAccounting },
    { id: "tools", label: locale === "en" ? "Tool use" : "工具呼叫", state: modelFeatureGateState(derived.inference, MODEL_CATALOG, "tools") },
    { id: "structured", label: locale === "en" ? "Structured output" : "結構化輸出", state: modelFeatureGateState(derived.inference, MODEL_CATALOG, "structuredOutput") },
    { id: "manifest", label: locale === "en" ? "Provider manifest" : "供應商 Manifest", state: derived.manifest },
    { id: "status", label: locale === "en" ? "Operational status" : "營運狀態", state: derived.inference },
  ] as const;

  return (
    <main className="docs-page" id="main-content">
      <section aria-labelledby="docs-title" className="docs-intro">
        <p className="eyebrow">{copy.docs.kicker}</p>
        <h1 id="docs-title">{copy.docs.title}</h1>
        <p>{copy.docs.lead}</p>
        <p className="docs-notice">{locale === "en" ? "Deployed — the endpoint below is live; current model availability is shown on the status page" : "已部署 — 下方端點皆為正式端點；目前模型可用性請見狀態頁"}</p>
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
          <div><dt>{locale === "en" ? "Endpoint status" : "端點狀態"}</dt><dd>{locale === "en" ? "Deployed" : "已部署"}</dd></div>
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

      <section aria-labelledby="endpoints-title" className="docs-quick-start docs-endpoints">
        <h2 id="endpoints-title">{locale === "en" ? "Available endpoints" : "可用端點"}</h2>
        <dl className="docs-values">
          <div><dt>POST /v1/chat/completions</dt><dd>{locale === "en" ? "Chat, reasoning, coding (GLM 5.2 FP8, Qwen3-VL 30B)" : "對話、推理、程式開發（GLM 5.2 FP8、Qwen3-VL 30B）"}</dd></div>
          <div><dt>POST /v1/images/generations</dt><dd>{locale === "en" ? "Text-to-image (Flux Schnell, Chroma1 HD)" : "文生圖（Flux Schnell、Chroma1 HD）"}</dd></div>
          <div><dt>POST /v1/audio/transcriptions</dt><dd>{locale === "en" ? "Speech-to-text (Whisper Large v3)" : "語音轉文字（Whisper Large v3）"}</dd></div>
          <div><dt>POST /v1/audio/speech</dt><dd>{locale === "en" ? "Text-to-speech (IndexTTS2)" : "文字轉語音（IndexTTS2）"}</dd></div>
          <div><dt>POST /v1/embeddings</dt><dd>{locale === "en" ? "Embeddings for RAG (BGE-M3)" : "RAG 嵌入向量（BGE-M3）"}</dd></div>
          <div><dt>POST /v1/rerank</dt><dd>{locale === "en" ? "Document reranking (BGE Reranker v2-m3)" : "文件重排（BGE Reranker v2-m3）"}</dd></div>
          <div><dt>GET /v1/models</dt><dd>{locale === "en" ? "List available models" : "列出可用模型"}</dd></div>
          <div><dt>GET /dashboard/billing/subscription</dt><dd>{locale === "en" ? "Check prepaid balance" : "查詢預付餘額"}</dd></div>
          <div><dt>POST /v1/redeem</dt><dd>{locale === "en" ? "Redeem a top-up code" : "使用儲值碼加值"}</dd></div>
        </dl>
      </section>

      <CodeSamples />
    </main>
  );
}
