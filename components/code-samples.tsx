"use client";

import { useId, useRef, useState } from "react";
import { useLocale } from "./locale-provider";

const samples = {
  curl: `curl https://b300.powerchampion.ai/v1/chat/completions \\
  -H "Authorization: Bearer sk-b300-YOUR-KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"glm-5.2-fp8","messages":[{"role":"user","content":"Hello"}]}'`,
  python: `from openai import OpenAI

client = OpenAI(
    base_url="https://b300.powerchampion.ai/v1",
    api_key="sk-b300-YOUR-KEY",
)

response = client.chat.completions.create(
    model="glm-5.2-fp8",
    messages=[{"role": "user", "content": "Hello"}],
)`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://b300.powerchampion.ai/v1",
  apiKey: "sk-b300-YOUR-KEY",
});

const response = await client.chat.completions.create({
  model: "glm-5.2-fp8",
  messages: [{ role: "user", content: "Hello" }],
});`,
} as const;

type SampleLanguage = keyof typeof samples;

const sampleLanguages: { id: SampleLanguage; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
];

export function CodeSamples() {
  const { copy, locale } = useLocale();
  const [language, setLanguage] = useState<SampleLanguage>("curl");
  const [feedback, setFeedback] = useState<"copied" | "unavailable" | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();

  async function copySample(sample: SampleLanguage) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(samples[sample]);
      setFeedback("copied");
    } catch {
      setFeedback("unavailable");
    }
  }

  function selectLanguage(index: number) {
    const nextIndex = (index + sampleLanguages.length) % sampleLanguages.length;
    setLanguage(sampleLanguages[nextIndex].id);
    setFeedback(null);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section aria-label={copy.docs.quickStart} className="code-samples">
      <p className="code-sample-notice">
        {copy.docs.quickStart} — {locale === "en" ? "real requests against the live endpoint; substitute your own API key." : "對即時端點發出的真實請求；請替換為你自己的 API 金鑰。"}
      </p>
      <div aria-label={copy.docs.quickStart} className="code-tabs" role="tablist">
        {sampleLanguages.map((sample, index) => {
          const selected = language === sample.id;
          return (
            <button
              aria-controls={`${id}-${sample.id}-panel`}
              aria-selected={selected}
              id={`${id}-${sample.id}-tab`}
              key={sample.id}
              onClick={() => selectLanguage(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  selectLanguage(index + 1);
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectLanguage(index - 1);
                }
              }}
              ref={(element) => { tabRefs.current[index] = element; }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {sample.label}
            </button>
          );
        })}
      </div>
      {sampleLanguages.map((sample) => {
        const selected = language === sample.id;

        return (
          <div
            aria-labelledby={`${id}-${sample.id}-tab`}
            className="code-sample-panel"
            hidden={!selected}
            id={`${id}-${sample.id}-panel`}
            key={sample.id}
            role="tabpanel"
          >
            <div className="code-sample-actions">
              <button onClick={() => copySample(sample.id)} type="button">{copy.docs.copy}</button>
              <span aria-live="polite" role="status">
                {selected && (feedback === "copied" ? copy.docs.copied : feedback === "unavailable" ? copy.shared.copyUnavailable : "")}
              </span>
            </div>
            <pre><code>{samples[sample.id]}</code></pre>
          </div>
        );
      })}
    </section>
  );
}
