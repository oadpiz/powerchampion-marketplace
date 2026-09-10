"use client";

/* Vinext uses root-relative anchors for page navigation. */
/* eslint-disable @next/next/no-html-link-for-pages */

/* Native image keeps this conceptual asset portable across Vinext previews. */
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { MODEL_CATALOG, type ModelDefinition } from "../lib/models";
import { useLocale } from "./locale-provider";
import { ApplicationExplorer, ModelServiceDetails } from "./platform-story";

type Category = "featured" | "text" | "vision" | "creative" | "retrieval";
type Language = "Python" | "cURL";
const samples: Record<Language, string> = {
  Python: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="https://b300.powerchampion.ai/v1",\n    api_key="YOUR_API_KEY"\n)\n\nresponse = client.chat.completions.create(\n    model="glm-5.2-fp8",\n    messages=[{\n        "role": "user",\n        "content": "Let's build something extraordinary."\n    }]\n)\n\nprint(response.choices[0].message.content)`,
  cURL: `curl https://b300.powerchampion.ai/v1/chat/completions \\\n  -H "Authorization: Bearer $POWERCHAMPION_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "glm-5.2-fp8",\n    "messages": [{\n      "role": "user",\n      "content": "Let us build something extraordinary."\n    }]\n  }'`,
};

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d={diagonal ? "M5 19 19 5M5 5h14v14" : "M4 12h15m-6-6 6 6-6 6"} />
    </svg>
  );
}

function ModelSymbol({ model }: { model: ModelDefinition }) {
  const symbol = model.categories.includes("image")
    ? "✳"
    : model.categories.includes("audio")
      ? "≋"
      : model.categories.includes("embedding")
        ? "⌘"
        : model.categories.includes("vision")
          ? "◈"
          : "✻";
  return (
    <span
      aria-hidden="true"
      className={`pc-model-symbol pc-symbol-${model.categories[0]}`}
    >
      {symbol}
    </span>
  );
}

function ModelCard({ model }: { model: ModelDefinition }) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const category = model.categories.includes("image")
    ? zh
      ? "圖像生成"
      : "IMAGE GENERATION"
    : model.categories.includes("audio")
      ? zh
        ? "語音與音訊"
        : "SPEECH & AUDIO"
      : model.categories.includes("embedding")
        ? zh
          ? "搜尋與檢索"
          : "SEARCH & RETRIEVAL"
        : model.categories.includes("vision")
          ? zh
            ? "視覺理解"
            : "VISION & LANGUAGE"
          : zh
            ? "文字與推理"
            : "TEXT & REASONING";
  const unit = model.categories.includes("image")
    ? zh
      ? "／張圖片"
      : "/ image"
    : model.categories.includes("audio")
      ? zh
        ? "／音訊分鐘"
        : "/ audio min"
      : zh
        ? "／百萬輸入 Token"
        : "/ 1M input tokens";
  return (
    <article className="pc-model-card" aria-label={model.name}>
      <div className="pc-model-card-top">
        <ModelSymbol model={model} />
        <span className="pc-model-category">{category}</span>
      </div>
      <h3>{model.name}</h3>
      <p>{model.servingRole[locale]}</p>
      <div className="pc-model-card-bottom">
        <span>
          <strong>${model.inputPerMillion.toFixed(2)}</strong>{" "}
          <span>{unit}</span>
        </span>
        <a
          href={`/models#${model.id}`}
          aria-label={`${zh ? "查看" : "Explore"} ${model.name}`}
        >
          <Arrow diagonal />
        </a>
      </div>
    </article>
  );
}

