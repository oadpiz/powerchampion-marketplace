"use client";

/* Vinext uses root-relative anchors for page navigation. */
/* eslint-disable @next/next/no-html-link-for-pages */

import { useState } from "react";
import { MODEL_CATALOG, type ModelDefinition } from "../lib/models";
import { useLocale } from "./locale-provider";

const MODEL_GUIDES: Record<string, {
  endpoint: string;
  input: [string, string];
  output: [string, string];
  useCases: [string, string][];
  integrationNote: [string, string];
}> = {
  "glm-5.2-fp8": {
    endpoint: "/v1/chat/completions",
    input: ["Messages & instructions", "訊息與指令"],
    output: ["Text & tool calls", "文字與工具呼叫"],
    useCases: [["Coding assistants", "程式開發助理"], ["Bilingual customer support", "雙語客服"], ["Multi-step reasoning", "多步驟推理"]],
    integrationNote: ["Use the chat-completions format. Streaming, tool use, reasoning, and structured output are listed in this model’s catalog capabilities.", "使用 Chat Completions 格式。此模型的目錄能力包含串流、工具呼叫、推理與結構化輸出。"],
  },
  "qwen3-vl-30b": {
    endpoint: "/v1/chat/completions",
    input: ["Text & images", "文字與圖片"],
    output: ["Text & structured answers", "文字與結構化回答"],
    useCases: [["Document & invoice understanding", "文件與發票理解"], ["Chart interpretation", "圖表解讀"], ["Image descriptions", "圖片描述"]],
    integrationNote: ["Send text and image content through the chat-completions endpoint. Review the vision example in the documentation for image formatting.", "透過 Chat Completions 端點傳送文字與圖片。圖片格式請參考文件中的視覺模型範例。"],
  },
  "flux-schnell": {
    endpoint: "/v1/images/generations",
    input: ["Text prompt", "文字提示"],
    output: ["Generated image", "生成圖片"],
    useCases: [["Creative concept exploration", "創意概念探索"], ["Marketing image drafts", "行銷圖片草稿"], ["Product moodboards", "產品視覺概念"]],
    integrationNote: ["Use the image-generation endpoint. Billing is per generated image; token-based chat pricing does not apply.", "使用圖像生成端點，依生成圖片數計費，不適用對話模型的 Token 計價。"],
  },
  "chroma1-hd": {
    endpoint: "/v1/images/generations",
    input: ["Text prompt", "文字提示"],
    output: ["Generated image", "生成圖片"],
    useCases: [["Detailed creative imagery", "精緻創意圖像"], ["Campaign visual concepts", "活動視覺概念"], ["Editorial illustration", "編輯插畫"]],
    integrationNote: ["Use the image-generation endpoint. Review output requirements with your application before selecting a model for production.", "使用圖像生成端點。選定正式環境模型前，請以實際應用評估輸出是否符合需求。"],
  },
  "whisper-large-v3": {
    endpoint: "/v1/audio/transcriptions",
    input: ["Audio file", "音訊檔案"],
    output: ["Transcript", "逐字稿"],
    useCases: [["Meeting transcription", "會議轉錄"], ["Subtitle workflows", "字幕製作流程"], ["Searchable audio archives", "可搜尋的音訊資料庫"]],
    integrationNote: ["Upload audio as a multipart request to the transcription endpoint. The published rate is per minute of audio.", "以 Multipart 請求上傳音訊至轉錄端點。刊登費率以每分鐘音訊計算。"],
  },
  "indextts2": {
    endpoint: "/v1/audio/speech",
    input: ["Text & reference audio", "文字與參考音訊"],
    output: ["Generated speech", "生成語音"],
    useCases: [["Product narration", "產品旁白"], ["Audio content workflows", "音訊內容製作"], ["Consistent brand voices", "一致的品牌語音"]],
    integrationNote: ["Reference audio is required for this voice model. Use recordings you have permission to use, and review the speech example before integrating.", "此語音模型需要參考音訊。請使用已取得使用授權的錄音，並先查看文件中的語音範例。"],
  },
  "bge-m3": {
    endpoint: "/v1/embeddings",
    input: ["Text", "文字"],
    output: ["Embedding vectors", "嵌入向量"],
    useCases: [["Multilingual semantic search", "多語言語意搜尋"], ["RAG document indexing", "RAG 文件索引"], ["Content similarity", "內容相似度分析"]],
    integrationNote: ["Generate embeddings for storage in your own search or vector system. Pair with a reranker when your retrieval workflow needs a second ranking stage.", "產生嵌入向量並存入您的搜尋或向量系統。檢索流程需要再次排序時，可搭配重排模型。"],
  },
  "bge-reranker-v2-m3": {
    endpoint: "/v1/rerank",
    input: ["Query & candidate documents", "查詢與候選文件"],
    output: ["Relevance scores", "相關性分數"],
    useCases: [["Retrieval result ranking", "檢索結果排序"], ["RAG context selection", "RAG 上下文篩選"], ["Knowledge-base search", "知識庫搜尋"]],
    integrationNote: ["Submit a query with candidate documents to rerank existing retrieval results. This endpoint returns relevance scores rather than generated chat text.", "提交查詢與候選文件，為現有檢索結果重新排序。此端點回傳相關性分數，而非對話生成文字。"],
  },
};

