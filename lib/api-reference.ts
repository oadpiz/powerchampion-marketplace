/**
 * Customer-facing developer guide for the b300 gateway (/docs/api).
 *
 * Content follows the "Power Champion API 開發者手冊" version 1.0
 * (API_REFERENCE_AS_OF), which was fact-checked against production. Prices
 * are a snapshot of https://b300.powerchampion.ai/catalog.json; the catalog
 * stays the authority and the page says so. Live model readiness comes from
 * /status.json at render time.
 *
 * Inline markup in any copy string: `code`, **bold** and [label](href).
 */
import type { Locale } from "./content";

export const API_REFERENCE_AS_OF = "2026-10-20";
export const API_REFERENCE_VERSION = "1.0";
export const API_BASE_URL = "https://b300.powerchampion.ai/v1";
export const GATEWAY_URL = "https://b300.powerchampion.ai";
export const SUPPORT_EMAIL = "info@powerchampion.org";

/** All nine public models, in the order the guide lists them. */
export const API_REFERENCE_MODEL_IDS = [
  "glm-5.2-fp8",
  "glm-5.3-flash-uncensored",
  "qwen3-vl-30b",
  "bge-m3",
  "bge-reranker-v2-m3",
  "flux-schnell",
  "chroma1-hd",
  "indextts2",
  "whisper-large-v3",
] as const;

export type ApiReferenceModelId = (typeof API_REFERENCE_MODEL_IDS)[number];

export type CodeLanguage = "bash" | "python" | "javascript" | "json" | "http";

/** One row of a models table: the id is the row header, a live status cell is appended. */
export type ApiReferenceModelRow = { id: ApiReferenceModelId; cells: string[] };

export type ApiReferenceBlock =
  | { kind: "p"; text: string }
  | { kind: "note"; text: string }
  | { kind: "h3"; id: string; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; label: string; head: string[]; rows: string[][] }
  | { kind: "code"; label: CodeLanguage; code: string }
  | { kind: "models"; label: string; head: string[]; rows: ApiReferenceModelRow[]; wide?: boolean; statusNote?: boolean };

export type ApiReferenceSection = {
  id: string;
  title: string;
  blocks: ApiReferenceBlock[];
};

export type ApiReferenceCopy = {
  kicker: string;
  title: string;
  lead: string;
  version: string;
  backToDocs: string;
  tocLabel: string;
  tableScrollHint: string;
  models: {
    statusHead: string;
    online: string;
    offline: string;
    unknown: string;
    liveNote: string;
    fallbackNote: string;
  };
  sections: ApiReferenceSection[];
};

const STATUS_JSON = `${GATEWAY_URL}/status.json`;
const CATALOG_JSON = `${GATEWAY_URL}/catalog.json`;
const MAIL = `[${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL})`;

/* ------------------------------------------------------------------ */
/* Code samples. Natural-language strings inside them are localized;   */
/* everything else is identical in both languages.                     */
/* ------------------------------------------------------------------ */

type SampleText = {
  hello: string;
  helloReply: string;
  streamPrompt: string;
  weatherDescription: string;
  weatherQuestion: string;
  visionPrompt: string;
  personaName: string;
  completionPrompt: string;
  embedInputs: [string, string];
  embedComment: string;
  rerankQuery: string;
  rerankDocs: [string, string, string];
  imagePrompt: string;
  redeemCode: string;
  retryPrompt: string;
};

const SAMPLES_ZH: SampleText = {
  hello: "用一句話介紹台北。",
  helloReply: "台北是台灣的首都，…",
  streamPrompt: "列出三個台南景點",
  weatherDescription: "查詢城市天氣",
  weatherQuestion: "台中現在天氣如何？",
  visionPrompt: "列出這張發票的品項與金額",
  personaName: "客服助理",
  completionPrompt: "台灣最高的山是",
  embedInputs: ["台北捷運營運時間", "高鐵票價查詢"],
  embedComment: "每個 1,024 維",
  rerankQuery: "如何申請退款",
  rerankDocs: ["退款需於 7 天內申請", "運費依重量計算", "會員可累積點數"],
  imagePrompt: "晨光下的九份老街，寫實攝影風格",
  redeemCode: "<兌換碼>",
  retryPrompt: "你好",
};

const SAMPLES_EN: SampleText = {
  hello: "Describe Taipei in one sentence.",
  helloReply: "Taipei is the capital of Taiwan, …",
  streamPrompt: "List three sights in Tainan",
  weatherDescription: "Look up the weather for a city",
  weatherQuestion: "What's the weather in Taichung right now?",
  visionPrompt: "List the items and amounts on this invoice",
  personaName: "Support assistant",
  completionPrompt: "The highest mountain in Taiwan is",
  embedInputs: ["Taipei Metro operating hours", "High-speed rail fares"],
  embedComment: "1,024 dimensions each",
  rerankQuery: "How do I request a refund?",
  rerankDocs: ["Refunds must be requested within 7 days", "Shipping is charged by weight", "Members earn points"],
  imagePrompt: "Jiufen Old Street in morning light, photorealistic",
  redeemCode: "<redeem code>",
  retryPrompt: "Hello",
};

function samples(t: SampleText) {
  return {
    exportKey: `export PC_API_KEY="sk-b300-..."`,

    curlChat: `curl ${API_BASE_URL}/chat/completions \\
  -H "Authorization: Bearer $PC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "glm-5.2-fp8",
    "messages": [{"role": "user", "content": "${t.hello}"}],
    "max_tokens": 512
  }'`,

    pythonChat: `import os
from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE_URL}",
    api_key=os.environ["PC_API_KEY"],
)

resp = client.chat.completions.create(
    model="glm-5.2-fp8",
    messages=[{"role": "user", "content": "${t.hello}"}],
    max_tokens=512,
)
print(resp.choices[0].message.content)
print(resp.usage)`,

    nodeChat: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${API_BASE_URL}",
  apiKey: process.env.PC_API_KEY,
});

const resp = await client.chat.completions.create({
  model: "glm-5.2-fp8",
  messages: [{ role: "user", content: "${t.hello}" }],
  max_tokens: 512,
});
console.log(resp.choices[0].message.content);`,

    chatResponse: `{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1792483207,
  "model": "glm-5.2-fp8",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "${t.helloReply}" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 14, "completion_tokens": 27, "total_tokens": 41 }
}`,

    authHeader: `Authorization: Bearer sk-b300-...`,

    curlModels: `curl ${API_BASE_URL}/models \\
  -H "Authorization: Bearer $PC_API_KEY"`,

    pythonStream: `stream = client.chat.completions.create(
    model="glm-5.2-fp8",
    messages=[{"role": "user", "content": "${t.streamPrompt}"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)`,

    pythonTools: `tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "${t.weatherDescription}",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

resp = client.chat.completions.create(
    model="glm-5.2-fp8",
    messages=[{"role": "user", "content": "${t.weatherQuestion}"}],
    tools=tools,
)
call = resp.choices[0].message.tool_calls[0]
print(call.function.name, call.function.arguments)`,

    pythonVision: `import base64

with open("invoice.jpg", "rb") as f:
    b64 = base64.b64encode(f.read()).decode()

resp = client.chat.completions.create(
    model="qwen3-vl-30b",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "${t.visionPrompt}"},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ],
    }],
)`,

    personaResponse: `{
  "persona_id": "...",
  "name": "${t.personaName}",
  "rev": 3,
  "updated": "...",
  "messages_prefix": [{ "role": "system", "content": "..." }]
}`,

    curlCompletions: `curl ${API_BASE_URL}/completions \\
  -H "Authorization: Bearer $PC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "glm-5.2-fp8", "prompt": "${t.completionPrompt}", "max_tokens": 32}'`,

    pythonEmbeddings: `resp = client.embeddings.create(
    model="bge-m3",
    input=["${t.embedInputs[0]}", "${t.embedInputs[1]}"],
    encoding_format="float",
)
vectors = [d.embedding for d in resp.data]  # ${t.embedComment}`,

    curlRerank: `curl ${API_BASE_URL}/rerank \\
  -H "Authorization: Bearer $PC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "bge-reranker-v2-m3",
    "query": "${t.rerankQuery}",
    "documents": ["${t.rerankDocs[0]}", "${t.rerankDocs[1]}", "${t.rerankDocs[2]}"],
    "top_n": 2
  }'`,

    rerankResponse: `{
  "id": "rerank-...",
  "model": "bge-reranker-v2-m3",
  "results": [
    { "index": 0, "relevance_score": 0.9821 },
    { "index": 2, "relevance_score": 0.0137 }
  ],
  "usage": { "total_tokens": 46 }
}`,

    pythonImages: `import base64

resp = client.images.generate(
    model="flux-schnell",
    prompt="${t.imagePrompt}",
    size="1024x1024",
    n=1,
    extra_body={"seed": 7},
)
with open("jiufen.png", "wb") as f:
    f.write(base64.b64decode(resp.data[0].b64_json))`,

    imagesResponse: `{
  "created": 1792483207,
  "data": [{ "b64_json": "iVBORw0KGgo...", "media_type": "image/png" }],
  "seed": 7,
  "steps": 4,
  "model": "flux-schnell",
  "guidance_scale": 0.0,
  "usage": { "prompt_tokens": 0, "completion_tokens": 1000, "total_tokens": 1000 }
}`,

    // The speech and transcription samples stay in Chinese in both languages:
    // they show Chinese audio in and out, which is what the guide documents.
    curlSpeech: `curl ${API_BASE_URL}/audio/speech \\
  -H "Authorization: Bearer $PC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "indextts2",
    "input": "您好，歡迎來電，請問有什麼可以為您服務？",
    "voice": "<音色 id>",
    "instruct": "親切、溫和",
    "emo_alpha": 0.6
  }' \\
  --output greeting.mp3`,

    curlTranscribe: `curl ${API_BASE_URL}/audio/transcriptions \\
  -H "Authorization: Bearer $PC_API_KEY" \\
  -F file=@meeting.mp3 \\
  -F model=whisper-large-v3 \\
  -F language=zh`,

    transcribeResponse: `{
  "text": "今天的會議重點有三個…",
  "language": "zh",
  "duration": 42.6,
  "usage": { "prompt_tokens": 0, "completion_tokens": 2130, "total_tokens": 2130 }
}`,

    curlRedeem: `curl ${API_BASE_URL}/redeem \\
  -H "Authorization: Bearer $PC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"code": "${t.redeemCode}"}'`,

    redeemResponse: `{ "ok": true, "credited_nano_usd": 10000000000, "new_balance_nano_usd": 12345000000 }`,

    curlSubscription: `curl ${GATEWAY_URL}/dashboard/billing/subscription \\
  -H "Authorization: Bearer $PC_API_KEY"`,

    subscriptionResponse: `{
  "object": "billing_subscription",
  "has_payment_method": true,
  "hard_limit_usd": 8.42,
  "system_hard_limit_usd": 8.42,
  "access_until": null,
  "plan": { "title": "prepaid", "remaining_usd": 8.42 }
}`,

    errorResponse: `{
  "error": {
    "message": "Rate limit exceeded (60/min) for this key.",
    "type": "rate_limit_error",
    "param": null,
    "code": null
  }
}`,

    pythonRetry: `import random, time
from openai import APIStatusError

RETRYABLE = {429, 502, 503}

def with_retry(call, attempts=4):
    for i in range(attempts):
        try:
            return call()
        except APIStatusError as e:
            if e.status_code not in RETRYABLE or i == attempts - 1:
                raise
            wait = e.response.headers.get("retry-after")
            time.sleep(float(wait) if wait else 2 ** i + random.random())

resp = with_retry(lambda: client.chat.completions.create(
    model="glm-5.2-fp8",
    messages=[{"role": "user", "content": "${t.retryPrompt}"}],
))`,
  };
}

