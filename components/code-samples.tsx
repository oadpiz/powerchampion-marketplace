"use client";

import { useId, useRef, useState } from "react";
import { useLocale } from "./locale-provider";

const BASE = "https://b300.powerchampion.ai/v1";
const KEY_PLACEHOLDER = "«redacted:sk-…»";

type SampleGroup = {
  id: string;
  label: { en: string; zh: string };
  description: { en: string; zh: string };
  samples: {
    curl: string;
    python: string;
    javascript: string;
  };
};

const SAMPLE_GROUPS: SampleGroup[] = [
  {
    id: "chat",
    label: { en: "Chat & Reasoning", zh: "對話與推理" },
    description: {
      en: "Text chat completions with GLM 5.2 FP8.",
      zh: "使用 GLM 5.2 FP8 進行文字對話補全。",
    },
    samples: {
      curl: `curl ${BASE}/chat/completions \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"glm-5.2-fp8","messages":[{"role":"user","content":"Hello"}]}'`,
      python: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key="${KEY_PLACEHOLDER}",
)

response = client.chat.completions.create(
    model="glm-5.2-fp8",
    messages=[{"role": "user", "content": "Hello"}],
)`,
      javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: "${KEY_PLACEHOLDER}",
});

const response = await client.chat.completions.create({
  model: "glm-5.2-fp8",
  messages: [{ role: "user", content: "Hello" }],
});`,
    },
  },
  {
    id: "vision",
    label: { en: "Vision & OCR", zh: "視覺與 OCR" },
    description: {
      en: "Send images for analysis, OCR, and chart understanding with Qwen3-VL 30B.",
      zh: "使用 Qwen3-VL 30B 傳送圖片進行分析、OCR 與圖表理解。",
    },
    samples: {
      curl: `curl ${BASE}/chat/completions \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3-vl-30b",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "Describe this image."},
        {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}}
      ]
    }]
  }'`,
      python: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key="${KEY_PLACEHOLDER}",
)

response = client.chat.completions.create(
    model="qwen3-vl-30b",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "Describe this image."},
            {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}},
        ],
    }],
)`,
      javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: "${KEY_PLACEHOLDER}",
});

const response = await client.chat.completions.create({
  model: "qwen3-vl-30b",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Describe this image." },
      { type: "image_url", image_url: { url: "https://example.com/photo.jpg" } },
    ],
  }],
});`,
    },
  },
  {
    id: "image",
    label: { en: "Image Generation", zh: "圖像生成" },
    description: {
      en: "Generate images from text prompts with Flux Schnell or Chroma1 HD.",
      zh: "使用 Flux Schnell 或 Chroma1 HD 從文字提示生成圖像。",
    },
    samples: {
      curl: `curl ${BASE}/images/generations \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "flux-schnell",
    "prompt": "A serene mountain lake at sunrise",
    "n": 1
  }'`,
      python: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key="${KEY_PLACEHOLDER}",
)

response = client.images.generate(
    model="flux-schnell",
    prompt="A serene mountain lake at sunrise",
    n=1,
)

image_url = response.data[0].url`,
      javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: "${KEY_PLACEHOLDER}",
});

const response = await client.images.generate({
  model: "flux-schnell",
  prompt: "A serene mountain lake at sunrise",
  n: 1,
});

const imageUrl = response.data[0].url;`,
    },
  },
  {
    id: "transcription",
    label: { en: "Audio Transcription", zh: "語音轉錄" },
    description: {
      en: "Transcribe audio to text with Whisper Large v3.",
      zh: "使用 Whisper Large v3 將音訊轉錄為文字。",
    },
    samples: {
      curl: `curl ${BASE}/audio/transcriptions \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -F "model=whisper-large-v3" \\
  -F "file=@audio.mp3"`,
      python: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key="${KEY_PLACEHOLDER}",
)

with open("audio.mp3", "rb") as f:
    response = client.audio.transcriptions.create(
        model="whisper-large-v3",
        file=f,
    )

transcript = response.text`,
      javascript: `import OpenAI from "openai";
import fs from "fs";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: "${KEY_PLACEHOLDER}",
});

