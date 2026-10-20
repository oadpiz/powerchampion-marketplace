/**
 * Customer-facing API reference for the b300 gateway (/docs/api).
 *
 * Prices and limits are a snapshot of the gateway's public
 * https://b300.powerchampion.ai/catalog.json, read on API_REFERENCE_AS_OF.
 * The gateway catalog stays the authority for rates; the page says so and
 * links to it. Live model readiness comes from /status.json at render time.
 *
 * Inline `code` in any string below is rendered as <code>.
 */
import type { Locale } from "./content";

export const API_REFERENCE_AS_OF = "2026-10-20";
export const API_BASE_URL = "https://b300.powerchampion.ai/v1";
export const GATEWAY_URL = "https://b300.powerchampion.ai";
export const SUPPORT_EMAIL = "info@powerchampion.org";

type Localized = Record<Locale, string>;

export type ApiReferenceModel = {
  id: string;
  use: Localized;
  endpoint: string;
  price: Localized;
  notes: Localized;
};

/** Snapshot of catalog.json on API_REFERENCE_AS_OF — all nine public models. */
export const API_REFERENCE_MODELS: readonly ApiReferenceModel[] = [
  {
    id: "glm-5.2-fp8",
    use: { en: "Chat, tool calling, JSON output", zh: "對話、工具呼叫、JSON 輸出" },
    endpoint: "/v1/chat/completions",
    price: { en: "$0.93 input / $3.00 output per 1M tokens", zh: "每百萬 token 輸入 0.93／輸出 3.00" },
    notes: { en: "131,072-token context; up to 32,768 output tokens", zh: "上下文 131,072，單次輸出最多 32,768" },
  },
  {
    id: "glm-5.3-flash-uncensored",
    use: { en: "Fast chat", zh: "快速對話" },
    endpoint: "/v1/chat/completions",
    price: { en: "$0.30 input / $1.00 output per 1M tokens", zh: "每百萬 token 輸入 0.30／輸出 1.00" },
    notes: { en: "32,768-token context; no content filtering — use is subject to the Terms", zh: "上下文 32,768；不做內容過濾，使用須遵守服務條款" },
  },
  {
    id: "qwen3-vl-30b",
    use: { en: "Vision chat (images in, text out)", zh: "看圖對話" },
    endpoint: "/v1/chat/completions",
    price: { en: "$0.30 input / $1.20 output per 1M tokens", zh: "每百萬 token 輸入 0.30／輸出 1.20" },
    notes: { en: "32,768-token context; up to 4 images per request; up to 4,096 output tokens", zh: "上下文 32,768，每次最多 4 張圖，輸出最多 4,096" },
  },
  {
    id: "bge-m3",
    use: { en: "Text embeddings", zh: "文字向量" },
    endpoint: "/v1/embeddings",
    price: { en: "$0.02 per 1M input tokens", zh: "每百萬 token 輸入 0.02" },
    notes: { en: "1,024 dimensions; 8,192-token context", zh: "1,024 維，上下文 8,192" },
  },
  {
    id: "bge-reranker-v2-m3",
    use: { en: "Reranking", zh: "重排序" },
    endpoint: "/v1/rerank",
    price: { en: "$0.02 per 1M input tokens", zh: "每百萬 token 輸入 0.02" },
    notes: { en: "8,192-token context", zh: "上下文 8,192" },
  },
  {
    id: "flux-schnell",
    use: { en: "Fast image generation", zh: "快速生圖" },
    endpoint: "/v1/images/generations",
    price: { en: "$0.01 per image", zh: "每張 0.01" },
    notes: { en: "4 steps by default", zh: "預設 4 步" },
  },
  {
    id: "chroma1-hd",
    use: { en: "High-quality image generation", zh: "高品質生圖" },
    endpoint: "/v1/images/generations",
    price: { en: "$0.01 per image", zh: "每張 0.01" },
    notes: { en: "Supports negative prompts; 25 steps by default", zh: "支援反向提示詞，預設 25 步" },
  },
  {
    id: "indextts2",
    use: { en: "Text to speech", zh: "語音合成" },
    endpoint: "/v1/audio/speech",
    price: { en: "$0.03 per minute of audio", zh: "每分鐘音訊 0.03" },
    notes: { en: "Voices are registered by our team", zh: "音色需由平台登錄" },
  },
  {
    id: "whisper-large-v3",
    use: { en: "Speech to text", zh: "語音辨識" },
    endpoint: "/v1/audio/transcriptions",
    price: { en: "About $0.01 per minute of audio", zh: "每分鐘音訊約 0.01" },
    notes: { en: "Chinese output is returned in Traditional Chinese (Taiwan)", zh: "中文輸出為台灣繁體" },
  },
];

export type ApiReferenceBlock =
  | { kind: "p"; text: string }
  | { kind: "note"; text: string }
  | { kind: "h3"; id: string; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "table"; label: string; head: string[]; rows: string[][] }
  | { kind: "code"; label: string; code: string }
  | { kind: "models" };

export type ApiReferenceSection = {
  id: string;
  title: string;
  blocks: ApiReferenceBlock[];
};

export type ApiReferenceCopy = {
  kicker: string;
  title: string;
  lead: string;
  asOf: string;
  backToDocs: string;
  tocLabel: string;
  tableScrollHint: string;
  models: {
    label: string;
    head: [string, string, string, string, string, string];
    online: string;
    offline: string;
    unknown: string;
    liveNote: string;
    fallbackNote: string;
  };
  sections: ApiReferenceSection[];
};

const KEY = "$B300_API_KEY";

