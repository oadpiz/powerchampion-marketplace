"use client";

import { useState } from "react";
import { MODEL_CATALOG } from "../lib/models";
import { CREDIT_PACKS, calculateUsageCost } from "../lib/pricing";
import { useLocale } from "./locale-provider";
import { openLaunchAccess } from "./demo-checkout";

const applications = [
  {
    id: "assistants",
    symbol: "↗",
    label: { en: "Intelligent assistants", zh: "智慧助理" },
    title: {
      en: "Turn a conversation into progress.",
      zh: "讓每次對話，都帶來進展。",
    },
    description: {
      en: "Build product assistants, draft content, and help teams work through complex questions. Connect a reasoning model to the context and tools in your own application.",
      zh: "打造產品助理、草擬內容，協助團隊拆解複雜問題。將推理模型接入應用程式中的資料與工具，完成你的產品流程。",
    },
    audience: {
      en: "SaaS teams · Product developers · Internal tools",
      zh: "SaaS 團隊 · 產品開發者 · 內部工具",
    },
    input: { en: "A question + your context", zh: "問題與應用情境" },
    output: { en: "A useful, structured response", zh: "實用、有條理的回應" },
    models: ["glm-5.2-fp8"],
    capability: { en: "REASONING & LANGUAGE", zh: "推理與語言" },
  },
  {
    id: "documents",
    symbol: "◈",
    label: { en: "Document intelligence", zh: "文件理解" },
    title: {
      en: "Give your application a new perspective.",
      zh: "讓應用程式，看懂更多。",
    },
    description: {
      en: "Interpret images, explore visual details, and make document workflows more useful. Bring visual understanding into review tools, research products, and knowledge applications.",
      zh: "理解影像、辨識視覺細節，改善文件處理流程。將視覺理解能力導入審閱工具、研究產品與知識應用。",
    },
    audience: {
      en: "Knowledge teams · Research tools · Operations",
      zh: "知識團隊 · 研究工具 · 營運流程",
    },
    input: { en: "An image + a question", zh: "影像與提問" },
    output: {
      en: "Description, context, understanding",
      zh: "描述、脈絡與理解",
    },
    models: ["qwen3-vl-30b"],
    capability: { en: "VISION & LANGUAGE", zh: "視覺與語言" },
  },
  {
    id: "creative",
    symbol: "✳",
    label: { en: "Creative & voice tools", zh: "創作與語音" },
    title: { en: "Move beyond the text box.", zh: "創作，不只是一段文字。" },
    description: {
      en: "Generate visual concepts, turn recordings into text, or bring written content to life with speech. Select a purpose-built image or audio model for each part of your workflow.",
      zh: "生成視覺概念、將錄音轉成文字，或讓書面內容開口說話。依流程需要，選用專門的圖像或音訊模型。",
    },
    audience: {
      en: "Creative studios · Content platforms · Voice products",
      zh: "創意工作室 · 內容平台 · 語音產品",
    },
    input: { en: "A prompt, recording, or script", zh: "提示詞、錄音或腳本" },
    output: { en: "An image, transcript, or voice", zh: "圖片、逐字稿或語音" },
    models: ["flux-schnell", "whisper-large-v3", "indextts2"],
    capability: { en: "IMAGE & AUDIO", zh: "圖像與音訊" },
  },
  {
    id: "knowledge",
    symbol: "⌘",
    label: { en: "Search & knowledge", zh: "搜尋與知識" },
    title: { en: "Find the context that matters.", zh: "找到真正相關的資訊。" },
    description: {
      en: "Build semantic search and retrieval pipelines with embeddings and reranking. Pair retrieved passages with a language model in your application to create a knowledge assistant.",
      zh: "以向量嵌入與重排序，建立語意搜尋及檢索流程。在你的應用程式中，將檢索內容交給語言模型，打造知識助理。",
    },
    audience: {
      en: "Enterprise search · RAG applications · Knowledge bases",
      zh: "企業搜尋 · RAG 應用 · 知識庫",
    },
    input: { en: "Your documents + a query", zh: "文件與搜尋問題" },
    output: { en: "Relevant, ranked passages", zh: "依相關性排序的內容" },
    models: ["bge-m3", "bge-reranker-v2-m3"],
    capability: { en: "EMBEDDINGS & RERANKING", zh: "向量嵌入與重排序" },
  },
];