const response = await client.audio.transcriptions.create({
  model: "whisper-large-v3",
  file: fs.createReadStream("audio.mp3"),
});

const transcript = response.text;`,
    },
  },
  {
    id: "tts",
    label: { en: "Text-to-Speech", zh: "文字轉語音" },
    description: {
      en: "Generate speech with IndexTTS2 using a reference voice ID provisioned for your deployment.",
      zh: "使用 IndexTTS2 生成語音，需填入已為部署配置的參考聲音 ID。",
    },
    samples: {
      curl: `curl ${BASE}/audio/speech \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "indextts2",
    "input": "Hello, this is a test of text-to-speech.",
    "voice": "YOUR_REGISTERED_VOICE_ID"
  }' \\
  --output speech.mp3`,
      python: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key="${KEY_PLACEHOLDER}",
)

response = client.audio.speech.create(
    model="indextts2",
    input="Hello, this is a test of text-to-speech.",
    voice="YOUR_REGISTERED_VOICE_ID",
)

response.stream_to_file("speech.mp3")`,
      javascript: `import OpenAI from "openai";
import fs from "fs";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: "${KEY_PLACEHOLDER}",
});

const response = await client.audio.speech.create({
  model: "indextts2",
  input: "Hello, this is a test of text-to-speech.",
  voice: "YOUR_REGISTERED_VOICE_ID",
});

fs.writeFileSync("speech.mp3", Buffer.from(await response.arrayBuffer()));`,
    },
  },
  {
    id: "embedding",
    label: { en: "Embeddings", zh: "嵌入向量" },
    description: {
      en: "Generate embeddings for RAG and semantic search with BGE-M3.",
      zh: "使用 BGE-M3 生成嵌入向量，用於 RAG 與語意搜尋。",
    },
    samples: {
      curl: `curl ${BASE}/embeddings \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "bge-m3",
    "input": "The quick brown fox jumps over the lazy dog"
  }'`,
      python: `from openai import OpenAI

client = OpenAI(
    base_url="${BASE}",
    api_key="${KEY_PLACEHOLDER}",
)

response = client.embeddings.create(
    model="bge-m3",
    input="The quick brown fox jumps over the lazy dog",
)

embedding = response.data[0].embedding`,
      javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE}",
  apiKey: "${KEY_PLACEHOLDER}",
});

const response = await client.embeddings.create({
  model: "bge-m3",
  input: "The quick brown fox jumps over the lazy dog",
});