const curlChat = (prompt: string) => `curl ${API_BASE_URL}/chat/completions \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"glm-5.2-fp8","messages":[{"role":"user","content":"${prompt}"}],"max_tokens":64}'`;

const pythonChat = (prompt: string) => `import os
from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE_URL}",
    api_key=os.environ["B300_API_KEY"],
)

resp = client.chat.completions.create(
    model="glm-5.2-fp8",
    messages=[{"role": "user", "content": "${prompt}"}],
    max_tokens=128,
)
print(resp.choices[0].message.content)
print(resp.usage)`;

const pythonStream = (prompt: string) => `stream = client.chat.completions.create(
    model="glm-5.2-fp8",
    messages=[{"role": "user", "content": "${prompt}"}],
    stream=True,
)
for chunk in stream:
    # Chunks may carry a usage field and no choices; skip those.
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`;

const pythonPersona = `import os, requests

persona = requests.get(
    "${API_BASE_URL}/personas/<persona-id>",
    headers={"Authorization": f"Bearer {os.environ['B300_API_KEY']}"},
    timeout=30,
).json()

messages = persona["messages_prefix"] + [{"role": "user", "content": "Hi"}]
resp = client.chat.completions.create(model="glm-5.2-fp8", messages=messages)`;

const curlVision = `curl ${API_BASE_URL}/chat/completions \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3-vl-30b",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this picture?"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,<BASE64>"}}
      ]
    }]
  }'`;

const pythonEmbeddings = `resp = client.embeddings.create(
    model="bge-m3",
    input=["first passage", "second passage"],
)
vector = resp.data[0].embedding  # 1,024 floats`;

const curlRerank = `curl ${API_BASE_URL}/rerank \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"bge-reranker-v2-m3","query":"refund policy","documents":["Shipping takes 3 days.","Refunds are issued within 14 days."],"top_n":1}'`;

const curlImages = `curl ${API_BASE_URL}/images/generations \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"flux-schnell","prompt":"a red fox in snow","size":"1024x1024","seed":7}'`;

const pythonImages = `import base64, os, requests

resp = requests.post(
    "${API_BASE_URL}/images/generations",
    headers={"Authorization": f"Bearer {os.environ['B300_API_KEY']}"},
    json={"model": "flux-schnell", "prompt": "a red fox in snow", "size": "1024x1024", "seed": 7},
    timeout=300,
)
resp.raise_for_status()
with open("fox.png", "wb") as f:
    f.write(base64.b64decode(resp.json()["data"][0]["b64_json"]))`;

const curlSpeech = (text: string) => `curl ${API_BASE_URL}/audio/speech \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"indextts2","input":"${text}","voice":"<voice-id>","response_format":"mp3"}' \\
  --output hello.mp3`;

const curlTranscribe = `curl ${API_BASE_URL}/audio/transcriptions \\
  -H "Authorization: Bearer ${KEY}" \\
  -F file=@voice.mp3 -F model=whisper-large-v3 -F language=zh`;

const pythonTranscribe = `with open("voice.mp3", "rb") as audio:
    result = client.audio.transcriptions.create(
        model="whisper-large-v3",
        file=audio,
        language="zh",
    )
print(result.text)`;

const curlRedeem = `curl ${API_BASE_URL}/redeem \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"code":"<redeem-code>"}'`;

const curlBalance = `curl ${GATEWAY_URL}/dashboard/billing/subscription \\
  -H "Authorization: Bearer ${KEY}"

curl ${GATEWAY_URL}/dashboard/billing/usage \\
  -H "Authorization: Bearer ${KEY}"`;

const pythonRetry = `import random, time
from openai import APIStatusError

RETRYABLE = {429, 502, 503}

def call_with_retry(make_request, attempts=4):
    for attempt in range(attempts + 1):
        try:
            return make_request()
        except APIStatusError as err:
            if err.status_code not in RETRYABLE or attempt == attempts:
                raise
            wait = err.response.headers.get("retry-after")
            delay = float(wait) if wait else 2 ** attempt
            time.sleep(delay + random.random() * 0.25)`;

