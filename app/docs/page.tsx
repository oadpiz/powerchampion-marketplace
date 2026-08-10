"use client";

import { CodeSamples } from "../../components/code-samples";
import { useLocale } from "../../components/locale-provider";

const BASE_URL = "https://api.powerchampion.example/v1";
const DEMO_KEY = "pc_demo_••••••••••••7X4Q";

export default function DocsPage() {
  const { copy, locale } = useLocale();

  return (
    <main className="docs-page">
      <section aria-labelledby="docs-title" className="docs-intro">
        <p className="eyebrow">{copy.docs.kicker}</p>
        <h1 id="docs-title">{copy.docs.title}</h1>
        <p>{copy.docs.lead}</p>
        <p className="docs-notice">{copy.shared.illustrative}</p>
      </section>

      <section aria-labelledby="quick-start-title" className="docs-quick-start">
        <h2 id="quick-start-title">{copy.docs.quickStart}</h2>
        <dl className="docs-values">
          <div><dt>{copy.docs.baseUrl}</dt><dd><code>{BASE_URL}</code></dd></div>
          <div><dt>{copy.docs.apiKey}</dt><dd><code>{DEMO_KEY}</code></dd></div>
          <div><dt>{copy.docs.chooseModel}</dt><dd><code>pc/qwen-coder</code></dd></div>
        </dl>
        <p className="docs-guidance">
          {locale === "en"
            ? "Choose Qwen for coding, DeepSeek for deeper reasoning, or Llama for adaptable general use. Token billing varies by each selected model’s published input and output rate."
            : "程式開發可選擇 Qwen、較深度推理可選擇 DeepSeek、彈性通用工作可選擇 Llama。Token 計費會依選定模型公開的輸入與輸出費率而不同。"}
        </p>
      </section>
      <CodeSamples />
    </main>
  );
}