const embedding = response.data[0].embedding;`,
    },
  },
  {
    id: "rerank",
    label: { en: "Reranking", zh: "重排" },
    description: {
      en: "Rerank documents for precision retrieval with BGE Reranker v2-m3.",
      zh: "使用 BGE Reranker v2-m3 重排文件，提升檢索精確度。",
    },
    samples: {
      curl: `curl ${BASE}/rerank \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "bge-reranker-v2-m3",
    "query": "What is machine learning?",
    "documents": [
      "Machine learning is a subset of AI.",
      "The weather is nice today.",
      "Deep learning uses neural networks."
    ]
  }'`,
      python: `import httpx

response = httpx.post(
    "${BASE}/rerank",
    headers={
        "Authorization": "Bearer ${KEY_PLACEHOLDER}",
        "Content-Type": "application/json",
    },
    json={
        "model": "bge-reranker-v2-m3",
        "query": "What is machine learning?",
        "documents": [
            "Machine learning is a subset of AI.",
            "The weather is nice today.",
            "Deep learning uses neural networks.",
        ],
    },
)

results = response.json()["results"]`,
      javascript: `const response = await fetch("${BASE}/rerank", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${KEY_PLACEHOLDER}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "bge-reranker-v2-m3",
    query: "What is machine learning?",
    documents: [
      "Machine learning is a subset of AI.",
      "The weather is nice today.",
      "Deep learning uses neural networks.",
    ],
  }),
});

const { results } = await response.json();`,
    },
  },
  {
    id: "balance",
    label: { en: "Balance & Top-up", zh: "餘額與儲值" },
    description: {
      en: "Check your prepaid balance and redeem top-up codes.",
      zh: "查詢預付餘額並使用儲值碼加值。",
    },
    samples: {
      curl: `# Check balance
curl ${BASE.replace("/v1", "")}/dashboard/billing/subscription \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}"

# Redeem a top-up code
curl -X POST ${BASE}/redeem \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{"code": "YOUR-REDEEM-CODE"}'`,
      python: `import httpx

# Check balance
response = httpx.get(
    "${BASE.replace("/v1", "")}/dashboard/billing/subscription",
    headers={"Authorization": "Bearer ${KEY_PLACEHOLDER}"},
)
balance = response.json()

# Redeem a top-up code
response = httpx.post(
    "${BASE}/redeem",
    headers={
        "Authorization": "Bearer ${KEY_PLACEHOLDER}",
        "Content-Type": "application/json",
    },
    json={"code": "YOUR-REDEEM-CODE"},
)
result = response.json()`,
      javascript: `// Check balance
const balanceRes = await fetch(
  "${BASE.replace("/v1", "")}/dashboard/billing/subscription",
  { headers: { Authorization: "Bearer ${KEY_PLACEHOLDER}" } },
);
const balance = await balanceRes.json();

// Redeem a top-up code
const redeemRes = await fetch("${BASE}/redeem", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${KEY_PLACEHOLDER}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ code: "YOUR-REDEEM-CODE" }),
});
const result = await redeemRes.json();`,
    },
  },
];

type SampleLanguage = "curl" | "python" | "javascript";

const sampleLanguages: { id: SampleLanguage; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
];

export function CodeSamples() {
  const { copy, locale } = useLocale();
  const [groupId, setGroupId] = useState<string>("chat");
  const [language, setLanguage] = useState<SampleLanguage>("curl");
  const [feedback, setFeedback] = useState<"copied" | "unavailable" | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();

  const group = SAMPLE_GROUPS.find((g) => g.id === groupId) ?? SAMPLE_GROUPS[0];

  async function copySample() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(group.samples[language]);
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

  function selectGroup(newGroupId: string) {
    setGroupId(newGroupId);
    setFeedback(null);
  }

  return (
    <section aria-label={copy.docs.quickStart} className="code-samples">
      <p className="code-sample-notice">
        {copy.docs.quickStart} — {locale === "en" ? "real requests against the live endpoint; substitute your own API key." : "對即時端點發出的真實請求；請替換為你自己的 API 金鑰。"}
      </p>

      {/* Endpoint / model selector */}
      <div className="code-group-selector" role="group" aria-label={locale === "en" ? "API endpoint" : "API 端點"}>
        {SAMPLE_GROUPS.map((g) => {
          const selected = groupId === g.id;
          return (
            <button
              aria-pressed={selected}
              key={g.id}
              onClick={() => selectGroup(g.id)}
              type="button"
            >
              {g.label[locale]}
            </button>
          );
        })}
      </div>

      <p className="code-group-description">{group.description[locale]}</p>

      {/* Language tabs */}
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

      {/* Code panels — one per language, only selected is visible */}
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
            {selected && (
              <>
                <div className="code-sample-actions">
                  <button onClick={copySample} type="button">{copy.docs.copy}</button>
                  <span aria-live="polite" role="status">
                    {feedback === "copied" ? copy.docs.copied : feedback === "unavailable" ? copy.shared.copyUnavailable : ""}
                  </span>
                </div>
                <pre><code>{group.samples[sample.id]}</code></pre>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