function Arrow() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

export function ModelDetailContent({ model }: { model: ModelDefinition }) {
  const { locale, copy } = useLocale();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const tr = (en: string, zh: string) => locale === "en" ? en : zh;
  const languageIndex = locale === "en" ? 0 : 1;
  const guide = MODEL_GUIDES[model.id];
  const isChat = guide.endpoint === "/v1/chat/completions";
  const isImage = model.categories.includes("image");
  const isAudio = model.categories.includes("audio");
  const isToken = !isImage && !isAudio;
  const isEmbedding = model.categories.includes("embedding");
  const unit = isImage ? tr("per image", "每張圖片") : isAudio ? tr("per minute of audio", "每分鐘音訊") : tr("per 1M input tokens", "每百萬輸入 Token");
  const related = MODEL_CATALOG.filter((entry) => entry.id !== model.id && entry.categories.some((category) => model.categories.includes(category))).slice(0, 2);
  const integrationsUrl = `/integrations?model=${encodeURIComponent(model.id)}`;
  const outputLabel = ({ "1 image": tr("1 image", "1 張圖片"), transcript: tr("Transcript", "逐字稿"), audio: tr("Audio", "音訊"), vector: tr("Vector", "向量"), scores: tr("Scores", "分數") } as Record<string, string>)[model.maxOutput] ?? model.maxOutput;

  async function copyModelId() {
    try {
      await navigator.clipboard.writeText(model.modelId);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <main className="model-detail-page" id="main-content">
      <nav aria-label={tr("Breadcrumb", "麵包屑導覽")} className="md-breadcrumb">
        <a href="/models">{tr("Model catalog", "模型目錄")}</a><span aria-hidden="true">/</span><span aria-current="page">{model.name}</span>
      </nav>

      <header className="md-header">
        <div className="md-heading">
          <div className="md-category-line">{model.categories.map((category) => <span key={category}>{copy.models[category]}</span>)}</div>
          <h1>{model.name}</h1>
          <p className="md-description">{model.servingRole[locale]}</p>
          <div className="md-model-id"><code translate="no">{model.modelId}</code><button type="button" onClick={copyModelId}>{copyState === "copied" ? tr("Copied", "已複製") : tr("Copy model ID", "複製模型 ID")}</button></div>
          <p className="md-copy-status" role="status">{copyState === "failed" ? tr("Copy is unavailable. Select the model ID above to copy it manually.", "無法自動複製，請選取上方模型 ID 手動複製。") : copyState === "copied" ? tr("Model ID copied to clipboard.", "模型 ID 已複製到剪貼簿。") : ""}</p>
        </div>
        <div className="md-header-actions">
          <a className="md-button md-button-primary" href={integrationsUrl}>{tr("Integrate this model", "串接此模型")}<Arrow /></a>
          {isChat && <a className="md-button" href={`/playground?model=${encodeURIComponent(model.id)}`}>{tr("Open in playground", "開啟試用工作台")}<Arrow /></a>}
          <a className="md-text-link" href={`/compare?models=${encodeURIComponent(model.id)}`}>{tr("Compare models", "比較模型")}<Arrow /></a>
        </div>
      </header>

      <nav className="md-section-nav" aria-label={tr("On this page", "本頁段落")}>
        <a href="#overview">{tr("Overview", "概覽")}</a><a href="#capabilities">{tr("Capabilities", "能力規格")}</a><a href="#integration">{tr("Integration", "API 串接")}</a><a href="#model-pricing">{tr("Pricing", "費率")}</a>
      </nav>

      <div className="md-main-grid">
        <div className="md-main-content">
          <section className="md-section" id="overview" aria-labelledby="md-overview-title">
            <p className="md-eyebrow">{tr("Designed for your workflow", "為您的應用流程而設")}</p>
            <h2 id="md-overview-title">{tr("From input to useful output.", "從輸入到實用的輸出。")}</h2>
            <div className="md-workflow">
              <div><span>{tr("Input", "輸入")}</span><strong>{guide.input[languageIndex]}</strong></div><Arrow /><div className="md-workflow-model"><span>{tr("Model", "模型")}</span><strong>{model.name}</strong></div><Arrow /><div><span>{tr("Output", "輸出")}</span><strong>{guide.output[languageIndex]}</strong></div>
            </div>
            <h3>{tr("Explore these use cases", "適用情境")}</h3>
            <ul className="md-use-cases">{guide.useCases.map((useCase, index) => <li key={useCase[0]}><span>{String(index + 1).padStart(2, "0")}</span>{useCase[languageIndex]}</li>)}</ul>
          </section>

          <section className="md-section" id="capabilities" aria-labelledby="md-capabilities-title">
            <div className="md-section-heading"><h2 id="md-capabilities-title">{tr("Model capabilities", "模型能力")}</h2><span>{tr("Published catalog", "已刊登目錄")}</span></div>
            <dl className="md-spec-list">
              <div><dt>{tr("Context window", "上下文長度")}</dt><dd>{model.context === "—" ? tr("Not applicable", "不適用") : model.context}</dd></div>
              <div><dt>{tr("Maximum output", "最大輸出")}</dt><dd>{outputLabel}</dd></div>
              <div><dt>{tr("Serving region", "服務區域")}</dt><dd>{model.region === "TH" ? tr("Thailand · TH", "泰國 · TH") : model.region ?? tr("Not published", "尚未刊登")}</dd></div>
              {([
                ["streaming", tr("Streaming", "串流輸出")],
                ["tools", tr("Tool use", "工具呼叫")],
                ["structuredOutput", tr("Structured output", "結構化輸出")],
                ["reasoning", tr("Reasoning", "推理")],
              ] as const).map(([feature, label]) => <div key={feature}><dt>{label}</dt><dd className={model.features[feature] ? "md-supported" : ""}>{model.features[feature] ? tr("Supported", "支援") : tr("Not listed", "未列入目錄能力")}</dd></div>)}
            </dl>
            <p className="md-note">{tr("Catalog specifications describe the model configuration. Check service status before sending requests.", "目錄規格描述模型配置，送出請求前請查看即時服務狀態。")}</p>
          </section>

          <section className="md-section" id="integration" aria-labelledby="md-integration-title">
            <h2 id="md-integration-title">{tr("Build with this model", "開始串接此模型")}</h2>
            <p>{guide.integrationNote[languageIndex]}</p>
            <dl className="md-endpoint-list">
              <div><dt>{tr("API base URL", "API 基礎網址")}</dt><dd><code>https://b300.powerchampion.ai/v1</code></dd></div>
              <div><dt>{tr("Endpoint", "端點")}</dt><dd><span className="md-method">POST</span><code>{guide.endpoint}</code></dd></div>
              <div><dt>{tr("Authentication", "驗證方式")}</dt><dd><code>Authorization: Bearer YOUR_API_KEY</code></dd></div>
            </dl>
            <a className="md-button" href={integrationsUrl}>{tr("Configure an integration", "設定串接範例")}<Arrow /></a>
          </section>
        </div>

        <aside className="md-sidebar">
          <section className="md-pricing-panel" id="model-pricing" aria-labelledby="md-pricing-title">
            <div className="md-panel-heading"><h2 id="md-pricing-title">{tr("Usage pricing", "用量計費")}</h2><span>USD</span></div>
            <div className="md-price"><strong>${model.inputPerMillion.toFixed(2)}</strong><span>{unit}</span></div>
            {isToken && !isEmbedding && <div className="md-price md-output-price"><strong>${model.outputPerMillion.toFixed(2)}</strong><span>{tr("per 1M output tokens", "每百萬輸出 Token")}</span></div>}
            <p>{tr("Pay for usage from your prepaid API balance.", "依實際用量從預付 API 餘額扣款。")}</p>
            <a className="md-text-link" href="/pricing">{tr("Estimate costs & view credits", "估算費用與查看點數方案")}<Arrow /></a>
            <div className="md-status-note"><span>{tr("Service availability", "服務可用狀態")}</span><a href="/status">{tr("Check live status", "查看即時狀態")}<Arrow /></a></div>
          </section>
          <section className="md-get-started" aria-labelledby="md-access-title"><h2 id="md-access-title">{tr("Need an API key?", "需要 API 金鑰？")}</h2><p>{tr("Request access, add prepaid credit, then connect your application.", "申請存取權、加值預付點數，再串接您的應用程式。")}</p><button className="md-button" type="button" onClick={() => window.dispatchEvent(new Event("powerchampion:launch-access"))}>{tr("Request API access", "申請 API 存取權")}<Arrow /></button><a className="md-text-link" href="/docs">{tr("Read the documentation", "閱讀技術文件")}<Arrow /></a></section>
        </aside>
      </div>

      {related.length > 0 && <section className="md-related" aria-labelledby="md-related-title"><div className="md-section-heading"><h2 id="md-related-title">{tr("Also in the catalog", "探索相關模型")}</h2><a href="/models">{tr("All models", "所有模型")}<Arrow /></a></div><div className="md-related-grid">{related.map((entry) => <a href={`/models/${entry.id}`} key={entry.id}><span className="md-related-name">{entry.name}<Arrow /></span><p>{entry.servingRole[locale]}</p><code translate="no">{entry.modelId}</code></a>)}</div></section>}
    </main>
  );
}