const EN: ApiReferenceCopy = {
  kicker: "API reference",
  title: "API reference",
  lead: "Everything you need to call the b300 gateway: authentication, every endpoint and its limits, prices, billing, and how to handle errors. The gateway speaks the OpenAI API format, so existing SDKs work with a new base URL.",
  asOf: `Reflects production behaviour on ${API_REFERENCE_AS_OF}.`,
  backToDocs: "Back to the quick start",
  tocLabel: "On this page",
  tableScrollHint: "Scroll the table sideways to see every column.",
  models: {
    label: "Model price table",
    head: ["Model id", "Use", "Endpoint", "Price (USD)", "Notes", "Status now"],
    online: "Online",
    offline: "Offline",
    unknown: "Unknown",
    liveNote: "“Status now” comes from the live status feed and refreshes about once a minute.",
    fallbackNote: "Live status could not be loaded just now. Check the status page before you call a model.",
  },
  sections: [
    {
      id: "quick-start",
      title: "Quick start",
      blocks: [
        { kind: "p", text: "Point the OpenAI SDK at the b300 base URL and pass your platform key. Nothing else changes." },
        {
          kind: "table",
          label: "Connection details",
          head: ["Item", "Value"],
          rows: [
            ["Base URL", `\`${API_BASE_URL}\``],
            ["Authentication", "`Authorization: Bearer <your key>`"],
            ["Key format", "Starts with `sk-b300-`"],
            ["Getting a key", `Email [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}). Keys are issued by our team; there is no self-service sign-up yet.`],
            ["Adding credit", "Buy a redeem code from our team and apply it with `POST /v1/redeem` (see [Billing and balance](#billing))."],
          ],
        },
        { kind: "note", text: "Keep your key on the server. The gateway does not send CORS headers, so browser code cannot call it directly." },
        { kind: "h3", id: "first-request-curl", text: "Your first request with curl" },
        { kind: "code", label: "curl", code: curlChat("Hello") },
        { kind: "h3", id: "first-request-python", text: "Your first request with the Python OpenAI SDK" },
        { kind: "code", label: "Python", code: pythonChat("Describe Taipei in one sentence.") },
        { kind: "h3", id: "check-status", text: "Check model status first" },
        { kind: "p", text: `Not every model is online all the time. Before you call one, check the public \`${GATEWAY_URL}/status.json\` (no key needed): a model is available when its \`ready\` field is \`true\`. Calling a model that is offline returns 502. If an example on this page returns 502, switch to a model that status.json lists as ready.` },
      ],
    },
    {
      id: "models",
      title: "Models and prices",
      blocks: [
        { kind: "p", text: "Nine models cover chat, vision, embeddings, reranking, image generation, text to speech, and speech to text. Prices are in US dollars. Text models are billed per million tokens; the others are billed per image or per minute of audio." },
        { kind: "models" },
        { kind: "p", text: `Prices above are a snapshot of \`${GATEWAY_URL}/catalog.json\` taken on ${API_REFERENCE_AS_OF}. That catalog is the authoritative public price list and refreshes every 60 seconds; if it differs from this page, the catalog wins. See also [Pricing](/pricing) and [Service status](/status).` },
        { kind: "h3", id: "not-available", text: "Not available" },
        {
          kind: "ul",
          items: [
            "Video generation (`/v1/videos`) is not available yet. Calls return 404.",
            "Not supported: `/v1/responses`, Assistants, `/v1/files`, `/v1/batches`, `/v1/moderations`, audio translation, and single-model lookup at `/v1/models/{id}`.",
          ],
        },
      ],
    },
    {
      id: "auth",
      title: "Authentication, keys and rate limits",
      blocks: [
        { kind: "p", text: "Each key can carry four limits: requests per minute, a daily token quota, concurrent in-flight requests, and a prepaid balance. The numbers depend on how your key is set up — ask our team for yours. When you hit a limit you get a 429 or a 402, sometimes with a `Retry-After` header. The gateway does not send `X-RateLimit-*` headers." },
        {
          kind: "table",
          label: "Limits",
          head: ["Limit", "Rule", "Response when exceeded", "Retry-After"],
          rows: [
            ["Requests per minute", "60-second sliding window", "429 `Rate limit exceeded`", "2 seconds"],
            ["Concurrent requests", "A streaming request counts until it finishes", "429 `Key is at its concurrency limit`", "1 second"],
            ["Daily token quota", "Counted per UTC day; resets at 00:00 UTC (08:00 Taiwan time)", "429 `Daily token quota exhausted`", "None"],
            ["Prepaid balance", "Requests stop when the balance runs out", "402 `Prepaid balance exhausted`", "0"],
            ["Model capacity", "The model as a whole is at capacity", "429 `Model '<id>' is at capacity`", "2 seconds"],
          ],
        },
        { kind: "h3", id: "auth-behaviour", text: "Behaviour to know about" },
        {
          kind: "ul",
          items: [
            "The daily quota is reserved up front: when a request is accepted, its `max_tokens` (or 2,000 if you omit it) is set aside, then corrected to actual usage when it finishes. When you are close to the quota, a smaller `max_tokens` lets more requests through.",
            "Your balance can dip slightly below zero. Charges are applied after a response completes, so the last request may overrun.",
            "A disabled key stops working immediately and returns 401 `Invalid API key`.",
            "Restricted keys: some keys are limited to chat with specific models and have an expiry date. Calls outside that scope, or after expiry, return 403 (not 401). Ask our team what your key covers.",
            "There is no API to look up your key's limits yet; ask our team.",
          ],
        },
      ],
    },
    {
      id: "endpoints",
      title: "Endpoint reference",
      blocks: [
        { kind: "p", text: "Chat, completions and embeddings use the same request and response shapes as the OpenAI API. Images, speech and reranking have their own field limits, listed below. Every request needs `Authorization: Bearer <your key>`." },
        {
          kind: "table",
          label: "Endpoints",
          head: ["Method", "Path", "Purpose"],
          rows: [
            ["GET", "`/v1/models`", "List the models and prices available to your key"],
            ["POST", "`/v1/chat/completions`", "Chat (streaming, tool calling, JSON output, vision)"],
            ["POST", "`/v1/completions`", "Legacy text completion"],
            ["POST", "`/v1/embeddings`", "Text embeddings"],
            ["POST", "`/v1/rerank`", "Document reranking"],
            ["POST", "`/v1/images/generations` (alias `/v1/images`)", "Image generation"],
            ["POST", "`/v1/audio/speech`", "Text to speech"],
            ["POST", "`/v1/audio/transcriptions`", "Speech to text"],
            ["GET", "`/v1/personas/{id}`", "Fetch a persona our team has set up for you"],
            ["POST", "`/v1/redeem`", "Redeem a credit code"],
            ["GET", "`/dashboard/billing/subscription`", "Check your balance"],
            ["GET", "`/dashboard/billing/usage`", "Check total spend"],
            ["POST", "`/v1/videos`", "Not available yet (returns 404)"],
          ],
        },
        { kind: "h3", id: "endpoint-chat", text: "Chat — POST /v1/chat/completions" },
        { kind: "p", text: "`model` and `messages` are required. Other OpenAI parameters work as usual: `stream`, `tools` / `tool_choice`, `response_format` (`json_object` or `json_schema`), `temperature`, and `max_tokens`." },
        {
          kind: "ul",
          items: [
            "Streaming: `stream: true` returns server-sent events ending with `data: [DONE]`. Usage reporting is switched on automatically, so any chunk may carry a `usage` field — make your parser tolerate it. If an error happens mid-stream the connection simply closes; tokens generated up to that point are billed.",
            "`max_tokens` is lowered automatically when it exceeds the model's limit or the remaining context. You will not get an error for it.",
            "Vision: use `qwen3-vl-30b` and put `image_url` parts in the message content. `data:` base64 URLs are recommended. Up to 4 images per request.",
            "Personas: `GET /v1/personas/{id}` returns a `messages_prefix`. Put it at the start of `messages` on every call to hit the prompt cache and cut latency. Our team gives you the persona id.",
          ],
        },
        { kind: "code", label: "Python — streaming", code: pythonStream("List three places to visit in Tainan.") },
        { kind: "code", label: "curl — vision", code: curlVision },
        { kind: "code", label: "Python — persona prefix", code: pythonPersona },
        { kind: "h3", id: "endpoint-embeddings", text: "Embeddings — POST /v1/embeddings" },
        { kind: "p", text: "Send `{\"model\":\"bge-m3\",\"input\":\"text or an array of texts\"}` and get 1,024-dimension vectors back. `encoding_format` only supports `float`, and `dimensions` only supports `1024`." },
        { kind: "code", label: "Python", code: pythonEmbeddings },
        { kind: "h3", id: "endpoint-rerank", text: "Rerank — POST /v1/rerank" },
        { kind: "p", text: "Send `{\"model\":\"bge-reranker-v2-m3\",\"query\":\"…\",\"documents\":[\"…\",\"…\"]}`, optionally with `top_n` (1–100) and `return_documents`. The response lists `index` and `relevance_score`, sorted by relevance." },
        { kind: "code", label: "curl", code: curlRerank },
        { kind: "h3", id: "endpoint-images", text: "Images — POST /v1/images/generations" },
        { kind: "p", text: "Only the fields below are accepted. Any other field returns 400." },
        {
          kind: "table",
          label: "Image generation fields",
          head: ["Field", "Details"],
          rows: [
            ["`model`, `prompt`", "Required"],
            ["`n`", "1–4 images, billed per image"],
            ["`size`", "`WIDTHxHEIGHT`, each side 256–1536; default `1024x1024`"],
            ["`seed`", "0–4294967295; fix it to reproduce a result"],
            ["`steps`", "flux-schnell: default 4, max 8. chroma1-hd: default 25, max 50"],
            ["`negative_prompt`, `guidance_scale`", "chroma1-hd only. Sending `negative_prompt` to flux-schnell may return 400"],
            ["`style`", "`person`, `person_scene`, or `object`"],
            ["`response_format`", "Only `b64_json` (PNG). Image URLs are not returned"],
          ],
        },
        { kind: "code", label: "curl", code: curlImages },
        { kind: "code", label: "Python — save the PNG", code: pythonImages },
        { kind: "h3", id: "endpoint-speech", text: "Text to speech — POST /v1/audio/speech" },
        {
          kind: "ul",
          items: [
            "Fields: `model` (`indextts2`), `input` (up to 2,000 characters), `voice` (a voice id registered by our team — ask us for one), `response_format` (`mp3` by default, `opus`, or `wav`), `instruct` (a description of the emotion, for example “cheerful, excited”), and `emo_alpha` (0–1; 0.6 is a good start).",
            "The response body is the audio file. The `X-Audio-Seconds` header gives its length and `X-Usage-Tokens` the billed amount. Streaming is not supported: audio comes back once the whole input is synthesized, and a request times out after 300 seconds, so split long text into several requests.",
          ],
        },
        { kind: "code", label: "curl", code: curlSpeech("Thanks for calling.") },
        { kind: "h3", id: "endpoint-transcriptions", text: "Speech to text — POST /v1/audio/transcriptions" },
        {
          kind: "ul",
          items: [
            "Multipart upload: `file` (required), `model` (`whisper-large-v3`), `language` (`zh` or `en`; leave empty to auto-detect), `prompt`, and `temperature`.",
            "Keep the default `response_format` of `json`. It returns `text`, `language`, `duration`, and `usage`.",
            "Each file can be up to 600 seconds long; split longer recordings first. Chinese results are converted to Traditional Chinese (Taiwan).",
          ],
        },
        { kind: "code", label: "curl", code: curlTranscribe },
        { kind: "code", label: "Python", code: pythonTranscribe },
        { kind: "h3", id: "endpoint-videos", text: "Video — /v1/videos" },
        { kind: "note", text: "Video generation is not available yet. Calls return 404, and no video price is published." },
      ],
    },
    {
      id: "billing",
      title: "Billing and balance",
      blocks: [
        { kind: "p", text: "Billing is prepaid: you add credit with a redeem code, each completed request is deducted from your balance, and requests return 402 once the balance is used up. There is no online payment yet; our team delivers credit packs as redeem codes." },
        { kind: "h3", id: "redeem", text: "Adding credit" },
        {
          kind: "ol",
          items: [
            "Buy a credit pack from our team: Starter — pay US$10, get US$10.00 of credit. Builder — pay US$50, get US$52.50. Scale — pay US$200, get US$224.00.",
            "You receive a 32-character redeem code.",
            "Redeem it with your own key:",
          ],
        },
        { kind: "code", label: "curl", code: curlRedeem },
        { kind: "p", text: "A successful call returns `{\"ok\":true,\"credited_nano_usd\":…,\"new_balance_nano_usd\":…}`. Amounts are in nano-dollars: US$1 = 1,000,000,000 units. A code that was already used, disabled, or has expired returns 409; an unknown code returns 404." },
        { kind: "h3", id: "balance", text: "Checking balance and usage" },
        {
          kind: "table",
          label: "Balance endpoints",
          head: ["Endpoint", "Returns", "Note"],
          rows: [
            ["`GET /dashboard/billing/subscription`", "`plan.remaining_usd` — your remaining balance", "Does not subtract requests still in flight, so it may read slightly high"],
            ["`GET /dashboard/billing/usage`", "`total_usage` — total spend in US dollars", "Totals only; date ranges are not supported"],
          ],
        },
        { kind: "code", label: "curl", code: curlBalance },
        { kind: "p", text: "Every response also reports its own usage: the `usage` field for text models and the `X-Usage-Tokens` header for text to speech. There is no per-request statement API yet; ask our team for a monthly report." },
        { kind: "h3", id: "formula", text: "How charges are calculated" },
        { kind: "p", text: "Cost = (input tokens × input price + output tokens × output price) ÷ 1,000,000" },
        { kind: "p", text: "Non-text models are first converted to equivalent tokens and then priced with the same formula: 1,000 tokens per image and 50 tokens per second of audio. That is how an image comes to US$0.01, text to speech to US$0.03 per minute, and speech to text to about US$0.01 per minute. The price that applies is the one in effect when the request is accepted." },
      ],
    },
    {
      id: "errors",
      title: "Errors, retries and best practices",
      blocks: [
        { kind: "p", text: "Most `/v1/*` errors use the OpenAI shape `{\"error\":{\"message\",\"type\",\"param\",\"code\"}}`. The exceptions — errors passed through from the speech and image back ends, everything under `/dashboard/billing/*`, unknown paths, 405 and 422 — use `{\"detail\": …}`. Handle both shapes. Always send a JSON object as the request body; if you keep getting a 5xx you cannot explain, contact us." },
        {
          kind: "table",
          label: "Status codes",
          head: ["Status", "Meaning", "Retry?"],
          rows: [
            ["400", "Malformed request or invalid field (including unsupported parameters and audio over 600 seconds)", "No — fix the request first"],
            ["401", "Missing, invalid, or disabled key", "No"],
            ["402", "Prepaid balance used up", "After you add credit"],
            ["403", "Restricted key used outside its scope, or expired", "No"],
            ["404", "Model does not exist or is disabled, or the path does not exist", "No"],
            ["409", "Redeem code already used, disabled, or expired", "No"],
            ["429", "Rate limit, concurrency limit, daily quota, or model capacity reached", "Wait for `Retry-After`; for the daily quota, wait until 00:00 UTC"],
            ["502", "Model back end unreachable (`All replicas failed`)", "Yes, with exponential backoff. If it persists, check `/status.json`"],
            ["503", "Maintenance, or the model is being switched", "Wait for `Retry-After` (usually 30 or 600 seconds)"],
          ],
        },
        { kind: "h3", id: "retries", text: "Retrying" },
        {
          kind: "ol",
          items: [
            "Retry only 429, 502 and 503. Other status codes will not succeed on retry.",
            "If there is a `Retry-After` header, wait that long. Otherwise back off exponentially (1, 2, 4, 8 seconds), up to 4 retries.",
            "Do not automatically retry long non-streaming requests. A client-side timeout does not stop the work on our side, so check your balance or usage before resending. For generations you expect to take more than 60 seconds, use `stream: true`.",
          ],
        },
        { kind: "code", label: "Python — retry helper", code: pythonRetry },
        { kind: "h3", id: "best-practices", text: "Best practices" },
        {
          kind: "ul",
          items: [
            "Keep your key in a server-side environment variable — never in source code or front-end bundles.",
            "Stream long answers. Users see progress, and you avoid proxy timeouts.",
            "Set a sensible `max_tokens`. It caps spend and shrinks the daily-quota reservation.",
            "Put a fixed system prompt first in `messages` and keep it unchanged, so it hits the prefix cache and lowers time to first token.",
            "Split recordings longer than 10 minutes into pieces of 600 seconds or less before transcribing.",
            "Test with a small top-up before you go live, and watch your balance with `/dashboard/billing/subscription`.",
          ],
        },
      ],
    },
    {
      id: "support",
      title: "Support",
      blocks: [
        { kind: "p", text: `Email [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}) with the time it happened (UTC), the model id, the status code, and the error message. Never send a full API key by email.` },
      ],
    },
  ],
};