const ZH_CODE = samples(SAMPLES_ZH);
const EN_CODE = samples(SAMPLES_EN);

/* ------------------------------------------------------------------ */
/* Traditional Chinese                                                 */
/* ------------------------------------------------------------------ */

const ZH: ApiReferenceCopy = {
  kicker: "開發者文件",
  title: "Power Champion API 開發者手冊",
  lead: "與 OpenAI 相容的 HTTPS API 完整說明：驗證與金鑰、模型與價格、各端點參數、帳務、限流與錯誤處理。",
  version: `版本 ${API_REFERENCE_VERSION} · ${API_REFERENCE_AS_OF}`,
  backToDocs: "回到快速開始",
  tocLabel: "本頁內容",
  tableScrollHint: "表格可左右滑動查看所有欄位。",
  models: {
    statusHead: "目前狀態",
    online: "上線中",
    offline: "離線",
    unknown: "未知",
    liveNote: "「目前狀態」取自即時狀態資料，約每分鐘更新一次。",
    fallbackNote: "目前無法載入即時狀態，呼叫模型前請先查看服務狀態。",
  },
  sections: [
    {
      id: "overview",
      title: "1. 概覽",
      blocks: [
        { kind: "p", text: "Power Champion API 提供與 OpenAI 相容的 HTTPS 介面，用一把金鑰就能呼叫對話、視覺、向量、重排序、圖片生成、語音合成與語音辨識。既有的 OpenAI SDK 只要更換 `base_url` 與金鑰即可使用。" },
        {
          kind: "table",
          label: "服務基本資訊",
          head: ["項目", "內容"],
          rows: [
            ["文件版本", `${API_REFERENCE_VERSION}（${API_REFERENCE_AS_OF}）`],
            ["適用環境", "生產環境"],
            ["Base URL", `\`${API_BASE_URL}\``],
            ["傳輸協定", "僅 HTTPS"],
            ["請求格式", "JSON（`Content-Type: application/json`）；語音辨識為 `multipart/form-data`"],
            ["字元編碼", "UTF-8"],
            ["計價幣別", "美元（USD），預付制"],
            ["線上版本", "[powerchampion.ai/docs/api](/docs/api)"],
          ],
        },
        { kind: "h3", id: "capabilities", text: "支援的能力" },
        {
          kind: "table",
          label: "支援的能力",
          head: ["能力", "端點", "模型"],
          rows: [
            ["對話與推理", "`POST /v1/chat/completions`", "glm-5.2-fp8、glm-5.3-flash-uncensored"],
            ["視覺理解", "`POST /v1/chat/completions`", "qwen3-vl-30b"],
            ["文字補全", "`POST /v1/completions`", "對話類模型"],
            ["文字向量", "`POST /v1/embeddings`", "bge-m3"],
            ["文件重排序", "`POST /v1/rerank`", "bge-reranker-v2-m3"],
            ["圖片生成", "`POST /v1/images/generations`", "flux-schnell、chroma1-hd"],
            ["語音合成", "`POST /v1/audio/speech`", "indextts2"],
            ["語音辨識", "`POST /v1/audio/transcriptions`", "whisper-large-v3"],
          ],
        },
        { kind: "h3", id: "conventions", text: "文件慣例" },
        {
          kind: "ul",
          items: [
            "「必填」欄位缺少時回 400 或 404；「選填」欄位省略時使用預設值。",
            "範例中的 `$PC_API_KEY` 代表你的金鑰，請放在環境變數，不要寫進程式碼。",
            "金額以美元表示；帳務端點另以奈美元（10⁻⁹ 美元）回傳精確值。",
            "時間一律是 UTC。每日額度於 UTC 00:00（台灣時間 08:00）重置。",
            `模型是否在線以[服務狀態](${STATUS_JSON})為準，本手冊不保證特定模型隨時可用。`,
          ],
        },
      ],
    },
    {
      id: "quick-start",
      title: "2. 快速開始",
      blocks: [
        { kind: "p", text: "三個步驟完成第一個請求：取得金鑰、設定環境變數、送出請求。" },
        {
          kind: "ol",
          items: [
            `**取得金鑰**：寄信至 ${MAIL} 申請。金鑰以 \`sk-b300-\` 開頭，由我們簽發後寄給你；平台只保存雜湊值，無法找回，請妥善保存。`,
            "**儲值**：購買儲值包後會收到兌換碼，用 `POST /v1/redeem` 入帳（見[第 9 節](#billing)）。",
            "**設定環境變數**：",
          ],
        },
        { kind: "code", label: "bash", code: ZH_CODE.exportKey },
        { kind: "h3", id: "quick-start-curl", text: "curl" },
        { kind: "code", label: "bash", code: ZH_CODE.curlChat },
        { kind: "h3", id: "quick-start-python", text: "Python" },
        { kind: "p", text: "安裝：`pip install openai`。" },
        { kind: "code", label: "python", code: ZH_CODE.pythonChat },
        { kind: "h3", id: "quick-start-node", text: "Node.js" },
        { kind: "p", text: "安裝：`npm install openai`。需 Node.js 18 以上，並以 ESM 執行（副檔名 `.mjs`，或在 `package.json` 設 `\"type\": \"module\"`）。" },
        { kind: "code", label: "javascript", code: ZH_CODE.nodeChat },
        { kind: "h3", id: "quick-start-response", text: "成功回應" },
        { kind: "code", label: "json", code: ZH_CODE.chatResponse },
        { kind: "note", text: `若收到 502，表示該模型暫時離線。請先查[服務狀態](${STATUS_JSON})，改用 \`ready\` 為 \`true\` 的模型。` },
      ],
    },
    {
      id: "auth",
      title: "3. 驗證與金鑰管理",
      blocks: [
        { kind: "p", text: "所有 `/v1/*` 與 `/dashboard/billing/*` 請求都要在標頭帶上 Bearer 金鑰，平台不接受其他驗證方式。" },
        { kind: "code", label: "http", code: ZH_CODE.authHeader },
        {
          kind: "table",
          label: "金鑰說明",
          head: ["項目", "說明"],
          rows: [
            ["格式", "`sk-b300-` 加 43 個字元"],
            ["保存方式", "平台只保存雜湊值，無法找回原始金鑰；遺失請申請新金鑰"],
            ["簽發與停用", "由 Power Champion 作業，目前沒有自助申請或撤銷 API"],
            ["使用範圍", "只能在伺服器端使用；平台不開放 CORS，瀏覽器端的程式無法直接呼叫"],
            ["受限金鑰", "部分金鑰只授權特定模型並設有到期日，超出範圍或過期時回 403"],
          ],
        },
        { kind: "h3", id: "auth-errors", text: "驗證失敗的回應" },
        {
          kind: "table",
          label: "驗證失敗的回應",
          head: ["狀態碼", "訊息", "處理方式"],
          rows: [
            ["401", "`Missing bearer token. Send: Authorization: Bearer <key>`", "確認標頭名稱與 `Bearer ` 前綴"],
            ["401", "`Invalid API key.`", "金鑰錯誤或已停用，請聯絡我們"],
            ["403", "`Reviewer API key is not permitted for this endpoint or model.`", "受限金鑰超出授權範圍或已到期"],
          ],
        },
        { kind: "h3", id: "key-security", text: "金鑰安全" },
        {
          kind: "ul",
          items: [
            "每個環境（開發、測試、正式）使用不同金鑰，出問題時可以單獨停用。",
            "金鑰只放在環境變數或密鑰管理服務，不要提交到版控、不要寫進前端。",
            `懷疑外洩時，立即寄信到 ${MAIL} 停用並重新簽發。`,
          ],
        },
      ],
    },
    {
      id: "models",
      title: "4. 模型目錄與價格",
      blocks: [
        { kind: "p", text: `生產環境開放 9 個模型。下表價格為 ${API_REFERENCE_AS_OF} 的牌價，權威來源是公開的 [catalog.json](${CATALOG_JSON})，兩者不一致時以 catalog.json 為準。` },
        { kind: "h3", id: "models-language", text: "語言與視覺模型" },
        {
          kind: "models",
          label: "語言與視覺模型",
          wide: true,
          head: ["模型 id", "用途", "上下文", "單次輸出上限", "輸入（US$／百萬 token）", "輸出（US$／百萬 token）", "功能"],
          rows: [
            { id: "glm-5.2-fp8", cells: ["對話、推理、程式", "131,072", "32,768", "0.93", "3.00", "工具呼叫、JSON 輸出、結構化輸出、推理"] },
            { id: "glm-5.3-flash-uncensored", cells: ["快速對話", "32,768", "32,768", "0.30", "1.00", "工具呼叫、JSON 輸出、推理；無內建內容過濾，使用須遵守服務條款"] },
            { id: "qwen3-vl-30b", cells: ["看圖、文件辨識", "32,768", "4,096", "0.30", "1.20", "每次最多 4 張圖、工具呼叫、JSON 輸出、結構化輸出"] },
          ],
        },
        { kind: "h3", id: "models-retrieval", text: "檢索模型" },
        {
          kind: "models",
          label: "檢索模型",
          head: ["模型 id", "用途", "上下文", "價格"],
          rows: [
            { id: "bge-m3", cells: ["文字向量（1,024 維）", "8,192", "US$0.02／百萬輸入 token"] },
            { id: "bge-reranker-v2-m3", cells: ["文件重排序", "8,192", "US$0.02／百萬輸入 token"] },
          ],
        },
        { kind: "h3", id: "models-generation", text: "生成與語音模型" },
        {
          kind: "models",
          label: "生成與語音模型",
          statusNote: true,
          head: ["模型 id", "用途", "計價單位", "價格"],
          rows: [
            { id: "flux-schnell", cells: ["快速生圖", "每張", "US$0.01"] },
            { id: "chroma1-hd", cells: ["高品質生圖、支援反向提示詞", "每張", "US$0.01"] },
            { id: "indextts2", cells: ["語音合成，可控制情緒", "每分鐘音訊", "US$0.03"] },
            { id: "whisper-large-v3", cells: ["語音辨識，中文輸出台灣繁體", "每分鐘音訊", "約 US$0.01"] },
          ],
        },
        { kind: "h3", id: "availability", text: "可用性" },
        { kind: "p", text: `模型可能因維護或負載暫時離線。呼叫前請查 \`GET ${STATUS_JSON}\`（不需金鑰），\`ready\` 為 \`true\` 的模型才可用。用你的金鑰呼叫 \`GET /v1/models\`，可以取得該金鑰能用的模型與每 token 價格。` },
        { kind: "code", label: "bash", code: ZH_CODE.curlModels },
        { kind: "p", text: "`/v1/models` 的每筆資料含 `id`、`context_length`、`max_output_tokens`、`pricing`（每 token 美元，字串）、`endpoint`、`input_modalities`、`output_modalities`、`supported_features`。非文字模型的 `max_output_tokens` 不代表實際輸出上限。" },
      ],
    },
    {
      id: "chat",
      title: "5. 對話 API",
      blocks: [
        { kind: "p", text: "`POST /v1/chat/completions` 的請求與回應格式與 OpenAI Chat Completions 相同，支援串流、工具呼叫、JSON 輸出與看圖。" },
        { kind: "h3", id: "chat-params", text: "請求參數" },
        {
          kind: "table",
          label: "對話 API 請求參數",
          head: ["參數", "類型", "必填", "說明"],
          rows: [
            ["`model`", "string", "是", "模型 id，見[第 4 節](#models)"],
            ["`messages`", "array", "是", "對話訊息，`role` 為 `system`、`user`、`assistant` 或 `tool`"],
            ["`max_tokens`", "integer", "否", "本次最多產生的 token 數；超過模型上限或剩餘上下文時，平台會自動下修而不報錯"],
            ["`max_completion_tokens`", "integer", "否", "同 `max_tokens`"],
            ["`temperature`", "number", "否", "取樣溫度，越低越穩定"],
            ["`top_p`", "number", "否", "核取樣比例"],
            ["`stream`", "boolean", "否", "`true` 時以 SSE 串流回傳"],
            ["`stop`", "string 或 array", "否", "停止序列"],
            ["`tools`", "array", "否", "可供模型呼叫的函式定義"],
            ["`tool_choice`", "string 或 object", "否", "`auto`、`none`，或指定某個函式"],
            ["`response_format`", "object", "否", "`{\"type\":\"json_object\"}` 或 `{\"type\":\"json_schema\", ...}`"],
            ["`seed`", "integer", "否", "固定取樣種子，盡量重現結果"],
          ],
        },
        { kind: "note", text: "`top_p`、`stop`、`seed` 與其他 OpenAI 相容參數會直接轉給模型，效果依模型而定。模型不支援的參數可能被忽略或回 400，上線前請先實測。" },
        { kind: "h3", id: "chat-response", text: "回應欄位" },
        {
          kind: "table",
          label: "對話 API 回應欄位",
          head: ["欄位", "說明"],
          rows: [
            ["`choices[].message.content`", "模型回答"],
            ["`choices[].message.tool_calls`", "模型要求呼叫的工具（使用工具時）"],
            ["`choices[].finish_reason`", "`stop`、`length`（達到 `max_tokens`）或 `tool_calls`"],
            ["`usage`", "`prompt_tokens`、`completion_tokens`、`total_tokens`，即計費依據"],
          ],
        },
        { kind: "h3", id: "streaming", text: "串流" },
        { kind: "p", text: "`stream: true` 時，回應為 `text/event-stream`，每個事件是一行 `data: {...}`，最後以 `data: [DONE]` 結束。" },
        {
          kind: "ul",
          items: [
            "平台會開啟用量回報，**任何一個 chunk 都可能帶 `usage`**，最後還可能有一個 `choices` 為空陣列的 chunk。讀取 `choices[0]` 前請先確認陣列不是空的。",
            "串流建立後若後端中斷，連線會直接結束，不會送錯誤事件；已產生的 token 仍會計費。",
          ],
        },
        { kind: "code", label: "python", code: ZH_CODE.pythonStream },
        { kind: "h3", id: "tool-calling", text: "工具呼叫" },
        { kind: "p", text: "提供 `tools` 後，模型可能回傳 `tool_calls`。你的程式執行工具，再把結果以 `role: \"tool\"` 訊息送回，模型會接著產生最終回答。串流模式下，工具呼叫的參數會拆成多個 chunk 傳送，請自行拼接。" },
        { kind: "code", label: "python", code: ZH_CODE.pythonTools },
        { kind: "h3", id: "json-output", text: "JSON 輸出" },
        { kind: "p", text: "`response_format: {\"type\": \"json_object\"}` 會要求模型只輸出合法 JSON，建議同時在提示詞裡說明欄位。需要嚴格欄位時改用 `json_schema`（僅 glm-5.2-fp8 與 qwen3-vl-30b 支援）。" },
        { kind: "h3", id: "reasoning", text: "推理模型" },
        { kind: "p", text: "glm-5.2-fp8 與 glm-5.3-flash-uncensored 支援推理，思考過程可能佔用 `max_tokens` 與輸出 token 用量。若回應的 `content` 為空且 `finish_reason` 為 `length`，請調高 `max_tokens`。" },
        { kind: "h3", id: "vision", text: "看圖" },
        { kind: "p", text: "使用 `qwen3-vl-30b`，在 `content` 陣列中放入 `image_url`，每次最多 4 張。建議以 `data:` base64 傳圖。" },
        { kind: "code", label: "python", code: ZH_CODE.pythonVision },
        { kind: "h3", id: "personas", text: "角色設定（Persona）" },
        { kind: "p", text: "Power Champion 可以替你建立固定的角色設定。用 `GET /v1/personas/{persona_id}` 取得 `messages_prefix`，放在每次 `messages` 的最前面。固定前綴可以命中快取、降低首字延遲。可加 `?rev=N` 取得指定版本；persona id 由我們提供。" },
        { kind: "code", label: "json", code: ZH_CODE.personaResponse },
      ],
    },
    {
      id: "text-apis",
      title: "6. 文字補全、向量與重排序 API",
      blocks: [
        { kind: "h3", id: "completions", text: "文字補全 `POST /v1/completions`" },
        { kind: "p", text: "舊式的單一提示詞補全，格式與 OpenAI Completions 相同，支援 `stream`。只能用於對話類模型；新專案建議改用對話 API。" },
        { kind: "code", label: "bash", code: ZH_CODE.curlCompletions },
        { kind: "h3", id: "embeddings", text: "文字向量 `POST /v1/embeddings`" },
        {
          kind: "table",
          label: "文字向量請求參數",
          head: ["參數", "類型", "必填", "說明"],
          rows: [
            ["`model`", "string", "是", "`bge-m3`"],
            ["`input`", "string 或 array", "是", "單一文字或文字陣列，每段最長 8,192 token"],
            ["`encoding_format`", "string", "否", "僅支援 `float`"],
            ["`dimensions`", "integer", "否", "僅支援 `1024`"],
          ],
        },
        { kind: "code", label: "python", code: ZH_CODE.pythonEmbeddings },
        { kind: "p", text: "回應為 OpenAI embeddings 格式：`data[].embedding`、`data[].index` 與 `usage.prompt_tokens`。" },
        { kind: "h3", id: "rerank", text: "文件重排序 `POST /v1/rerank`" },
        { kind: "p", text: "依查詢與文件的相關程度重新排序，常用於向量檢索後的精排。" },
        {
          kind: "table",
          label: "文件重排序請求參數",
          head: ["參數", "類型", "必填", "說明"],
          rows: [
            ["`model`", "string", "是", "`bge-reranker-v2-m3`"],
            ["`query`", "string", "是", "查詢內容"],
            ["`documents`", "array of string", "是", "待排序的文件"],
            ["`top_n`", "integer", "否", "只回傳前 N 筆，1–100"],
            ["`return_documents`", "boolean", "否", "是否在結果中附上文件內容"],
          ],
        },
        { kind: "code", label: "bash", code: ZH_CODE.curlRerank },
        { kind: "code", label: "json", code: ZH_CODE.rerankResponse },
        { kind: "p", text: "回應的 `results` 依 `relevance_score` 由高到低排列，`index` 對應原 `documents` 的位置。計費以查詢與文件的輸入 token 計算。" },
      ],
    },
    {
      id: "images",
      title: "7. 圖片生成 API",
      blocks: [
        { kind: "p", text: "`POST /v1/images/generations`（另名 `POST /v1/images`）依文字生成 PNG 圖片，以 base64 回傳。本端點只接受下表欄位，帶入其他欄位會回 400。" },
        { kind: "h3", id: "images-params", text: "請求參數" },
        {
          kind: "table",
          label: "圖片生成請求參數",
          head: ["參數", "類型", "必填", "說明"],
          rows: [
            ["`model`", "string", "是", "`flux-schnell` 或 `chroma1-hd`"],
            ["`prompt`", "string", "是", "畫面描述"],
            ["`n`", "integer", "否", "張數，1–4，預設 1，按張計費"],
            ["`size`", "string", "否", "`寬x高`，每邊 256–1536，會向下取到 16 的倍數，預設 `1024x1024`"],
            ["`seed`", "integer", "否", "0–4294967295；固定後可重現結果"],
            ["`steps`", "integer", "否", "flux-schnell 預設 4、上限 8；chroma1-hd 預設 25、上限 50"],
            ["`negative_prompt`", "string", "否", "不希望出現的內容；建議只用於 chroma1-hd"],
            ["`guidance_scale`", "number", "否", "提示詞跟隨程度，僅 chroma1-hd 有效"],
            ["`style`", "string", "否", "人像版型預設：`person`、`person_scene`、`object`。會改寫提示詞並自動加入反向提示詞，一般用途請勿設定"],
            ["`response_format`", "string", "否", "只支援 `b64_json`，不提供圖片網址"],
          ],
        },
        { kind: "h3", id: "images-example", text: "範例" },
        { kind: "code", label: "python", code: ZH_CODE.pythonImages },
        { kind: "h3", id: "images-response", text: "回應" },
        { kind: "code", label: "json", code: ZH_CODE.imagesResponse },
        { kind: "h3", id: "images-choose", text: "選哪一個模型" },
        {
          kind: "ul",
          items: [
            "**flux-schnell**：速度優先，適合大量草圖與產品內即時生成。",
            "**chroma1-hd**：品質優先，支援反向提示詞與 `guidance_scale`，適合正式素材。",
          ],
        },
        { kind: "note", text: "兩者都是每張 US$0.01。flux-schnell 雖接受 `negative_prompt`，但幾乎沒有效果且會拉長生成時間，需要反向提示詞請用 chroma1-hd。" },
      ],
    },
    {
      id: "audio",
      title: "8. 語音合成與語音辨識 API",
      blocks: [
        { kind: "h3", id: "speech", text: "語音合成 `POST /v1/audio/speech`" },
        { kind: "p", text: "將文字合成為語音，可用文字描述控制情緒。回應是音檔本體，不支援串流：整段合成完成後才回傳，後端逾時為 300 秒。" },
        {
          kind: "table",
          label: "語音合成請求參數",
          head: ["參數", "類型", "必填", "說明"],
          rows: [
            ["`model`", "string", "是", "`indextts2`"],
            ["`input`", "string", "是", "要合成的文字，最多 2,000 字元"],
            ["`voice`", "string", "是", "音色 id，由 Power Champion 提供；未登錄的音色回 400"],
            ["`response_format`", "string", "否", "`mp3`（預設）、`opus`（Ogg 封裝）、`wav`"],
            ["`speed`", "number", "否", "目前 indextts2 不支援，會被忽略"],
            ["`instruct`", "string", "否", "情緒描述，例如「開心、雀躍」"],
            ["`emo_alpha`", "number", "否", "情緒強度，0–1，建議 0.6"],
          ],
        },
        { kind: "p", text: "回應標頭：`X-Audio-Seconds` 是音檔秒數，`X-Usage-Tokens` 是計費量（每秒 50 token）。" },
        { kind: "code", label: "bash", code: ZH_CODE.curlSpeech },
        { kind: "note", text: "長文字請依句子切段分別合成，可縮短等待時間，也能避開 2,000 字元上限。" },
        { kind: "h3", id: "transcriptions", text: "語音辨識 `POST /v1/audio/transcriptions`" },
        { kind: "p", text: "將音檔轉為文字，中文結果會轉成台灣繁體。請求以 `multipart/form-data` 上傳。" },
        {
          kind: "table",
          label: "語音辨識請求參數",
          head: ["參數", "類型", "必填", "說明"],
          rows: [
            ["`file`", "file", "是", "音檔，最大 25 MB；建議每段不超過 600 秒"],
            ["`model`", "string", "是", "`whisper-large-v3`"],
            ["`language`", "string", "否", "`zh` 或 `en`；留空則自動偵測"],
            ["`prompt`", "string", "否", "提示專有名詞或用語，可提高辨識率"],
            ["`response_format`", "string", "否", "`json`（預設，含用量資訊）或 `text`"],
            ["`temperature`", "number", "否", "0–1"],
          ],
        },
        { kind: "code", label: "bash", code: ZH_CODE.curlTranscribe },
        { kind: "code", label: "json", code: ZH_CODE.transcribeResponse },
        { kind: "note", text: "可讀取長度的格式（如 wav、flac）超過 600 秒時回 400，其他格式不保證會檢查；超過 25 MB 的上傳回 413。長錄音請先切成每段 10 分鐘以內再上傳。" },
      ],
    },
    {
      id: "billing",
      title: "9. 帳務：儲值、餘額與用量",
      blocks: [
        { kind: "p", text: "平台採預付制：先儲值，每次請求完成後依實際用量扣款，餘額用完時回 402。後端錯誤、驗證錯誤等失敗的請求不扣款；非串流請求在回應送達前中斷連線也不扣款。串流已開始傳送後才中斷，已產生的 token 仍會計費。" },
        { kind: "h3", id: "credit-packs", text: "儲值包" },
        {
          kind: "table",
          label: "儲值包",
          head: ["方案", "付款", "入帳餘額", "加贈"],
          rows: [
            ["Starter", "US$10", "US$10.00", "—"],
            ["Builder", "US$50", "US$52.50", "5%"],
            ["Scale", "US$200", "US$224.00", "12%"],
          ],
        },
        { kind: "p", text: `儲值包以兌換碼交付，請寄信至 ${MAIL} 購買。` },
        { kind: "h3", id: "redeem", text: "兌換儲值碼 `POST /v1/redeem`" },
        { kind: "code", label: "bash", code: ZH_CODE.curlRedeem },
        { kind: "code", label: "json", code: ZH_CODE.redeemResponse },
        {
          kind: "table",
          label: "兌換儲值碼的狀態碼",
          head: ["狀態碼", "意思"],
          rows: [
            ["200", "入帳成功；金額單位為 10⁻⁹ 美元"],
            ["400", "未帶 `code`、請求不是 JSON 物件，或這把金鑰不支援儲值；兌換碼不會被使用"],
            ["404", "兌換碼不存在"],
            ["409", "兌換碼已使用、已停用或已過期"],
          ],
        },
        { kind: "h3", id: "balance-usage", text: "查詢餘額與用量" },
        {
          kind: "table",
          label: "餘額與用量端點",
          head: ["端點", "回傳", "說明"],
          rows: [
            ["`GET /dashboard/billing/subscription`", "`plan.remaining_usd`", "剩餘金額；不含進行中請求的預留，可能略高"],
            ["`GET /dashboard/billing/usage`", "`total_usage`、`total_usage_nano_usd`", "歷史累計花費（美元）；不支援日期區間"],
          ],
        },
        { kind: "code", label: "bash", code: ZH_CODE.curlSubscription },
        { kind: "code", label: "json", code: ZH_CODE.subscriptionResponse },
        { kind: "p", text: "逐筆明細目前沒有 API，需要月報請向我們索取。每次回應也帶有用量：文字模型看 `usage`，語音合成看 `X-Usage-Tokens` 標頭。" },
        { kind: "h3", id: "billing-rules", text: "計費規則" },
        { kind: "p", text: "所有模型都用同一個公式，價格以請求受理當下的牌價為準：" },
        { kind: "note", text: "**費用（US$）＝（輸入 token × 輸入單價 ＋ 輸出 token × 輸出單價）÷ 1,000,000**" },
        { kind: "p", text: "非文字模型先換算成等值 token：" },
        {
          kind: "table",
          label: "非文字模型的 token 換算",
          head: ["模型類型", "換算", "結果"],
          rows: [
            ["圖片生成", "每張 1,000 token × US$10／百萬", "每張 US$0.01"],
            ["語音合成", "每秒 50 token × US$10／百萬", "每分鐘 US$0.03"],
            ["語音辨識", "每秒 50 token × US$3.33／百萬", "每分鐘約 US$0.01"],
          ],
        },
        { kind: "p", text: "精度為 10⁻⁹ 美元。扣款發生在回應完成後，所以最後一筆請求可能讓餘額略為負數。" },
      ],
    },
    {
      id: "rate-limits",
      title: "10. 限流與配額",
      blocks: [
        { kind: "p", text: "每把金鑰有四種限制，另外每個模型有整體容量上限。你的金鑰實際設定以簽發時的約定為準，可向我們查詢；平台不提供 `X-RateLimit-*` 標頭。" },
        {
          kind: "table",
          label: "限流與配額",
          head: ["限制", "規則", "超過時", "Retry-After"],
          rows: [
            ["每分鐘請求數", "60 秒滑動視窗", "429 `Rate limit exceeded (N/min) for this key.`", "2 秒"],
            ["同時進行中請求", "串流請求會佔用到結束為止", "429 `Key is at its concurrency limit`", "1 秒"],
            ["每日 token 額度", "UTC 日計算，UTC 00:00 重置", "429 `Daily token quota exhausted`", "無"],
            ["預付餘額", "餘額用完即拒絕", "402 `Prepaid balance exhausted`", "0"],
            ["模型容量", "模型整體滿載", "429 `Model '<id>' is at capacity`", "2 秒"],
          ],
        },
        { kind: "h3", id: "quota-reservation", text: "每日額度的預留機制" },
        { kind: "p", text: "請求受理時會先從當日額度預留 `max_tokens`（未指定時預留 2,000），完成後再依實際用量校正；失敗的請求會釋放預留。額度快用完時，把 `max_tokens` 設小可以讓更多請求通過。" },
        { kind: "h3", id: "rate-limit-handling", text: "處理建議" },
        {
          kind: "ul",
          items: [
            "收到 429 時依 `Retry-After` 等待後重試；每日額度用完則等到 UTC 00:00。",
            "高並發應用請在你的程式內加佇列，把同時進行中的請求數控制在金鑰上限以內。",
            `需要更高的限制時，請寄信到 ${MAIL}，說明預估的每分鐘請求數、並發數與每日用量。`,
          ],
        },
      ],
    },
    {
      id: "errors",
      title: "11. 錯誤處理",
      blocks: [
        { kind: "p", text: "平台錯誤採 OpenAI 格式，只有 429、502、503 值得重試，其他狀態碼請先修正請求。" },
        { kind: "h3", id: "error-format", text: "錯誤格式" },
        { kind: "code", label: "json", code: ZH_CODE.errorResponse },
        {
          kind: "table",
          label: "錯誤類型與狀態碼",
          head: ["`type`", "對應狀態碼"],
          rows: [
            ["`authentication_error`", "401（`code` 為 `invalid_api_key`）"],
            ["`permission_error`", "403"],
            ["`invalid_request_error`", "400、402、404、409、413"],
            ["`rate_limit_error`", "429（模型容量滿時 `code` 可能為 `sellable_capacity_exhausted`）"],
            ["`server_error`", "500 以上"],
          ],
        },
        { kind: "note", text: "少數錯誤不是這個格式，而是 `{\"detail\": ...}`：語音與生圖後端的驗證錯誤、`/dashboard/billing/*` 的 401、不存在的路徑（404）、方法錯誤（405）與查詢參數型別錯誤（422）。另外，請求內容不是 JSON 物件（例如陣列）時，部分端點可能回純文字的 500。解析錯誤時請兩種格式都處理；錯誤訊息文字日後可能調整，程式請以狀態碼與 type 判斷。" },
        { kind: "h3", id: "status-codes", text: "狀態碼" },
        {
          kind: "table",
          label: "狀態碼",
          head: ["狀態碼", "常見原因", "該怎麼做"],
          rows: [
            ["400", "JSON 格式錯誤、欄位不合法、超過上下文、音檔超過 600 秒、音色不存在", "修正請求，不要重試"],
            ["401", "缺少或無效的金鑰", "檢查 `Authorization` 標頭"],
            ["402", "預付餘額用完", "儲值後再試"],
            ["403", "受限金鑰超出範圍或已到期", "向我們確認金鑰範圍"],
            ["404", "模型不存在或未開放、兌換碼不存在、路徑不存在", "核對模型 id 與路徑"],
            ["409", "兌換碼已使用、停用或過期", "聯絡我們"],
            ["413", "語音辨識上傳超過 25 MB", "壓縮或切段後重傳"],
            ["429", "超過限流、並發或每日額度，或模型滿載", "依 `Retry-After` 等待後重試"],
            ["500", "未預期的伺服器錯誤", "重試一次；持續發生請聯絡我們"],
            ["502", "模型後端無法連線（`All replicas failed`）", "指數退避重試；持續失敗請查服務狀態或換模型"],
            ["503", "模型維護或切換中", "依 `Retry-After` 等待（通常 30 或 600 秒）"],
          ],
        },
        { kind: "h3", id: "check-order", text: "檢查順序" },
        { kind: "p", text: "同一個請求同時有多個問題時，平台依下列順序檢查，回傳第一個失敗的結果。除錯時從上往下對照即可。" },
        {
          kind: "table",
          label: "檢查順序",
          head: ["順序", "檢查", "失敗時"],
          rows: [
            ["1", "金鑰是否有效", "401"],
            ["2", "請求是否為合法 JSON", "400"],
            ["3", "金鑰是否有權使用此端點與模型", "403"],
            ["4", "模型是否存在且開放", "404"],
            ["5", "模型是否在維護或切換", "503"],
            ["6", "金鑰同時進行中請求數", "429"],
            ["7", "預付餘額", "402"],
            ["8", "每分鐘請求數", "429"],
            ["9", "每日 token 額度", "429"],
            ["10", "模型整體容量", "429"],
            ["11", "模型後端處理", "400 或 502"],
          ],
        },
        { kind: "note", text: "欄位驗證類的 400（例如圖片不支援的欄位）與語音辨識的 413，可能比表中順序更早回傳。" },
        { kind: "h3", id: "retries", text: "重試策略" },
        {
          kind: "ol",
          items: [
            "只重試 429、502、503，以及網路層的連線錯誤。",
            "有 `Retry-After` 就照它等；沒有就用指數退避（1、2、4、8 秒）加上隨機抖動，最多 4 次。",
            "預計超過 60 秒的生成請改用串流；非串流請求超過約 100 秒，連線可能被中斷。非串流的長請求逾時後，重送前先用餘額或用量確認上一次是否已扣款。",
          ],
        },
        { kind: "code", label: "python", code: ZH_CODE.pythonRetry },
        { kind: "p", text: "使用官方 OpenAI SDK 時，也可以在建立 client 時設定 `max_retries` 交由 SDK 重試。" },
      ],
    },
    {
      id: "best-practices",
      title: "12. 最佳實務與安全建議",
      blocks: [
        { kind: "h3", id: "performance", text: "效能" },
        {
          kind: "ul",
          items: [
            "**長回答用串流**：使用者能即時看到內容，也避開代理層的逾時。",
            "**固定前綴放最前面**：系統提示詞與角色設定保持內容不變且放在 `messages` 開頭，可命中前綴快取、降低首字延遲。",
            "**設定合理的 `max_tokens`**：可以控制花費，也減少每日額度的預留。",
            "**檢索先向量、再重排序**：用 bge-m3 取前 50 筆候選，再用 bge-reranker-v2-m3 取前 5 筆給對話模型。",
            "**長音檔先切段**：語音辨識每段 10 分鐘以內；語音合成依句子分段。",
          ],
        },
        { kind: "h3", id: "reliability", text: "可靠性" },
        {
          kind: "ul",
          items: [
            "重要流程準備備用模型：主模型回 502 或 503 時，改用服務狀態中 `ready` 的對話模型。",
            "定期讀取 `status.json` 做健康檢查，不要用真實推論請求測試可用性。",
            "記錄每次請求的時間（UTC）、模型、狀態碼與 `usage`，回報問題時一併提供。",
          ],
        },
        { kind: "h3", id: "cost-control", text: "成本控管" },
        {
          kind: "ul",
          items: [
            "上線前先用小額儲值測試，定期讀取 `/dashboard/billing/subscription` 監看餘額。",
            "依回應的 `usage` 在你的系統內累計成本，餘額低於門檻時發出提醒。",
            "只需要草圖時選 flux-schnell，只需要快速回答時選 glm-5.3-flash-uncensored。",
          ],
        },
        { kind: "h3", id: "security-compliance", text: "安全與合規" },
        {
          kind: "ul",
          items: [
            "金鑰只放在伺服器端；前端應用請透過你自己的後端轉發。",
            "不要在提示詞中放入密碼、金鑰或非必要的個人資料。",
            "glm-5.3-flash-uncensored 沒有內建內容過濾，面向一般使用者的產品請自行加上內容審核。",
            "產生的內容對外發布前請經人工審閱，並依適用法規標示 AI 生成。",
            "資料處理與保存規則見[隱私權政策](/privacy)與[資料保存政策](/data-retention)。",
          ],
        },
      ],
    },
    {
      id: "appendix",
      title: "13. 附錄",
      blocks: [
        { kind: "h3", id: "endpoint-index", text: "A. 端點總表" },
        {
          kind: "table",
          label: "端點總表",
          head: ["方法", "路徑", "用途", "需要金鑰"],
          rows: [
            ["GET", "`/v1/models`", "列出金鑰可用的模型與價格", "是"],
            ["POST", "`/v1/chat/completions`", "對話、工具呼叫、看圖", "是"],
            ["POST", "`/v1/completions`", "文字補全", "是"],
            ["POST", "`/v1/embeddings`", "文字向量", "是"],
            ["POST", "`/v1/rerank`", "文件重排序", "是"],
            ["POST", "`/v1/images/generations`、`/v1/images`", "圖片生成", "是"],
            ["POST", "`/v1/audio/speech`", "語音合成", "是"],
            ["POST", "`/v1/audio/transcriptions`", "語音辨識", "是"],
            ["GET", "`/v1/personas/{persona_id}`", "讀取角色設定", "是"],
            ["POST", "`/v1/redeem`", "兌換儲值碼", "是"],
            ["GET", "`/dashboard/billing/subscription`", "查詢餘額", "是"],
            ["GET", "`/dashboard/billing/usage`", "查詢累計用量", "是"],
            ["GET", `\`${STATUS_JSON}\``, "模型即時狀態", "否"],
            ["GET", `\`${CATALOG_JSON}\``, "公開模型目錄與牌價", "否"],
            ["GET", `\`${GATEWAY_URL}/health\``, "閘道存活檢查", "否"],
          ],
        },
        { kind: "h3", id: "not-supported", text: "B. 目前不支援的功能" },
        {
          kind: "ul",
          items: [
            "影片生成。",
            "OpenAI Responses API、Assistants、Files、Batches、Moderations。",
            "語音翻譯 `/v1/audio/translations`、即時語音（Realtime / WebSocket）。",
            "單一模型查詢 `/v1/models/{id}`。",
            "自助申請或撤銷金鑰、線上付款、逐筆用量明細 API、請求結果的 Webhook 通知。",
          ],
        },
        { kind: "h3", id: "status-support", text: "C. 服務狀態與支援" },
        {
          kind: "table",
          label: "服務狀態與支援",
          head: ["項目", "位置"],
          rows: [
            ["服務狀態頁", "[powerchampion.ai/status](/status)"],
            ["線上開發者文件", "[powerchampion.ai/docs/api](/docs/api)"],
            ["服務條款", "[powerchampion.ai/terms](/terms)"],
            ["技術支援與帳務", MAIL],
          ],
        },
        { kind: "p", text: "回報問題時請附上：發生時間（UTC）、模型 id、端點、狀態碼、完整錯誤訊息，以及金鑰的前 12 個字元（不要提供完整金鑰）。" },
        { kind: "h3", id: "changelog", text: "D. 變更紀錄" },
        {
          kind: "table",
          label: "變更紀錄",
          head: ["日期", "版本", "變更"],
          rows: [
            [API_REFERENCE_AS_OF, API_REFERENCE_VERSION, "首版發布，涵蓋第 1–12 節所列端點與模型。"],
          ],
        },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* English                                                             */
/* ------------------------------------------------------------------ */

const EN: ApiReferenceCopy = {
  kicker: "Developer docs",
  title: "Power Champion API Developer Guide",
  lead: "The complete guide to the OpenAI-compatible HTTPS API: authentication and keys, models and pricing, endpoint parameters, billing, rate limits and error handling.",
  version: `Version ${API_REFERENCE_VERSION} · ${API_REFERENCE_AS_OF}`,
  backToDocs: "Back to the quick start",
  tocLabel: "On this page",
  tableScrollHint: "Scroll the table sideways to see every column.",
  models: {
    statusHead: "Status now",
    online: "Online",
    offline: "Offline",
    unknown: "Unknown",
    liveNote: "“Status now” comes from the live status feed and refreshes about once a minute.",
    fallbackNote: "Live status could not be loaded just now. Check the service status before you call a model.",
  },
  sections: [
    {
      id: "overview",
      title: "1. Overview",
      blocks: [
        { kind: "p", text: "The Power Champion API is an OpenAI-compatible HTTPS interface. One key gives you chat, vision, embeddings, reranking, image generation, text to speech and speech recognition. Existing OpenAI SDKs work once you change the `base_url` and the key." },
        {
          kind: "table",
          label: "Service details",
          head: ["Item", "Value"],
          rows: [
            ["Document version", `${API_REFERENCE_VERSION} (${API_REFERENCE_AS_OF})`],
            ["Environment", "Production"],
            ["Base URL", `\`${API_BASE_URL}\``],
            ["Protocol", "HTTPS only"],
            ["Request format", "JSON (`Content-Type: application/json`); speech recognition uses `multipart/form-data`"],
            ["Character encoding", "UTF-8"],
            ["Currency", "US dollars (USD), prepaid"],
            ["Online version", "[powerchampion.ai/docs/api](/docs/api)"],
          ],
        },
        { kind: "h3", id: "capabilities", text: "Capabilities" },
        {
          kind: "table",
          label: "Capabilities",
          head: ["Capability", "Endpoint", "Models"],
          rows: [
            ["Chat and reasoning", "`POST /v1/chat/completions`", "glm-5.2-fp8, glm-5.3-flash-uncensored"],
            ["Vision", "`POST /v1/chat/completions`", "qwen3-vl-30b"],
            ["Text completions", "`POST /v1/completions`", "Chat models"],
            ["Text embeddings", "`POST /v1/embeddings`", "bge-m3"],
            ["Document reranking", "`POST /v1/rerank`", "bge-reranker-v2-m3"],
            ["Image generation", "`POST /v1/images/generations`", "flux-schnell, chroma1-hd"],
            ["Text to speech", "`POST /v1/audio/speech`", "indextts2"],
            ["Speech recognition", "`POST /v1/audio/transcriptions`", "whisper-large-v3"],
          ],
        },
        { kind: "h3", id: "conventions", text: "Conventions" },
        {
          kind: "ul",
          items: [
            "A missing required field returns 400 or 404. Optional fields fall back to their defaults when omitted.",
            "`$PC_API_KEY` in the examples stands for your key. Keep it in an environment variable, not in your code.",
            "Amounts are in US dollars. Billing endpoints also return exact values in nano-dollars (10⁻⁹ USD).",
            "All times are UTC. Daily quotas reset at 00:00 UTC (08:00 Taiwan time).",
            `Whether a model is online is defined by the [service status](${STATUS_JSON}). This guide does not guarantee that any particular model is available at all times.`,
          ],
        },
      ],
    },
    {
      id: "quick-start",
      title: "2. Quick start",
      blocks: [
        { kind: "p", text: "Three steps to your first request: get a key, set an environment variable, and send a request." },
        {
          kind: "ol",
          items: [
            `**Get a key**: email ${MAIL} to apply. Keys start with \`sk-b300-\` and are issued by our team and sent to you. The platform stores only a hash, so a key cannot be recovered — keep it safe.`,
            "**Add credit**: when you buy a credit pack you receive a redeem code. Apply it with `POST /v1/redeem` (see [section 9](#billing)).",
            "**Set the environment variable**:",
          ],
        },
        { kind: "code", label: "bash", code: EN_CODE.exportKey },
        { kind: "h3", id: "quick-start-curl", text: "curl" },
        { kind: "code", label: "bash", code: EN_CODE.curlChat },
        { kind: "h3", id: "quick-start-python", text: "Python" },
        { kind: "p", text: "Install: `pip install openai`." },
        { kind: "code", label: "python", code: EN_CODE.pythonChat },
        { kind: "h3", id: "quick-start-node", text: "Node.js" },
        { kind: "p", text: "Install: `npm install openai`. Requires Node.js 18 or later, running as ESM (a `.mjs` file, or `\"type\": \"module\"` in `package.json`)." },
        { kind: "code", label: "javascript", code: EN_CODE.nodeChat },
        { kind: "h3", id: "quick-start-response", text: "Successful response" },
        { kind: "code", label: "json", code: EN_CODE.chatResponse },
        { kind: "note", text: `A 502 means the model is temporarily offline. Check the [service status](${STATUS_JSON}) and switch to a model whose \`ready\` is \`true\`.` },
      ],
    },
    {
      id: "auth",
      title: "3. Authentication and key management",
      blocks: [
        { kind: "p", text: "Every `/v1/*` and `/dashboard/billing/*` request must carry a Bearer key in its headers. No other authentication method is accepted." },
        { kind: "code", label: "http", code: EN_CODE.authHeader },
        {
          kind: "table",
          label: "API keys",
          head: ["Item", "Details"],
          rows: [
            ["Format", "`sk-b300-` followed by 43 characters"],
            ["Storage", "The platform stores only a hash and cannot recover the original key. If you lose it, request a new one."],
            ["Issuing and revoking", "Handled by Power Champion. There is no self-service API for requesting or revoking keys yet."],
            ["Where to use it", "Server side only. The platform does not enable CORS, so browser code cannot call it directly."],
            ["Restricted keys", "Some keys are limited to specific models and have an expiry date. Requests outside that scope, or after expiry, return 403."],
          ],
        },
        { kind: "h3", id: "auth-errors", text: "Authentication failures" },
        {
          kind: "table",
          label: "Authentication failures",
          head: ["Status", "Message", "What to do"],
          rows: [
            ["401", "`Missing bearer token. Send: Authorization: Bearer <key>`", "Check the header name and the `Bearer ` prefix"],
            ["401", "`Invalid API key.`", "The key is wrong or disabled — contact us"],
            ["403", "`Reviewer API key is not permitted for this endpoint or model.`", "A restricted key was used outside its scope or after it expired"],
          ],
        },
        { kind: "h3", id: "key-security", text: "Key security" },
        {
          kind: "ul",
          items: [
            "Use a separate key for each environment (development, testing, production) so you can disable one without affecting the others.",
            "Keep keys in environment variables or a secrets manager. Never commit them to version control or ship them in front-end code.",
            `If you suspect a key has leaked, email ${MAIL} right away to disable it and get a new one.`,
          ],
        },
      ],
    },
    {
      id: "models",
      title: "4. Model catalog and pricing",
      blocks: [
        { kind: "p", text: `Nine models are available in production. Prices below are list prices on ${API_REFERENCE_AS_OF}. The authoritative source is the public [catalog.json](${CATALOG_JSON}); if the two differ, catalog.json wins.` },
        { kind: "h3", id: "models-language", text: "Language and vision models" },
        {
          kind: "models",
          label: "Language and vision models",
          wide: true,
          head: ["Model id", "Use", "Context", "Max output", "Input (US$ / 1M tokens)", "Output (US$ / 1M tokens)", "Features"],
          rows: [
            { id: "glm-5.2-fp8", cells: ["Chat, reasoning, code", "131,072", "32,768", "0.93", "3.00", "Tool calling, JSON output, structured output, reasoning"] },
            { id: "glm-5.3-flash-uncensored", cells: ["Fast chat", "32,768", "32,768", "0.30", "1.00", "Tool calling, JSON output, reasoning; no built-in content filtering — use is subject to the Terms of Service"] },
            { id: "qwen3-vl-30b", cells: ["Image understanding, document recognition", "32,768", "4,096", "0.30", "1.20", "Up to 4 images per request, tool calling, JSON output, structured output"] },
          ],
        },
        { kind: "h3", id: "models-retrieval", text: "Retrieval models" },
        {
          kind: "models",
          label: "Retrieval models",
          head: ["Model id", "Use", "Context", "Price"],
          rows: [
            { id: "bge-m3", cells: ["Text embeddings (1,024 dimensions)", "8,192", "US$0.02 per 1M input tokens"] },
            { id: "bge-reranker-v2-m3", cells: ["Document reranking", "8,192", "US$0.02 per 1M input tokens"] },
          ],
        },
        { kind: "h3", id: "models-generation", text: "Generation and speech models" },
        {
          kind: "models",
          label: "Generation and speech models",
          statusNote: true,
          head: ["Model id", "Use", "Billing unit", "Price"],
          rows: [
            { id: "flux-schnell", cells: ["Fast image generation", "Per image", "US$0.01"] },
            { id: "chroma1-hd", cells: ["High-quality image generation, supports negative prompts", "Per image", "US$0.01"] },
            { id: "indextts2", cells: ["Text to speech with emotion control", "Per minute of audio", "US$0.03"] },
            { id: "whisper-large-v3", cells: ["Speech recognition; Chinese output in Traditional Chinese (Taiwan)", "Per minute of audio", "About US$0.01"] },
          ],
        },
        { kind: "h3", id: "availability", text: "Availability" },
        { kind: "p", text: `A model can go offline temporarily for maintenance or under load. Before calling one, check \`GET ${STATUS_JSON}\` (no key needed): only models whose \`ready\` is \`true\` are available. Calling \`GET /v1/models\` with your key returns the models that key can use and their per-token prices.` },
        { kind: "code", label: "bash", code: EN_CODE.curlModels },
        { kind: "p", text: "Each entry in `/v1/models` has `id`, `context_length`, `max_output_tokens`, `pricing` (US dollars per token, as strings), `endpoint`, `input_modalities`, `output_modalities` and `supported_features`. For non-text models, `max_output_tokens` is not the actual output limit." },
      ],
    },
    {
      id: "chat",
      title: "5. Chat API",
      blocks: [
        { kind: "p", text: "`POST /v1/chat/completions` uses the same request and response format as OpenAI Chat Completions, and supports streaming, tool calling, JSON output and image input." },
        { kind: "h3", id: "chat-params", text: "Request parameters" },
        {
          kind: "table",
          label: "Chat API request parameters",
          head: ["Parameter", "Type", "Required", "Description"],
          rows: [
            ["`model`", "string", "Yes", "Model id; see [section 4](#models)"],
            ["`messages`", "array", "Yes", "Conversation messages; `role` is `system`, `user`, `assistant` or `tool`"],
            ["`max_tokens`", "integer", "No", "Maximum tokens to generate. If it exceeds the model limit or the remaining context, the platform lowers it automatically instead of returning an error"],
            ["`max_completion_tokens`", "integer", "No", "Same as `max_tokens`"],
            ["`temperature`", "number", "No", "Sampling temperature; lower is more deterministic"],
            ["`top_p`", "number", "No", "Nucleus sampling ratio"],
            ["`stream`", "boolean", "No", "When `true`, the response is streamed as SSE"],
            ["`stop`", "string or array", "No", "Stop sequences"],
            ["`tools`", "array", "No", "Function definitions the model may call"],
            ["`tool_choice`", "string or object", "No", "`auto`, `none`, or a specific function"],
            ["`response_format`", "object", "No", "`{\"type\":\"json_object\"}` or `{\"type\":\"json_schema\", ...}`"],
            ["`seed`", "integer", "No", "Fixed sampling seed for more reproducible results"],
          ],
        },
        { kind: "note", text: "`top_p`, `stop`, `seed` and other OpenAI-compatible parameters are passed straight to the model, so their effect depends on the model. Parameters a model does not support may be ignored or return 400 — test before you go live." },
        { kind: "h3", id: "chat-response", text: "Response fields" },
        {
          kind: "table",
          label: "Chat API response fields",
          head: ["Field", "Description"],
          rows: [
            ["`choices[].message.content`", "The model's answer"],
            ["`choices[].message.tool_calls`", "Tools the model wants to call (when tools are used)"],
            ["`choices[].finish_reason`", "`stop`, `length` (hit `max_tokens`) or `tool_calls`"],
            ["`usage`", "`prompt_tokens`, `completion_tokens`, `total_tokens` — the basis for billing"],
          ],
        },
        { kind: "h3", id: "streaming", text: "Streaming" },
        { kind: "p", text: "With `stream: true`, the response is `text/event-stream`. Each event is one `data: {...}` line, and the stream ends with `data: [DONE]`." },
        {
          kind: "ul",
          items: [
            "The platform turns on usage reporting, so **any chunk may carry `usage`**, and there may be a final chunk whose `choices` is an empty array. Check that the array is not empty before reading `choices[0]`.",
            "If the backend fails after the stream has started, the connection simply closes without an error event. Tokens already generated are still billed.",
          ],
        },
        { kind: "code", label: "python", code: EN_CODE.pythonStream },
        { kind: "h3", id: "tool-calling", text: "Tool calling" },
        { kind: "p", text: "When you provide `tools`, the model may return `tool_calls`. Your code runs the tool and sends the result back as a `role: \"tool\"` message; the model then produces its final answer. In streaming mode, tool-call arguments arrive split across several chunks — concatenate them yourself." },
        { kind: "code", label: "python", code: EN_CODE.pythonTools },
        { kind: "h3", id: "json-output", text: "JSON output" },
        { kind: "p", text: "`response_format: {\"type\": \"json_object\"}` asks the model to output valid JSON only. Describe the fields in your prompt as well. When you need strict fields, use `json_schema` instead (supported only by glm-5.2-fp8 and qwen3-vl-30b)." },
        { kind: "h3", id: "reasoning", text: "Reasoning models" },
        { kind: "p", text: "glm-5.2-fp8 and glm-5.3-flash-uncensored support reasoning. The thinking process may use up part of `max_tokens` and may count toward output token usage. If a response has an empty `content` and `finish_reason` is `length`, raise `max_tokens`." },
        { kind: "h3", id: "vision", text: "Image input" },
        { kind: "p", text: "Use `qwen3-vl-30b` and put `image_url` entries in the `content` array, up to 4 images per request. Sending images as `data:` base64 is recommended." },
        { kind: "code", label: "python", code: EN_CODE.pythonVision },
        { kind: "h3", id: "personas", text: "Personas" },
        { kind: "p", text: "Power Champion can set up a fixed persona for you. Call `GET /v1/personas/{persona_id}` to get its `messages_prefix` and put it at the start of `messages` on every request. A fixed prefix hits the cache and lowers time to first token. Add `?rev=N` to get a specific version; we provide the persona id." },
        { kind: "code", label: "json", code: EN_CODE.personaResponse },
      ],
    },
    {
      id: "text-apis",
      title: "6. Completions, embeddings and reranking APIs",
      blocks: [
        { kind: "h3", id: "completions", text: "Text completions `POST /v1/completions`" },
        { kind: "p", text: "Legacy single-prompt completion in the OpenAI Completions format, with `stream` support. It works only with chat models; new projects should use the Chat API." },
        { kind: "code", label: "bash", code: EN_CODE.curlCompletions },
        { kind: "h3", id: "embeddings", text: "Text embeddings `POST /v1/embeddings`" },
        {
          kind: "table",
          label: "Embeddings request parameters",
          head: ["Parameter", "Type", "Required", "Description"],
          rows: [
            ["`model`", "string", "Yes", "`bge-m3`"],
            ["`input`", "string or array", "Yes", "A single text or an array of texts, each up to 8,192 tokens"],
            ["`encoding_format`", "string", "No", "Only `float` is supported"],
            ["`dimensions`", "integer", "No", "Only `1024` is supported"],
          ],
        },
        { kind: "code", label: "python", code: EN_CODE.pythonEmbeddings },
        { kind: "p", text: "The response uses the OpenAI embeddings format: `data[].embedding`, `data[].index` and `usage.prompt_tokens`." },
        { kind: "h3", id: "rerank", text: "Document reranking `POST /v1/rerank`" },
        { kind: "p", text: "Reorders documents by how relevant they are to a query — typically used to refine results after vector retrieval." },
        {
          kind: "table",
          label: "Rerank request parameters",
          head: ["Parameter", "Type", "Required", "Description"],
          rows: [
            ["`model`", "string", "Yes", "`bge-reranker-v2-m3`"],
            ["`query`", "string", "Yes", "The query"],
            ["`documents`", "array of string", "Yes", "Documents to rank"],
            ["`top_n`", "integer", "No", "Return only the top N results, 1–100"],
            ["`return_documents`", "boolean", "No", "Whether to include the document text in the results"],
          ],
        },
        { kind: "code", label: "bash", code: EN_CODE.curlRerank },
        { kind: "code", label: "json", code: EN_CODE.rerankResponse },
        { kind: "p", text: "`results` is sorted by `relevance_score`, highest first, and `index` points to the position in the original `documents`. Billing is based on the input tokens of the query and documents." },
      ],
    },
    {
      id: "images",
      title: "7. Image generation API",
      blocks: [
        { kind: "p", text: "`POST /v1/images/generations` (also available as `POST /v1/images`) generates PNG images from text and returns them as base64. The endpoint accepts only the fields below; any other field returns 400." },
        { kind: "h3", id: "images-params", text: "Request parameters" },
        {
          kind: "table",
          label: "Image generation request parameters",
          head: ["Parameter", "Type", "Required", "Description"],
          rows: [
            ["`model`", "string", "Yes", "`flux-schnell` or `chroma1-hd`"],
            ["`prompt`", "string", "Yes", "Description of the image"],
            ["`n`", "integer", "No", "Number of images, 1–4, default 1; billed per image"],
            ["`size`", "string", "No", "`WIDTHxHEIGHT`, each side 256–1536, rounded down to a multiple of 16; default `1024x1024`"],
            ["`seed`", "integer", "No", "0–4294967295; fix it to reproduce a result"],
            ["`steps`", "integer", "No", "flux-schnell: default 4, max 8. chroma1-hd: default 25, max 50"],
            ["`negative_prompt`", "string", "No", "What you do not want in the image; recommended for chroma1-hd only"],
            ["`guidance_scale`", "number", "No", "How closely to follow the prompt; chroma1-hd only"],
            ["`style`", "string", "No", "Portrait layout presets: `person`, `person_scene`, `object`. They rewrite the prompt and add a negative prompt automatically — leave unset for general use"],
            ["`response_format`", "string", "No", "Only `b64_json` is supported; image URLs are not provided"],
          ],
        },
        { kind: "h3", id: "images-example", text: "Example" },
        { kind: "code", label: "python", code: EN_CODE.pythonImages },
        { kind: "h3", id: "images-response", text: "Response" },
        { kind: "code", label: "json", code: EN_CODE.imagesResponse },
        { kind: "h3", id: "images-choose", text: "Which model to choose" },
        {
          kind: "ul",
          items: [
            "**flux-schnell**: speed first — suited to large batches of drafts and real-time generation inside a product.",
            "**chroma1-hd**: quality first, with negative prompts and `guidance_scale` — suited to production assets.",
          ],
        },
        { kind: "note", text: "Both cost US$0.01 per image. flux-schnell accepts `negative_prompt`, but it has almost no effect and makes generation slower; if you need a negative prompt, use chroma1-hd." },
      ],
    },
    {
      id: "audio",
      title: "8. Text-to-speech and speech recognition APIs",
      blocks: [
        { kind: "h3", id: "speech", text: "Text to speech `POST /v1/audio/speech`" },
        { kind: "p", text: "Turns text into speech, with emotion controlled by a text description. The response is the audio file itself. Streaming is not supported: the audio is returned once synthesis is complete, and the backend timeout is 300 seconds." },
        {
          kind: "table",
          label: "Text-to-speech request parameters",
          head: ["Parameter", "Type", "Required", "Description"],
          rows: [
            ["`model`", "string", "Yes", "`indextts2`"],
            ["`input`", "string", "Yes", "Text to synthesize, up to 2,000 characters"],
            ["`voice`", "string", "Yes", "Voice id provided by Power Champion; an unregistered voice returns 400"],
            ["`response_format`", "string", "No", "`mp3` (default), `opus` (Ogg container), `wav`"],
            ["`speed`", "number", "No", "Not currently supported by indextts2; ignored"],
            ["`instruct`", "string", "No", "Emotion description, for example “開心、雀躍” (happy, excited)"],
            ["`emo_alpha`", "number", "No", "Emotion strength, 0–1; 0.6 recommended"],
          ],
        },
        { kind: "p", text: "Response headers: `X-Audio-Seconds` is the audio length in seconds, and `X-Usage-Tokens` is the billed amount (50 tokens per second)." },
        { kind: "code", label: "bash", code: EN_CODE.curlSpeech },
        { kind: "note", text: "Split long text by sentence and synthesize each part separately. You wait less, and you stay under the 2,000-character limit." },
        { kind: "h3", id: "transcriptions", text: "Speech recognition `POST /v1/audio/transcriptions`" },
        { kind: "p", text: "Transcribes audio to text. Chinese results are converted to Traditional Chinese (Taiwan). Upload the request as `multipart/form-data`." },
        {
          kind: "table",
          label: "Speech recognition request parameters",
          head: ["Parameter", "Type", "Required", "Description"],
          rows: [
            ["`file`", "file", "Yes", "Audio file, up to 25 MB; keep each segment to 600 seconds or less"],
            ["`model`", "string", "Yes", "`whisper-large-v3`"],
            ["`language`", "string", "No", "`zh` or `en`; detected automatically when left empty"],
            ["`prompt`", "string", "No", "Hints for proper nouns or terminology, which can improve accuracy"],
            ["`response_format`", "string", "No", "`json` (default, includes usage) or `text`"],
            ["`temperature`", "number", "No", "0–1"],
          ],
        },
        { kind: "code", label: "bash", code: EN_CODE.curlTranscribe },
        { kind: "code", label: "json", code: EN_CODE.transcribeResponse },
        { kind: "note", text: "Formats whose length can be read (such as wav and flac) return 400 when longer than 600 seconds; other formats are not guaranteed to be checked. Uploads over 25 MB return 413. Split long recordings into segments of 10 minutes or less before uploading." },
      ],
    },
    {
      id: "billing",
      title: "9. Billing: credit, balance and usage",
      blocks: [
        { kind: "p", text: "The platform is prepaid: you add credit first, and each request is charged for its actual usage once it completes. When the balance runs out, requests return 402. Failed requests, such as backend or validation errors, are not charged, and neither is a non-streaming request whose connection drops before the response arrives. If a stream is interrupted after it has started sending, the tokens already generated are still billed." },
        { kind: "h3", id: "credit-packs", text: "Credit packs" },
        {
          kind: "table",
          label: "Credit packs",
          head: ["Plan", "You pay", "Credited", "Bonus"],
          rows: [
            ["Starter", "US$10", "US$10.00", "—"],
            ["Builder", "US$50", "US$52.50", "5%"],
            ["Scale", "US$200", "US$224.00", "12%"],
          ],
        },
        { kind: "p", text: `Credit packs are delivered as redeem codes. Email ${MAIL} to buy one.` },
        { kind: "h3", id: "redeem", text: "Redeem a code `POST /v1/redeem`" },
        { kind: "code", label: "bash", code: EN_CODE.curlRedeem },
        { kind: "code", label: "json", code: EN_CODE.redeemResponse },
        {
          kind: "table",
          label: "Redeem status codes",
          head: ["Status", "Meaning"],
          rows: [
            ["200", "Credited; amounts are in units of 10⁻⁹ USD"],
            ["400", "No `code`, the body is not a JSON object, or this key does not support credit; the code is not consumed"],
            ["404", "The code does not exist"],
            ["409", "The code has already been used, disabled or expired"],
          ],
        },
        { kind: "h3", id: "balance-usage", text: "Balance and usage" },
        {
          kind: "table",
          label: "Balance and usage endpoints",
          head: ["Endpoint", "Returns", "Notes"],
          rows: [
            ["`GET /dashboard/billing/subscription`", "`plan.remaining_usd`", "Remaining balance; excludes reservations for in-flight requests, so it may read slightly high"],
            ["`GET /dashboard/billing/usage`", "`total_usage`, `total_usage_nano_usd`", "Cumulative historical spend (USD); date ranges are not supported"],
          ],
        },
        { kind: "code", label: "bash", code: EN_CODE.curlSubscription },
        { kind: "code", label: "json", code: EN_CODE.subscriptionResponse },
        { kind: "p", text: "There is no API for per-request records yet; ask us for a monthly report. Every response also reports usage: `usage` for text models, and the `X-Usage-Tokens` header for text to speech." },
        { kind: "h3", id: "billing-rules", text: "Billing rules" },
        { kind: "p", text: "Every model uses the same formula, priced at the list price when the request is accepted:" },
        { kind: "note", text: "**Cost (US$) = (input tokens × input price + output tokens × output price) ÷ 1,000,000**" },
        { kind: "p", text: "Non-text models are first converted into equivalent tokens:" },
        {
          kind: "table",
          label: "Token conversion for non-text models",
          head: ["Model type", "Conversion", "Result"],
          rows: [
            ["Image generation", "1,000 tokens per image × US$10 / 1M", "US$0.01 per image"],
            ["Text to speech", "50 tokens per second × US$10 / 1M", "US$0.03 per minute"],
            ["Speech recognition", "50 tokens per second × US$3.33 / 1M", "About US$0.01 per minute"],
          ],
        },
        { kind: "p", text: "Precision is 10⁻⁹ USD. Charges are applied after the response completes, so the last request can leave the balance slightly negative." },
      ],
    },
    {
      id: "rate-limits",
      title: "10. Rate limits and quotas",
      blocks: [
        { kind: "p", text: "Each key has four limits, and each model also has an overall capacity limit. The actual settings for your key are those agreed when it was issued — ask us if you need them. The platform does not send `X-RateLimit-*` headers." },
        {
          kind: "table",
          label: "Rate limits and quotas",
          head: ["Limit", "Rule", "When exceeded", "Retry-After"],
          rows: [
            ["Requests per minute", "60-second sliding window", "429 `Rate limit exceeded (N/min) for this key.`", "2 seconds"],
            ["Concurrent requests", "A streaming request counts until it ends", "429 `Key is at its concurrency limit`", "1 second"],
            ["Daily token quota", "Counted per UTC day, resets at 00:00 UTC", "429 `Daily token quota exhausted`", "None"],
            ["Prepaid balance", "Rejected once the balance runs out", "402 `Prepaid balance exhausted`", "0"],
            ["Model capacity", "The model is at full load overall", "429 `Model '<id>' is at capacity`", "2 seconds"],
          ],
        },
        { kind: "h3", id: "quota-reservation", text: "How the daily quota is reserved" },
        { kind: "p", text: "When a request is accepted, `max_tokens` (2,000 if not set) is reserved from the day's quota, then corrected to actual usage when the request completes; failed requests release their reservation. When the quota is nearly used up, a smaller `max_tokens` lets more requests through." },
        { kind: "h3", id: "rate-limit-handling", text: "Recommendations" },
        {
          kind: "ul",
          items: [
            "On a 429, wait for `Retry-After` and retry. If the daily quota is used up, wait until 00:00 UTC.",
            "For high-concurrency applications, add a queue in your code to keep in-flight requests within your key's limit.",
            `If you need higher limits, email ${MAIL} with your expected requests per minute, concurrency and daily usage.`,
          ],
        },
      ],
    },
    {
      id: "errors",
      title: "11. Error handling",
      blocks: [
        { kind: "p", text: "Errors use the OpenAI format. Only 429, 502 and 503 are worth retrying; for any other status code, fix the request first." },
        { kind: "h3", id: "error-format", text: "Error format" },
        { kind: "code", label: "json", code: EN_CODE.errorResponse },
        {
          kind: "table",
          label: "Error types and status codes",
          head: ["`type`", "Status codes"],
          rows: [
            ["`authentication_error`", "401 (`code` is `invalid_api_key`)"],
            ["`permission_error`", "403"],
            ["`invalid_request_error`", "400, 402, 404, 409, 413"],
            ["`rate_limit_error`", "429 (`code` may be `sellable_capacity_exhausted` when a model is at capacity)"],
            ["`server_error`", "500 and above"],
          ],
        },
        { kind: "note", text: "A few errors use `{\"detail\": ...}` instead: validation errors from the speech and image backends, 401 from `/dashboard/billing/*`, unknown paths (404), wrong methods (405) and query-parameter type errors (422). In addition, when the request body is not a JSON object (an array, for example), some endpoints may return a plain-text 500. Handle both formats when parsing errors. Error message text may change, so base your logic on the status code and `type`." },
        { kind: "h3", id: "status-codes", text: "Status codes" },
        {
          kind: "table",
          label: "Status codes",
          head: ["Status", "Common causes", "What to do"],
          rows: [
            ["400", "Malformed JSON, invalid field, context exceeded, audio over 600 seconds, unknown voice", "Fix the request; do not retry"],
            ["401", "Missing or invalid key", "Check the `Authorization` header"],
            ["402", "Prepaid balance exhausted", "Add credit, then try again"],
            ["403", "Restricted key used outside its scope or expired", "Check your key's scope with us"],
            ["404", "Model does not exist or is not available, redeem code does not exist, or unknown path", "Check the model id and path"],
            ["409", "Redeem code already used, disabled or expired", "Contact us"],
            ["413", "Speech recognition upload over 25 MB", "Compress or split the file and upload again"],
            ["429", "Rate, concurrency or daily quota exceeded, or the model is at capacity", "Wait for `Retry-After`, then retry"],
            ["500", "Unexpected server error", "Retry once; if it persists, contact us"],
            ["502", "Model backend unreachable (`All replicas failed`)", "Retry with exponential backoff; if it keeps failing, check the service status or switch models"],
            ["503", "Model under maintenance or being switched", "Wait for `Retry-After` (usually 30 or 600 seconds)"],
          ],
        },
        { kind: "h3", id: "check-order", text: "Check order" },
        { kind: "p", text: "When a request has several problems at once, the platform checks them in the order below and returns the first failure. When debugging, work down the table from the top." },
        {
          kind: "table",
          label: "Check order",
          head: ["Order", "Check", "On failure"],
          rows: [
            ["1", "Is the key valid?", "401"],
            ["2", "Is the request valid JSON?", "400"],
            ["3", "Is the key allowed to use this endpoint and model?", "403"],
            ["4", "Does the model exist and is it available?", "404"],
            ["5", "Is the model under maintenance or being switched?", "503"],
            ["6", "Concurrent in-flight requests for the key", "429"],
            ["7", "Prepaid balance", "402"],
            ["8", "Requests per minute", "429"],
            ["9", "Daily token quota", "429"],
            ["10", "Overall model capacity", "429"],
            ["11", "Model backend processing", "400 or 502"],
          ],
        },
        { kind: "note", text: "Field-validation 400s (for example, an unsupported image field) and the speech-recognition 413 may be returned earlier than this order suggests." },
        { kind: "h3", id: "retries", text: "Retry strategy" },
        {
          kind: "ol",
          items: [
            "Retry only 429, 502 and 503, plus network-level connection errors.",
            "If there is a `Retry-After`, wait that long. Otherwise use exponential backoff (1, 2, 4, 8 seconds) with random jitter, up to 4 attempts.",
            "Use streaming for generations expected to take longer than 60 seconds; non-streaming requests longer than about 100 seconds may be disconnected. If a long non-streaming request times out, check your balance or usage to see whether it was charged before you resend it.",
          ],
        },
        { kind: "code", label: "python", code: EN_CODE.pythonRetry },
        { kind: "p", text: "With the official OpenAI SDK, you can also set `max_retries` when you create the client and let the SDK handle retries." },
      ],
    },
    {
      id: "best-practices",
      title: "12. Best practices and security",
      blocks: [
        { kind: "h3", id: "performance", text: "Performance" },
        {
          kind: "ul",
          items: [
            "**Stream long answers**: users see content right away, and you avoid proxy timeouts.",
            "**Put fixed prefixes first**: keep system prompts and personas unchanged and at the start of `messages` to hit the prefix cache and lower time to first token.",
            "**Set a sensible `max_tokens`**: it controls cost and reduces the daily-quota reservation.",
            "**Retrieve with embeddings, then rerank**: take the top 50 candidates with bge-m3, then the top 5 with bge-reranker-v2-m3 for the chat model.",
            "**Split long audio**: keep speech-recognition segments to 10 minutes or less, and split text to speech by sentence.",
          ],
        },
        { kind: "h3", id: "reliability", text: "Reliability" },
        {
          kind: "ul",
          items: [
            "Have a fallback model for important flows: when the primary model returns 502 or 503, switch to a chat model that the service status shows as `ready`.",
            "Read `status.json` regularly for health checks instead of testing availability with real inference requests.",
            "Log each request's time (UTC), model, status code and `usage`, and include them when you report a problem.",
          ],
        },
        { kind: "h3", id: "cost-control", text: "Cost control" },
        {
          kind: "ul",
          items: [
            "Test with a small amount of credit before going live, and read `/dashboard/billing/subscription` regularly to watch the balance.",
            "Accumulate cost in your own system from each response's `usage`, and alert when the balance drops below a threshold.",
            "Choose flux-schnell when you only need drafts, and glm-5.3-flash-uncensored when you only need fast answers.",
          ],
        },
        { kind: "h3", id: "security-compliance", text: "Security and compliance" },
        {
          kind: "ul",
          items: [
            "Keep keys on the server. Front-end applications should go through your own backend.",
            "Do not put passwords, keys or unnecessary personal data in prompts.",
            "glm-5.3-flash-uncensored has no built-in content filtering. Add your own content moderation to products for the general public.",
            "Have generated content reviewed by a person before publishing it, and label it as AI-generated where applicable law requires.",
            "For how data is handled and retained, see the [Privacy Policy](/privacy) and the [Data Retention Policy](/data-retention).",
          ],
        },
      ],
    },
    {
      id: "appendix",
      title: "13. Appendix",
      blocks: [
        { kind: "h3", id: "endpoint-index", text: "A. Endpoint index" },
        {
          kind: "table",
          label: "Endpoint index",
          head: ["Method", "Path", "Purpose", "Key required"],
          rows: [
            ["GET", "`/v1/models`", "List the models and prices available to your key", "Yes"],
            ["POST", "`/v1/chat/completions`", "Chat, tool calling, image input", "Yes"],
            ["POST", "`/v1/completions`", "Text completions", "Yes"],
            ["POST", "`/v1/embeddings`", "Text embeddings", "Yes"],
            ["POST", "`/v1/rerank`", "Document reranking", "Yes"],
            ["POST", "`/v1/images/generations`, `/v1/images`", "Image generation", "Yes"],
            ["POST", "`/v1/audio/speech`", "Text to speech", "Yes"],
            ["POST", "`/v1/audio/transcriptions`", "Speech recognition", "Yes"],
            ["GET", "`/v1/personas/{persona_id}`", "Read a persona", "Yes"],
            ["POST", "`/v1/redeem`", "Redeem a credit code", "Yes"],
            ["GET", "`/dashboard/billing/subscription`", "Check balance", "Yes"],
            ["GET", "`/dashboard/billing/usage`", "Check cumulative usage", "Yes"],
            ["GET", `\`${STATUS_JSON}\``, "Live model status", "No"],
            ["GET", `\`${CATALOG_JSON}\``, "Public model catalog and list prices", "No"],
            ["GET", `\`${GATEWAY_URL}/health\``, "Gateway liveness check", "No"],
          ],
        },
        { kind: "h3", id: "not-supported", text: "B. Not currently supported" },
        {
          kind: "ul",
          items: [
            "Video generation.",
            "OpenAI Responses API, Assistants, Files, Batches, Moderations.",
            "Audio translation `/v1/audio/translations` and realtime speech (Realtime / WebSocket).",
            "Single-model lookup `/v1/models/{id}`.",
            "Self-service key requests or revocation, online payment, a per-request usage API, and webhook notifications for request results.",
          ],
        },
        { kind: "h3", id: "status-support", text: "C. Service status and support" },
        {
          kind: "table",
          label: "Service status and support",
          head: ["Item", "Where"],
          rows: [
            ["Service status page", "[powerchampion.ai/status](/status)"],
            ["Online developer docs", "[powerchampion.ai/docs/api](/docs/api)"],
            ["Terms of Service", "[powerchampion.ai/terms](/terms)"],
            ["Technical support and billing", MAIL],
          ],
        },
        { kind: "p", text: "When reporting a problem, include the time (UTC), model id, endpoint, status code, the full error message, and the first 12 characters of your key (never the full key)." },
        { kind: "h3", id: "changelog", text: "D. Changelog" },
        {
          kind: "table",
          label: "Changelog",
          head: ["Date", "Version", "Changes"],
          rows: [
            [API_REFERENCE_AS_OF, API_REFERENCE_VERSION, "First release, covering the endpoints and models in sections 1–12."],
          ],
        },
      ],
    },
  ],
};

export const API_REFERENCE_COPY: Record<Locale, ApiReferenceCopy> = { en: EN, zh: ZH };
