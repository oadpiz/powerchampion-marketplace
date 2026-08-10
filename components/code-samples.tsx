"use client";

import { useId, useRef, useState } from "react";
import { useLocale } from "./locale-provider";

const samples = {
  curl: `curl https://api.powerchampion.example/v1/chat/completions \\
  -H "Authorization: Bearer pc_demo_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"pc/qwen-coder","messages":[{"role":"user","content":"Hello"}]}'`,
  python: `from openai import OpenAI

client = OpenAI(
    base_url="https://api.powerchampion.example/v1",
    api_key="pc_demo_YOUR_KEY",
)

response = client.chat.completions.create(
    model="pc/qwen-coder",
    messages=[{"role": "user", "content": "Hello"}],
)`,
  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.powerchampion.example/v1",
  apiKey: "pc_demo_YOUR_KEY",
});

const response = await client.chat.completions.create({
  model: "pc/qwen-coder",
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
  const { copy } = useLocale();
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