const ZH: ApiReferenceCopy = {
  kicker: "API 參考手冊",
  title: "API 參考手冊",
  lead: "呼叫 b300 閘道所需的一切：驗證方式、所有端點與限制、價格、計費，以及錯誤處理。閘道採用 OpenAI API 格式，現有 SDK 只要換掉 base URL 就能使用。",
  asOf: `內容依 ${API_REFERENCE_AS_OF} 生產環境的實際行為撰寫。`,
  backToDocs: "回到快速開始",
  tocLabel: "本頁內容",
  tableScrollHint: "表格可左右滑動查看所有欄位。",
  models: {
    label: "模型價格表",
    head: ["模型 id", "用途", "端點", "價格（USD）", "備註", "目前狀態"],
    online: "上線中",
    offline: "離線",
    unknown: "未知",
    liveNote: "「目前狀態」取自即時狀態資料，約每分鐘更新一次。",
    fallbackNote: "目前無法載入即時狀態，呼叫模型前請先查看狀態頁。",
  },
  sections: [
    {
      id: "quick-start",
      title: "快速開始",
      blocks: [
        { kind: "p", text: "只要把 OpenAI SDK 的 base URL 改成 b300，再放入平台金鑰，就能呼叫。" },
        {
          kind: "table",
          label: "連線資訊",
          head: ["項目", "值"],
          rows: [
            ["Base URL", `\`${API_BASE_URL}\``],
            ["驗證", "`Authorization: Bearer <金鑰>`"],
            ["金鑰格式", "`sk-b300-` 開頭"],
            ["取得金鑰", `寫信到 [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL}) 申請，由我們的團隊簽發（目前沒有自助申請）`],
            ["儲值", "向我們購買兌換碼，用 `POST /v1/redeem` 入帳（見[計費與餘額](#billing)）"],
          ],
        },
        { kind: "note", text: "金鑰只能放在伺服器端。閘道沒有開 CORS，瀏覽器端的程式不能直接呼叫。" },
        { kind: "h3", id: "first-request-curl", text: "第一個請求：curl" },
        { kind: "code", label: "curl", code: curlChat("你好") },
        { kind: "h3", id: "first-request-python", text: "第一個請求：Python OpenAI SDK" },
        { kind: "code", label: "Python", code: pythonChat("用一句話介紹台北") },
        { kind: "h3", id: "check-status", text: "開始前先看模型狀態" },
        { kind: "p", text: `不是每個模型隨時都在線上。呼叫前可以先看公開的 \`${GATEWAY_URL}/status.json\`（不需要金鑰），每個模型的 \`ready\` 欄位是 \`true\` 才代表可用。呼叫離線的模型會收到 502；範例中的模型若回 502，請改用 status.json 中 ready 的模型。` },
      ],
    },
    {
      id: "models",
      title: "模型與價格",
      blocks: [
        { kind: "p", text: "目前開放 9 個模型，涵蓋對話、看圖、向量、重排序、生圖、語音合成與語音辨識。價格以美元計，文字模型按每百萬 token 計費，其他模型按張數或音訊分鐘數計費。" },
        { kind: "models" },
        { kind: "p", text: `上表價格是 ${API_REFERENCE_AS_OF} 讀取 \`${GATEWAY_URL}/catalog.json\` 的快照。該目錄是公開價格的權威來源，每 60 秒更新；與本頁不同時，以目錄為準。另見[價格](/pricing)與[服務狀態](/status)。` },
        { kind: "h3", id: "not-available", text: "尚未提供的功能" },
        {
          kind: "ul",
          items: [
            "影片生成（`/v1/videos`）尚未開放，呼叫會回 404。",
            "不支援：`/v1/responses`、Assistants、`/v1/files`、`/v1/batches`、`/v1/moderations`、語音翻譯，以及單一模型查詢 `/v1/models/{id}`。",
          ],
        },
      ],
    },
    {
      id: "auth",
      title: "驗證、金鑰與限流",
      blocks: [
        { kind: "p", text: "每把金鑰可以有四種限制：每分鐘請求數、每日 token 額度、同時進行中的請求數、預付餘額。實際數字依你的金鑰設定，請向我們詢問。超過時回 429 或 402，部分會帶 `Retry-After` 標頭；閘道不提供 `X-RateLimit-*` 標頭。" },
        {
          kind: "table",
          label: "限制",
          head: ["限制", "規則", "超過時的回應", "Retry-After"],
          rows: [
            ["每分鐘請求數", "60 秒滑動視窗", "429 `Rate limit exceeded`", "2 秒"],
            ["同時進行中", "串流請求會佔用到結束", "429 `Key is at its concurrency limit`", "1 秒"],
            ["每日 token 額度", "以 UTC 日計算，UTC 00:00（台灣 08:00）重置", "429 `Daily token quota exhausted`", "無"],
            ["預付餘額", "餘額用完即拒絕", "402 `Prepaid balance exhausted`", "0"],
            ["模型容量", "模型整體滿載", "429 `Model '<id>' is at capacity`", "2 秒"],
          ],
        },
        { kind: "h3", id: "auth-behaviour", text: "要注意的行為" },
        {
          kind: "ul",
          items: [
            "每日額度會先預留：受理時先扣請求的 `max_tokens`（沒帶就扣 2,000），完成後按實際用量校正。額度快用完時，把 `max_tokens` 設小一點可以多幾次通過。",
            "餘額可能略為負數：扣款發生在回應完成後，所以最後一筆可能超支。",
            "停用的金鑰立即失效，回 401 `Invalid API key`。",
            "受限金鑰：部分金鑰只授權特定模型的對話，並有到期日。超出範圍或過期都回 403（不是 401），請向我們確認金鑰範圍。",
            "目前沒有查詢金鑰限制的 API，請向我們詢問自己的設定。",
          ],
        },
      ],
    },
    {
      id: "endpoints",
      title: "端點參考",
      blocks: [
        { kind: "p", text: "對話、補全、向量的請求與回應格式跟 OpenAI 相同；生圖、語音、重排序有各自的欄位限制，寫在下面。所有請求都要帶 `Authorization: Bearer <金鑰>`。" },
        {
          kind: "table",
          label: "端點",
          head: ["方法", "路徑", "用途"],
          rows: [
            ["GET", "`/v1/models`", "列出你的金鑰可用的模型與價格"],
            ["POST", "`/v1/chat/completions`", "對話（支援串流、工具呼叫、JSON 輸出、看圖）"],
            ["POST", "`/v1/completions`", "舊式文字補全"],
            ["POST", "`/v1/embeddings`", "文字向量"],
            ["POST", "`/v1/rerank`", "文件重排序"],
            ["POST", "`/v1/images/generations`（另名 `/v1/images`）", "生圖"],
            ["POST", "`/v1/audio/speech`", "語音合成"],
            ["POST", "`/v1/audio/transcriptions`", "語音辨識"],
            ["GET", "`/v1/personas/{id}`", "讀取我們為你建立的角色設定"],
            ["POST", "`/v1/redeem`", "兌換儲值碼"],
            ["GET", "`/dashboard/billing/subscription`", "查餘額"],
            ["GET", "`/dashboard/billing/usage`", "查累計花費"],
            ["POST", "`/v1/videos`", "尚未開放（回 404）"],
          ],
        },
        { kind: "h3", id: "endpoint-chat", text: "對話：POST /v1/chat/completions" },
        { kind: "p", text: "必填 `model` 與 `messages`，其他 OpenAI 參數照常使用：`stream`、`tools`／`tool_choice`、`response_format`（`json_object` 或 `json_schema`）、`temperature`、`max_tokens`。" },
        {
          kind: "ul",
          items: [
            "串流：`stream: true` 回傳 SSE，以 `data: [DONE]` 結束。閘道會自動開啟用量回報，每個 chunk 都可能帶 `usage` 欄位，解析時要能容忍。串流中途出錯時連線會直接中斷，已產生的 token 照樣計費。",
            "`max_tokens` 會被自動下修：超過模型上限或剩餘上下文時，閘道會直接調低，不會報錯。",
            "看圖：用 `qwen3-vl-30b`，在 content 裡放 `image_url`（建議用 `data:` base64），每次最多 4 張。",
            "角色設定：用 `GET /v1/personas/{id}` 取得 `messages_prefix`，放在每次 `messages` 最前面，可以命中快取、降低延遲。persona id 由我們提供。",
          ],
        },
        { kind: "code", label: "Python：串流", code: pythonStream("列出三個台南景點") },
        { kind: "code", label: "curl：看圖", code: curlVision },
        { kind: "code", label: "Python：角色設定前綴", code: pythonPersona },
        { kind: "h3", id: "endpoint-embeddings", text: "向量：POST /v1/embeddings" },
        { kind: "p", text: "送出 `{\"model\":\"bge-m3\",\"input\":\"文字或文字陣列\"}`，回傳 1,024 維向量。`encoding_format` 只支援 `float`，`dimensions` 只支援 `1024`。" },
        { kind: "code", label: "Python", code: pythonEmbeddings },
        { kind: "h3", id: "endpoint-rerank", text: "重排序：POST /v1/rerank" },
        { kind: "p", text: "送出 `{\"model\":\"bge-reranker-v2-m3\",\"query\":\"問題\",\"documents\":[\"…\",\"…\"]}`，可選用 `top_n`（1–100）與 `return_documents`。回傳依相關度排序的 `index` 與 `relevance_score`。" },
        { kind: "code", label: "curl", code: curlRerank },
        { kind: "h3", id: "endpoint-images", text: "生圖：POST /v1/images/generations" },
        { kind: "p", text: "只接受以下欄位，多帶其他欄位會回 400。" },
        {
          kind: "table",
          label: "生圖欄位",
          head: ["欄位", "說明"],
          rows: [
            ["`model`、`prompt`", "必填"],
            ["`n`", "1–4 張，按張計費"],
            ["`size`", "`寬x高`，每邊 256–1536，預設 `1024x1024`"],
            ["`seed`", "0–4294967295，固定後可重現結果"],
            ["`steps`", "flux-schnell 預設 4、上限 8；chroma1-hd 預設 25、上限 50"],
            ["`negative_prompt`、`guidance_scale`", "只用於 chroma1-hd；對 flux-schnell 送 `negative_prompt` 可能回 400"],
            ["`style`", "`person`、`person_scene`、`object`"],
            ["`response_format`", "只回傳 `b64_json`（PNG），沒有圖片網址"],
          ],
        },
        { kind: "code", label: "curl", code: curlImages },
        { kind: "code", label: "Python：存成 PNG", code: pythonImages },
        { kind: "h3", id: "endpoint-speech", text: "語音合成：POST /v1/audio/speech" },
        {
          kind: "ul",
          items: [
            "欄位：`model`（`indextts2`）、`input`（最多 2,000 字）、`voice`（我們登錄的音色 id，請向我們索取）、`response_format`（預設 `mp3`，另有 `opus`、`wav`）、`instruct`（情緒描述，例如「開心、雀躍」）、`emo_alpha`（0–1，建議 0.6）。",
            "回傳音檔本體，標頭 `X-Audio-Seconds` 是音檔秒數、`X-Usage-Tokens` 是計費量。不支援串流，整句合成完才回傳；處理逾時為 300 秒，長文字請分段送。",
          ],
        },
        { kind: "code", label: "curl", code: curlSpeech("歡迎來電") },
        { kind: "h3", id: "endpoint-transcriptions", text: "語音辨識：POST /v1/audio/transcriptions" },
        {
          kind: "ul",
          items: [
            "multipart 上傳：`file`（必填）、`model`（`whisper-large-v3`）、`language`（`zh`、`en`，留空自動偵測）、`prompt`、`temperature`。",
            "`response_format` 請用預設的 `json`，回傳 `text`、`language`、`duration` 與 `usage`。",
            "每個音檔最長 600 秒，更長的請先切段。中文結果會轉成台灣繁體。",
          ],
        },
        { kind: "code", label: "curl", code: curlTranscribe },
        { kind: "code", label: "Python", code: pythonTranscribe },
        { kind: "h3", id: "endpoint-videos", text: "影片：/v1/videos" },
        { kind: "note", text: "影片生成尚未開放，呼叫會回 404，目前也沒有公布影片價格。" },
      ],
    },
    {
      id: "billing",
      title: "計費與餘額",
      blocks: [
        { kind: "p", text: "採預付制：先用兌換碼儲值，每次請求完成後從餘額扣款，餘額用完回 402。目前沒有線上付款，儲值包由我們以兌換碼交付。" },
        { kind: "h3", id: "redeem", text: "儲值流程" },
        {
          kind: "ol",
          items: [
            "向我們購買儲值包：Starter 付 US$10 得 US$10.00 餘額；Builder 付 US$50 得 US$52.50；Scale 付 US$200 得 US$224.00。",
            "收到 32 字元的兌換碼。",
            "用自己的金鑰呼叫兌換：",
          ],
        },
        { kind: "code", label: "curl", code: curlRedeem },
        { kind: "p", text: "成功回傳 `{\"ok\":true,\"credited_nano_usd\":…,\"new_balance_nano_usd\":…}`，金額單位是 10⁻⁹ 美元（1 美元 = 1,000,000,000 單位）。碼已用過、停用或過期回 409，碼錯誤回 404。" },
        { kind: "h3", id: "balance", text: "查餘額與用量" },
        {
          kind: "table",
          label: "餘額端點",
          head: ["端點", "回傳", "注意"],
          rows: [
            ["`GET /dashboard/billing/subscription`", "`plan.remaining_usd` 是剩餘金額", "沒有扣掉進行中的請求，可能略高"],
            ["`GET /dashboard/billing/usage`", "`total_usage` 是累計花費（美元）", "只有總額，不支援日期區間"],
          ],
        },
        { kind: "code", label: "curl", code: curlBalance },
        { kind: "p", text: "每次回應本身也帶用量：文字模型看 `usage` 欄位，語音合成看 `X-Usage-Tokens` 標頭。目前沒有逐筆明細的 API，需要月報請向我們索取。" },
        { kind: "h3", id: "formula", text: "計費公式" },
        { kind: "p", text: "費用 =（輸入 token × 輸入單價 ＋ 輸出 token × 輸出單價）÷ 1,000,000" },
        { kind: "p", text: "非文字模型會先換算成等值 token 再套同一公式：每張圖 1,000 token，每秒音訊 50 token。所以生圖每張 US$0.01，語音合成每分鐘 US$0.03，語音辨識每分鐘約 US$0.01。價格以請求受理當下為準。" },
      ],
    },
    {
      id: "errors",
      title: "錯誤碼、重試與最佳實務",
      blocks: [
        { kind: "p", text: "`/v1/*` 的錯誤多數是 OpenAI 格式 `{\"error\":{\"message\",\"type\",\"param\",\"code\"}}`。例外是語音、生圖後端轉回的錯誤、`/dashboard/billing/*`、不存在的路徑、405 與 422，它們的格式是 `{\"detail\": …}`，解析時兩種都要處理。請求體請一律送 JSON 物件；若持續收到無法解釋的 5xx，請聯絡我們。" },
        {
          kind: "table",
          label: "狀態碼",
          head: ["狀態碼", "意思", "該不該重試"],
          rows: [
            ["400", "請求格式或欄位錯誤（含不支援的參數、音檔超過 600 秒）", "不要，先修正請求"],
            ["401", "缺少金鑰、金鑰無效或已停用", "不要"],
            ["402", "預付餘額用完", "儲值後再試"],
            ["403", "受限金鑰超出範圍或已過期", "不要"],
            ["404", "模型不存在、已停用，或路徑不存在", "不要"],
            ["409", "兌換碼已用過、停用或過期", "不要"],
            ["429", "超過限流、並發上限、每日額度或模型滿載", "依 `Retry-After` 等待；每日額度等到 UTC 00:00"],
            ["502", "模型後端連不上（`All replicas failed`）", "可以，建議指數退避；持續失敗請看 `/status.json`"],
            ["503", "維護中或模型正在切換", "依 `Retry-After` 等待（通常 30 或 600 秒）"],
          ],
        },
        { kind: "h3", id: "retries", text: "重試建議" },
        {
          kind: "ol",
          items: [
            "只重試 429、502、503，其他狀態碼重試也不會成功。",
            "有 `Retry-After` 就照它等；沒有就用指數退避（1、2、4、8 秒），最多 4 次。",
            "非串流的長請求先不要自動重試：客戶端逾時不代表後端停止運算，重送前請先用餘額或用量確認是否已扣款。預計超過 60 秒的生成，請改用 `stream: true`。",
          ],
        },
        { kind: "code", label: "Python：重試輔助函式", code: pythonRetry },
        { kind: "h3", id: "best-practices", text: "最佳實務" },
        {
          kind: "ul",
          items: [
            "金鑰放在伺服器端的環境變數，不要寫進程式碼或前端。",
            "長回答一律用串流，使用者看得到進度，也避開代理層逾時。",
            "自己設定合理的 `max_tokens`：可以控制花費，也讓每日額度預留變少。",
            "固定的系統提示放在 `messages` 最前面且內容不變，可以命中前綴快取、降低首字延遲。",
            "語音辨識超過 10 分鐘的音檔先切段，每段不超過 600 秒。",
            "上線前先用小額儲值測試，定期用 `/dashboard/billing/subscription` 監看餘額。",
          ],
        },
      ],
    },
    {
      id: "support",
      title: "支援",
      blocks: [
        { kind: "p", text: `問題回報請寄到 [${SUPPORT_EMAIL}](mailto:${SUPPORT_EMAIL})，附上發生時間（UTC）、模型 id、狀態碼與錯誤訊息。請勿透過電子郵件傳送完整 API 金鑰。` },
      ],
    },
  ],
};

export const API_REFERENCE_COPY: Record<Locale, ApiReferenceCopy> = { en: EN, zh: ZH };
