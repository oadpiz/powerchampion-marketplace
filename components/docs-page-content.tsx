"use client";

import { MODEL_CATALOG } from "../lib/models";
import { SERVICE_READINESS, TRUST_CONTENT, isReady, type ReadinessState } from "../lib/trust";
import { CodeSamples } from "./code-samples";
import { useLocale } from "./locale-provider";

const BASE_URL = "https://api.powerchampion.example/v1";
const DEMO_KEY = "pc_demo_YOUR_KEY";

export function DocsPageContent() {
  const { copy, locale } = useLocale();
  const readiness = TRUST_CONTENT[locale].status.states;
  const featureGate = (feature: "streaming" | "tools" | "structuredOutput"): ReadinessState => (
    isReady(SERVICE_READINESS.inference) && MODEL_CATALOG.every((model) => model.features[feature])
      ? "ready"
      : "not-ready"
  );
  const releaseGates = [
    { id: "streaming", label: locale === "en" ? "Streaming" : "串流", state: featureGate("streaming") },
    { id: "usage", label: locale === "en" ? "Usage accounting" : "用量計算", state: "not-ready" as const },
    { id: "tools", label: locale === "en" ? "Tool use" : "工具呼叫", state: featureGate("tools") },
    { id: "structured", label: locale === "en" ? "Structured output" : "結構化輸出", state: featureGate("structuredOutput") },
    { id: "manifest", label: locale === "en" ? "Provider manifest" : "供應商 Manifest", state: SERVICE_READINESS.manifest },
    { id: "status", label: locale === "en" ? "Operational status" : "營運狀態", state: SERVICE_READINESS.inference },
  ] as const;

  return (
    <main className="docs-page" id="main-content">
      <section aria-labelledby="docs-title" className="docs-intro">
        <p className="eyebrow">{copy.docs.kicker}</p>
        <h1 id="docs-title">{copy.docs.title}</h1>
        <p>{copy.docs.lead}</p>
        <p className="docs-notice">{locale === "en" ? "Public preview — non-operational" : "公開預覽 — 不可運作"}</p>
      </section>

      <section aria-labelledby="public-preview-title" className="docs-quick-start">
        <h2 id="public-preview-title">{locale === "en" ? "Public preview" : "公開預覽"}</h2>
        <p className="docs-guidance">
          {locale === "en"
            ? "The request shape, model names, and illustrative rates are public reference material. They are non-operational and do not provide an endpoint or service access."
            : "請求格式、模型名稱與展示費率屬於公開參考資料。它們不可運作，且不提供端點或服務存取。"}
        </p>
        <dl className="docs-values">
          <div><dt>{copy.docs.baseUrl}</dt><dd><code>{BASE_URL}</code></dd></div>
          <div><dt>{copy.docs.chooseModel}</dt><dd><code>pc/qwen-coder</code></dd></div>
          <div><dt>{locale === "en" ? "Example status" : "範例狀態"}</dt><dd>{locale === "en" ? "Non-operational" : "不可運作"}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="protected-access-title" className="docs-quick-start docs-protected-access">
        <h2 id="protected-access-title">{locale === "en" ? "Protected access" : "受保護存取"}</h2>
        <p className="docs-guidance">
          {locale === "en"
            ? "Authentication, accounts, service entitlement, usage accounting, and inference remain unavailable pending release review. The placeholder below is inert and non-operational."
            : "驗證、帳戶、服務授權、用量計算與推論仍在發布審查中，尚未提供。下方預留字串為無作用、不可運作的範例。"}
        </p>
        <dl className="docs-values docs-values-single">
          <div><dt>{copy.docs.apiKey}</dt><dd><code>{DEMO_KEY}</code></dd></div>
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