export function HomeContent() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [category, setCategory] = useState<Category>("featured");
  const [language, setLanguage] = useState<Language>("Python");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const categories: { id: Category; label: string }[] = [
    { id: "featured", label: zh ? "精選模型" : "Featured models" },
    { id: "text", label: zh ? "文字與推理" : "Text & reasoning" },
    { id: "vision", label: zh ? "視覺理解" : "Vision" },
    { id: "creative", label: zh ? "圖像與音訊" : "Image & audio" },
    { id: "retrieval", label: zh ? "搜尋與檢索" : "Search & retrieval" },
  ];
  const featuredIds = [
    "glm-5.2-fp8",
    "qwen3-vl-30b",
    "flux-schnell",
    "whisper-large-v3",
  ];
  const models = MODEL_CATALOG.filter((model) =>
    category === "featured"
      ? featuredIds.includes(model.id)
      : category === "text"
        ? model.categories.includes("reasoning")
        : category === "vision"
          ? model.categories.includes("vision")
          : category === "creative"
            ? model.categories.some((c) => c === "image" || c === "audio")
            : model.categories.includes("embedding"),
  );
  const openAccess = () =>
    window.dispatchEvent(new Event("powerchampion:launch-access"));
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(samples[language]);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  const faqs = zh
    ? [
        [
          "Power Champion 提供哪些服務？",
          "我們以模型 API 服務為核心，提供文字推理、視覺理解、圖像生成、語音及檢索模型；同時提供 B300 等企業 GPU 算力與專用部署規劃。",
        ],
        [
          "可以使用既有的 OpenAI SDK 嗎？",
          "可以。相容端點可使用 OpenAI SDK，將 Base URL 改為 https://b300.powerchampion.ai/v1，並使用 Power Champion 的 API 金鑰與支援的模型 ID。各模型支援的功能請參考文件。",
        ],
        [
          "模型服務如何計費？",
          "採預付餘額、按使用量扣款。文字與檢索依 Token 計費，圖像依張數、音訊依分鐘計費；完整費率與儲值方式可在價格頁查看。",
        ],
        [
          "能否使用專屬 GPU 或客製部署？",
          "可以洽詢專用 GPU 叢集、單一租戶及客製模型部署。硬體、地點、容量與服務條件會依工作負載個別確認。",
        ],
      ]
    : [
        [
          "What can I build with Power Champion?",
          "Build with model APIs for reasoning, vision, image generation, speech, and retrieval. For workloads that need dedicated resources, we also offer enterprise GPU infrastructure and custom deployment planning.",
        ],
        [
          "Can I use my existing OpenAI SDK?",
          "Yes. Compatible endpoints work with the OpenAI SDK. Set your base URL to https://b300.powerchampion.ai/v1 and use your Power Champion API key and a supported model ID. Check the documentation for each model's supported capabilities.",
        ],
        [
          "How does model pricing work?",
          "Use a prepaid balance and pay for usage. Text and retrieval use token-based rates, images are billed per image, and audio is billed per minute. See the pricing page for full rates and top-up options.",
        ],
        [
          "Do you offer dedicated GPU infrastructure?",
          "Yes. Talk to us about dedicated GPU clusters, single-tenant infrastructure, and custom model deployments. Hardware, location, capacity, and service terms are confirmed for your workload.",
        ],
      ];

  return (
    <main id="main-content" className="unified-home">
      <section className="pc-hero" aria-labelledby="home-title">
        <div className="pc-hero-art" aria-hidden="true">
          <img
            src="/model-core-noir.png"
            alt=""
            width="1536"
            height="1024"
            fetchPriority="high"
          />
        </div>
        <div className="pc-frame pc-hero-inner">
          <div className="pc-hero-copy">
            <div className="pc-overline">
              <span className="pc-dot" />
              {zh
                ? "為每一個想法，接上 AI"
                : "OPEN MODELS. EXTRAORDINARY IDEAS."}
            </div>
            <h1 id="home-title">
              {zh ? (
                <>
                  一組 API。
                  <br />
                  <span>無限可能。</span>
                </>
              ) : (
                <>
                  One API.
                  <br />
                  <span>Every possibility.</span>
                </>
              )}
            </h1>
            <p className="pc-hero-lead">
              {zh
                ? "一個入口，接入文字、視覺、影像、語音與檢索模型。以透明的使用費率，讓你的產品從第一個原型走向日常應用。"
                : "One place to access models for text, vision, images, speech, and retrieval. Build from your first prototype to everyday workflows, with clear usage-based pricing."}
            </p>
            <div className="pc-actions">
              <a href="#models" className="pc-button">
                {zh ? "探索模型" : "Explore models"}
                <Arrow />
              </a>
              <a href="/docs" className="pc-link">
                {zh ? "閱讀 API 文件" : "Read the docs"}
                <Arrow diagonal />
              </a>
            </div>
            <div className="pc-hero-notes">
              <span>
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                >
                  <path
                    d="m3 8 3 3 7-7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
                OpenAI-compatible
              </span>
              <span>{zh ? "按量計費" : "Pay per use"}</span>
            </div>
          </div>
          <div className="pc-art-label">
            <span className="pc-art-label-icon">✳</span>
            <div>
              <strong>
                {zh ? "多種智慧。一個入口。" : "Many models. One connection."}
              </strong>
              <span>
                {zh
                  ? "文字 · 視覺 · 圖像 · 音訊 · 檢索"
                  : "TEXT · VISION · IMAGE · AUDIO · RETRIEVAL"}
              </span>
            </div>
          </div>
          <a className="pc-scroll-cue" href="#models">
            <span>{zh ? "向下探索" : "SCROLL TO DISCOVER"}</span>
            <span aria-hidden="true">↓</span>
          </a>
        </div>
      </section>

      <div
        className="pc-model-families pc-frame"
        aria-label={zh ? "模型家族" : "Model families"}
      >
        <p>
          {zh
            ? "精選開放模型\n激發更多可能"
            : "A world of intelligence.\nOne curated collection."}
        </p>
        <div>
          <span className="pc-family-glm">
            z.ai <b>GLM</b>
          </span>
          <span className="pc-family-qwen">✧ Qwen</span>
          <span className="pc-family-flux">
            FLUX<span className="pc-family-period">.</span>
          </span>
          <span className="pc-family-whisper">Whisper</span>
          <span className="pc-family-bge">
            BGE<span className="pc-family-period">↗</span>
          </span>
        </div>
      </div>

      <div
        className="pc-frame pc-platform-paths"
        aria-label={zh ? "平台工具" : "Platform tools"}
      >
        <a href="/platform">
          <span>
            {zh ? "進入模型平台" : "Open the platform"}
            <small>
              {zh
                ? "探索、比較、測試、串接"
                : "Explore. Compare. Test. Connect."}
            </small>
          </span>
          <span aria-hidden="true">↗</span>
        </a>
        <a href="/compare">
          <span>{zh ? "比較模型與費用" : "Compare models & costs"}</span>
          <span aria-hidden="true">⇄</span>
        </a>
        <a href="/playground">
          <span>{zh ? "測試模型 API" : "Try the playground"}</span>
          <span aria-hidden="true">▷</span>
        </a>
        <a href="/integrations">
          <span>{zh ? "設定產品串接" : "Connect your app"}</span>
          <span aria-hidden="true">⌘</span>
        </a>
      </div>

      <section
        id="models"
        className="pc-section pc-frame pc-models"
        aria-labelledby="models-title"
      >
        <div className="pc-section-heading">
          <div>
            <p className="pc-overline">
              <span className="pc-section-number">01 /</span>
              {zh ? "模型服務" : "THE MODEL COLLECTION"}
            </p>
            <h2 id="models-title">
              {zh ? (
                <>
                  每個想法，
                  <br />
                  都有合適的模型。
                </>
              ) : (
                <>
                  Great ideas deserve
                  <br />
                  the right intelligence.
                </>
              )}
            </h2>
          </div>
          <div className="pc-section-aside">
            <p>
              {zh
                ? "從更聰明的對話到更出色的創作，依你的產品挑選模型，用熟悉的 API 串起一切。"
                : "Sharper conversations. Richer creations. Find the model that fits your product, all through a familiar API."}
            </p>
            <a className="pc-link" href="/models">
              {zh
                ? `查看全部 ${MODEL_CATALOG.length} 個模型`
                : `Explore all ${MODEL_CATALOG.length} models`}
              <Arrow />
            </a>
          </div>
        </div>
        <div
          className="pc-filter-bar"
          role="group"
          aria-label={zh ? "篩選模型" : "Filter models"}
        >
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={category === item.id}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="pc-model-grid" aria-live="polite" aria-atomic="true">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
        <div className="pc-models-footnote">
          <span>
            {zh
              ? "以美元計價。完整輸入／輸出費率請見價格頁。"
              : "Rates in USD. See pricing for full input and output rates."}
          </span>
          <a href="/status">
            {zh ? "查看即時服務狀態" : "Check service availability"}
            <Arrow diagonal />
          </a>
        </div>
      </section>

      <ApplicationExplorer />

      <section
        className="pc-frame pc-section pc-developer"
        aria-labelledby="developer-title"
      >
        <div className="pc-developer-copy">
          <p className="pc-overline">
            <span className="pc-section-number">03 /</span>
            {zh ? "為開發者而生" : "MADE FOR DEVELOPERS"}
          </p>
          <h2 id="developer-title">
            {zh ? (
              <>
                少一點設定。
                <br />
                <em>多一點創造。</em>
              </>
            ) : (
              <>
                Less setup.
                <br />
                <em>More building.</em>
              </>
            )}
          </h2>
          <p>
            {zh
              ? "帶上你的程式碼，選擇合適的模型。熟悉的 SDK、清楚的文件，讓你把心力放在真正重要的產品體驗。"
              : "Bring your code. Pick your model. A familiar SDK and straightforward docs let you focus on the experience you're creating."}
          </p>
          <ol className="pc-dev-steps">
            <li>
              <span>1</span>
              {zh ? "申請 API 金鑰" : "Request your API key"}
            </li>
            <li>
              <span>2</span>
              {zh ? "設定相容端點" : "Set your base URL"}
            </li>
            <li>
              <span>3</span>
              {zh ? "選擇模型，開始打造" : "Choose a model. Start building."}
            </li>
          </ol>
          <a className="pc-link" href="/docs">
            {zh ? "查看開發文件" : "Explore documentation"}
            <Arrow />
          </a>
        </div>
        <div className="pc-code-window">
          <div className="pc-code-toolbar">
            <div role="group" aria-label={zh ? "程式碼語言" : "Code language"}>
              {(["Python", "cURL"] as Language[]).map((item) => (
                <button
                  type="button"
                  aria-pressed={language === item}
                  key={item}
                  onClick={() => {
                    setLanguage(item);
                    setCopyState("idle");
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            <button className="pc-copy-button" type="button" onClick={copyCode}>
              {copyState === "copied"
                ? zh
                  ? "已複製 ✓"
                  : "Copied ✓"
                : zh
                  ? "複製程式碼"
                  : "Copy code"}
            </button>
          </div>
          <pre
            role="region"
            // Keyboard focus lets Safari users scroll long code with arrow keys.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-label={`${language} ${zh ? "整合範例" : "integration example"}`}
          >
            <code>
              {samples[language].split("\n").map((line, index) => (
                <span className="pc-code-line" key={index}>
                  <span aria-hidden="true" className="pc-line-number">
                    {index + 1}
                  </span>
                  <span
                    className={
                      line.startsWith("from") || line.startsWith("curl")
                        ? "pc-code-keyword"
                        : line.includes('"')
                          ? "pc-code-string"
                          : ""
                    }
                  >
                    {line || " "}
                  </span>
                  {"\n"}
                </span>
              ))}
            </code>
          </pre>
          <div className="pc-code-note">
            <span aria-hidden="true">↳</span>
            {copyState === "error"
              ? zh
                ? "無法自動複製，請選取上方程式碼複製。"
                : "Copy unavailable. Select and copy the code above."
              : zh
                ? "需使用有效金鑰；模型可用狀態請見服務狀態頁。"
                : "Use your own API key. Check status for model availability."}
          </div>
          <span role="status" className="sr-only">
            {copyState === "copied"
              ? zh
                ? "程式碼已複製"
                : "Code copied to clipboard"
              : ""}
          </span>
        </div>
      </section>

      <ModelServiceDetails />

      <section
        className="pc-infrastructure"
        aria-labelledby="infrastructure-title"
      >
        <div className="pc-frame pc-infra-inner">
          <div>
            <p className="pc-overline">
              <span className="pc-section-number">05 /</span>
              {zh ? "企業算力服務" : "BEYOND THE API"}
            </p>
            <h2 id="infrastructure-title">
              {zh ? (
                <>
                  更大的企圖心。
                  <br />
                  <em>更深一層的算力。</em>
                </>
              ) : (
                <>
                  Bigger ambitions.
                  <br />
                  <em>Deeper power.</em>
                </>
              )}
            </h2>
            <p className="pc-infra-lead">
              {zh
                ? "模型服務之外，我們也提供以 NVIDIA HGX 為基礎的 GPU 叢集規劃。從 B300 專用算力到客製部署，讓基礎設施配合你的工作負載。"
                : "For workloads that need their own foundation. Explore NVIDIA HGX-based GPU infrastructure, from dedicated B300 compute to custom model deployments."}
            </p>
            <div className="pc-infra-tags">
              <span>NVIDIA HGX B300</span>
              <span>{zh ? "專用算力" : "Dedicated compute"}</span>
              <span>{zh ? "客製部署" : "Custom deployment"}</span>
            </div>
            <a href="/infrastructure" className="pc-button pc-button-light">
              {zh ? "探索算力服務" : "Explore GPU infrastructure"}
              <Arrow />
            </a>
            <p className="pc-infra-small">
              {zh
                ? "配置、容量與交付條件依專案確認。"
                : "Configuration, capacity, and delivery are scoped to your project."}
            </p>
          </div>
          <div
            className="pc-rack-visual"
            role="img"
            aria-label={
              zh
                ? "專用 GPU 叢集概念圖"
                : "Conceptual dedicated GPU cluster illustration"
            }
          >
            <div className="pc-rack-label">
              <span className="pc-rack-cross">+</span>POWER CHAMPION / COMPUTE
            </div>
            <div className="pc-racks">
              {[0, 1, 2].map((rack) => (
                <div className={`pc-rack pc-rack-${rack}`} key={rack}>
                  <div className="pc-rack-top">
                    <span>PC / {String(rack + 1).padStart(2, "0")}</span>
                    <i />
                  </div>
                  {Array.from({ length: 7 }, (_, i) => (
                    <div className="pc-server" key={i}>
                      <span className="pc-server-vent" />
                      <span className="pc-server-lights">
                        ··
                        <i />
                      </span>
                    </div>
                  ))}
                  <div className="pc-rack-base">GPU COMPUTE</div>
                </div>
              ))}
            </div>
            <div className="pc-rack-caption">
              <span>01—03</span>
              <span>
                {zh
                  ? "為高強度 AI 工作負載而設計"
                  : "ENGINEERED FOR DEMANDING AI"}
              </span>
              <span>↗</span>
            </div>
          </div>
        </div>
      </section>

      <section
        className="pc-frame pc-section pc-company"
        aria-labelledby="company-title"
      >
        <div>
          <p className="pc-overline">
            <span className="pc-section-number">05 /</span>
            {zh ? "認識 POWER CHAMPION" : "THE PEOPLE BEHIND THE POWER"}
          </p>
          <h2 id="company-title">
            {zh ? (
              <>
                你的下一步，
                <br />
                我們一起打造。
              </>
            ) : (
              <>
                Your next chapter.
                <br />
                Our shared ambition.
              </>
            )}
          </h2>
        </div>
        <div>
          <p className="pc-company-lead">
            {zh
              ? "Power Champion 連結模型服務與 AI 基礎設施，陪伴開發者與企業，把實驗中的想法推進到實際應用。"
              : "Power Champion connects model services with AI infrastructure, helping developers and enterprises move from experimentation toward real-world applications."}
          </p>
          <div className="pc-company-links">
            <a className="pc-link" href="/company">
              {zh ? "認識我們" : "Meet Power Champion"}
              <Arrow />
            </a>
            <a className="pc-link" href="/contact">
              {zh ? "討論你的專案" : "Talk about your project"}
              <Arrow diagonal />
            </a>
          </div>
          <div className="pc-company-location">
            <span aria-hidden="true">◎</span> TAIPEI, TAIWAN <span>·</span>{" "}
            {zh ? "與全球開發者連結" : "CONNECTED TO WHAT'S NEXT"}
          </div>
        </div>
      </section>

      <section
        className="pc-frame pc-section pc-faq"
        aria-labelledby="faq-title"
      >
        <div>
          <p className="pc-overline">
            {zh ? "常見問題" : "A FEW THINGS TO KNOW"}
          </p>
          <h2 id="faq-title">{zh ? "開始之前。" : "Before you build."}</h2>
          <a className="pc-link" href="/faq">
            {zh ? "更多常見問題" : "More answers"}
            <Arrow />
          </a>
        </div>
        <div className="pc-faq-list">
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="pc-final-cta" aria-labelledby="cta-title">
        <div className="pc-frame">
          <p className="pc-overline">
            {zh ? "下一個可能，由你開始" : "YOUR NEXT POSSIBILITY STARTS HERE"}
          </p>
          <h2 id="cta-title">
            {zh ? (
              <>
                準備好，<em>打造下一個突破。</em>
              </>
            ) : (
              <>
                Let’s build <em>what’s next.</em>
              </>
            )}
          </h2>
          <div className="pc-actions">
            <button type="button" className="pc-button" onClick={openAccess}>
              {zh ? "取得 API 存取" : "Get API access"}
              <Arrow />
            </button>
            <a className="pc-link" href="/contact">
              {zh ? "與我們聊聊" : "Talk to our team"}
              <Arrow diagonal />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