export function ApplicationExplorer() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [activeId, setActiveId] = useState("assistants");
  const active = applications.find((item) => item.id === activeId)!;

  return (
    <section className="ps-applications" aria-labelledby="applications-title">
      <div className="pc-frame pc-section">
        <div className="pc-section-heading">
          <div>
            <p className="pc-overline">
              <span className="pc-section-number">02 /</span>
              {zh ? "從模型，到你的產品" : "FROM MODELS TO YOUR PRODUCT"}
            </p>
            <h2 id="applications-title">
              {zh ? (
                <>
                  你的下一個產品，
                  <br />
                  <em>可以做到更多。</em>
                </>
              ) : (
                <>
                  Your next product.
                  <br />
                  <em>More possibilities.</em>
                </>
              )}
            </h2>
          </div>
          <div className="pc-section-aside">
            <p>
              {zh
                ? "從開發者的第一個原型，到團隊每天使用的工具。依照實際任務，找到合適的模型能力。"
                : "From a developer’s first prototype to the tools a team uses every day. Start with the task, then find the right model."}
            </p>
          </div>
        </div>
        <div className="ps-app-layout">
          <div
            className="ps-app-options"
            role="group"
            aria-label={zh ? "探索應用情境" : "Explore applications"}
          >
            {applications.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={activeId === item.id}
                aria-controls="application-detail"
                onClick={() => setActiveId(item.id)}
              >
                <span className="ps-option-number">0{i + 1}</span>
                <span>{item.label[locale]}</span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          <div
            className="ps-app-detail"
            id="application-detail"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="ps-app-copy">
              <p className="ps-kicker">{active.audience[locale]}</p>
              <h3>{active.title[locale]}</h3>
              <p>{active.description[locale]}</p>
            </div>
            <div className="ps-workflow">
              <div className="ps-workflow-end">
                <span>{zh ? "輸入" : "INPUT"}</span>
                <p>{active.input[locale]}</p>
              </div>
              <div className="ps-workflow-connector" aria-hidden="true">
                ↓
              </div>
              <div className="ps-workflow-core">
                <span aria-hidden="true">{active.symbol}</span>
                <div>
                  <strong>Power Champion</strong>
                  <small>{active.capability[locale]}</small>
                </div>
              </div>
              <div className="ps-workflow-connector" aria-hidden="true">
                ↓
              </div>
              <div className="ps-workflow-end">
                <span>{zh ? "輸出" : "OUTPUT"}</span>
                <p>{active.output[locale]}</p>
              </div>
            </div>
            <div className="ps-app-models">
              <span>{zh ? "探索相關模型" : "EXPLORE THE MODELS"}</span>
              <div>
                {active.models.map((id) => (
                  <a key={id} href={`/models#${id}`}>
                    {MODEL_CATALOG.find((model) => model.id === id)?.name}
                    <span aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
        <p className="ps-disclaimer">
          {zh
            ? "以上為應用流程示意。需自行整合應用程式；各模型的支援功能與可用狀態，請參考文件及服務狀態頁。"
            : "Illustrative application patterns. Integration is required; see the documentation and service status for supported capabilities and availability."}
        </p>
      </div>
    </section>
  );
}

export function ModelServiceDetails() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const starter = CREDIT_PACKS.find((pack) => pack.id === "starter")!;
  const [estimateId, setEstimateId] = useState("glm-5.2-fp8");
  const estimateModels = MODEL_CATALOG.filter(
    (model) => model.id === "glm-5.2-fp8" || model.id === "qwen3-vl-30b",
  );
  const model = estimateModels.find((item) => item.id === estimateId)!;
  const cost = calculateUsageCost(1_000_000, 250_000, model);
  const inclusions = zh
    ? [
        [
          "精選模型存取",
          "以客戶專屬 API 金鑰，使用支援的文字、視覺、圖像、語音與檢索端點。",
        ],
        [
          "一份預付餘額",
          "依模型實際使用單位扣款。透過兌換碼加值，並在餘額頁查詢可用金額。",
        ],
        [
          "文件與整合支援",
          "提供模型識別碼、範例請求與端點說明；有特殊需求可直接與團隊討論。",
        ],
      ]
    : [
        [
          "Access to a curated model catalog",
          "A customer-specific API key for supported text, vision, image, speech, and retrieval endpoints.",
        ],
        [
          "One prepaid balance",
          "Usage is deducted at each model’s published rate. Top up with redeem codes and check your remaining credit in the balance console.",
        ],
        [
          "Documentation and integration support",
          "Model IDs, request examples, and endpoint guidance. Talk to our team when your application needs a more tailored setup.",
        ],
      ];

  return (
    <section
      className="pc-frame pc-section ps-commercial"
      aria-labelledby="model-service-title"
    >
      <div className="pc-section-heading">
        <div>
          <p className="pc-overline">
            <span className="pc-section-number">04 /</span>
            {zh ? "清楚的服務，透明的計費" : "CLEAR SERVICE. CLEAR PRICING."}
          </p>
          <h2 id="model-service-title">
            {zh ? (
              <>
                知道你買什麼。
                <br />
                <em>掌握每次使用。</em>
              </>
            ) : (
              <>
                Know what you’re buying.
                <br />
                <em>Make every call count.</em>
              </>
            )}
          </h2>
        </div>
        <div className="pc-section-aside">
          <p>
            {zh
              ? "購買託管模型 API 的使用額度，從小額測試開始，再依需求增加用量。"
              : "Purchase credit for hosted model API usage. Start with a small experiment, then add capacity as your product takes shape."}
          </p>
          <a className="pc-link" href="/pricing">
            {zh ? "查看所有費率與儲值方案" : "View all rates & credit packs"}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
      <div className="ps-service-layout">
        <div className="ps-inclusions">
          <p className="ps-kicker">
            {zh ? "模型 API 服務包含" : "YOUR MODEL API SERVICE"}
          </p>
          {inclusions.map(([title, detail], index) => (
            <article key={title}>
              <span className="ps-inclusion-number">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{detail}</p>
              </div>
            </article>
          ))}
          <div className="ps-service-links">
            <button
              type="button"
              className="pc-button"
              onClick={() => openLaunchAccess()}
            >
              {zh ? "申請模型 API" : "Request model API access"}
              <span aria-hidden="true">↗</span>
            </button>
            <a className="pc-link" href="/console">
              {zh ? "查詢 API 餘額" : "Check API balance"}
              <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
        <div className="ps-credit-example">
          <div className="ps-example-header">
            <span>{zh ? "使用費用試算" : "A USAGE ILLUSTRATION"}</span>
            <span>USD</span>
          </div>
          <div className="ps-starting-credit">
            <span>{zh ? "入門儲值方案" : "Starter credit pack"}</span>
            <strong>
              <small>$</small>
              {starter.price}
              <span>.00</span>
            </strong>
            <p>
              {zh
                ? `取得 US$${starter.credit.toFixed(2)} API 額度`
                : `US$${starter.credit.toFixed(2)} in API credit`}
            </p>
          </div>
          <label className="ps-estimate-select">
            {zh ? "選擇模型查看範例" : "Select a model to see an example"}
            <select
              value={estimateId}
              onChange={(event) => setEstimateId(event.target.value)}
            >
              {estimateModels.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <dl className="ps-cost-lines">
            <div>
              <dt>
                {zh ? "1,000,000 個輸入 Token" : "1,000,000 input tokens"}
              </dt>
              <dd>${model.inputPerMillion.toFixed(2)}</dd>
            </div>
            <div>
              <dt>{zh ? "250,000 個輸出 Token" : "250,000 output tokens"}</dt>
              <dd>${(model.outputPerMillion * 0.25).toFixed(2)}</dd>
            </div>
            <div className="ps-cost-total">
              <dt>{zh ? "範例使用費用" : "Example usage cost"}</dt>
              <dd aria-live="polite">${cost.toFixed(2)}</dd>
            </div>
          </dl>
          <p className="ps-example-note">
            {zh
              ? "依已刊登費率試算，並非即時帳戶資料。實際費用取決於模型與用量；圖像、音訊採各自的計費單位。"
              : "Calculated from published rates, not a live account balance. Actual cost depends on model and usage; images and audio have separate billing units."}
          </p>
        </div>
      </div>
      <div className="ps-getting-started">
        <p className="ps-kicker">
          {zh ? "從申請到第一次呼叫" : "FROM REQUEST TO FIRST CALL"}
        </p>
        <ol>
          {(zh
            ? [
                ["申請金鑰", "提供用途與預估用量，取得金鑰及儲值說明。"],
                ["加入 API 額度", "選擇儲值方案，以兌換碼加入預付餘額。"],
                ["串接模型", "設定端點與模型 ID，依文件送出請求。"],
                ["查看並補充餘額", "查詢可用金額，隨需求補充 API 額度。"],
              ]
            : [
                [
                  "Request a key",
                  "Share your use case and volume; receive your key and top-up instructions.",
                ],
                [
                  "Add API credit",
                  "Choose a credit pack and add prepaid balance with a redeem code.",
                ],
                [
                  "Connect a model",
                  "Set your endpoint and model ID, then make a documented API request.",
                ],
                [
                  "Check and refill",
                  "Check your available balance and add credit as your usage grows.",
                ],
              ]
          ).map(([title, detail], i) => (
            <li key={title}>
              <span>0{i + 1}</span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
