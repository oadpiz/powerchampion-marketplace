import { isPlaygroundModel } from "./playground";

export const CHAT_LIMITS = {
  messages: 24, history: 32000, trialHistory: 8000, system: 16000,
  maxTokens: 4096, trialTokens: 512, body: 196608, response: 524288,
} as const;
export const CHAT_HEADERS = {
  "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow", Vary: "Cookie",
};
const TRIAL_COOKIE = "pc_trial_session";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatRequest = {
  key?: string; model: string; messages: ChatMessage[]; system: string; maxTokens: number;
};
export type ChatResult = {
  content: string; usage: { input: number; output: number; total: number } | null;
  finishReason: "stop" | "length" | "content_filter" | null; mode: "live" | "trial";
};
export type TrialConfig = {
  trialAvailable: boolean; maxOutputTokens: number; remaining?: number;
  maxHistoryCharacters?: number; maxSystemCharacters?: number; maxMessages?: number;
};

export function chatError(error: string, status: number) {
  return Response.json({ error }, { status, headers: CHAT_HEADERS });
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function parseChatRequest(value: unknown): ChatRequest | null {
  if (!isRecord(value) || !isPlaygroundModel(value.model) ||
    typeof value.system !== "string" || value.system.length > CHAT_LIMITS.system ||
    typeof value.maxTokens !== "number" || !Number.isInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > CHAT_LIMITS.maxTokens ||
    !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > CHAT_LIMITS.messages) return null;
  const key = value.key === "" || value.key === undefined ? undefined : value.key;
  if (key !== undefined && (typeof key !== "string" || !/^[\x21-\x7E]{8,512}$/.test(key))) return null;
  if (!key && value.maxTokens > CHAT_LIMITS.trialTokens) return null;
  const messages: ChatMessage[] = [];
  let characters = 0;
  for (const message of value.messages) {
    if (!isRecord(message) || (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" || !message.content.trim()) return null;
    characters += message.content.length;
    if (characters > (key ? CHAT_LIMITS.history : CHAT_LIMITS.trialHistory)) return null;
    messages.push({ role: message.role, content: message.content });
  }
  if (messages[messages.length - 1].role !== "user") return null;
  return { ...(key ? { key } : {}), model: value.model, messages, system: value.system, maxTokens: value.maxTokens };
}

export function sameOrigin(request: Request, required: boolean) {
  const origin = request.headers.get("origin");
  return !(required && !origin) && (!origin || origin === new URL(request.url).origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}

/** Mirrors the portal BFF policy; arbitrary paths and remote cleartext are denied. */
export function privateServiceOrigin(requestUrl: URL): string | null {
  const configured = process.env.PC_PORTAL_ORIGIN;
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname);
  if (!configured) return isLocal && requestUrl.protocol === "http:" ? "http://127.0.0.1:3020" : null;
  try {
    const target = new URL(configured);
    const localTarget = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
    if (target.username || target.password || target.pathname !== "/" || target.search || target.hash) return null;
    if (target.protocol !== "https:" && !(isLocal && localTarget && target.protocol === "http:")) return null;
    return target.origin;
  } catch { return null; }
}

export function trialHeaders(request: Request) {
  const headers = new Headers({ Accept: "application/json", Origin: new URL(request.url).origin });
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${TRIAL_COOKIE}=`));
  if (cookie && /^pc_trial_session=[a-zA-Z0-9_-]{20,200}$/.test(cookie)) headers.set("Cookie", cookie);
  return headers;
}

export function responseHeaders(upstream?: Response, url?: URL) {
  const headers = new Headers(CHAT_HEADERS);
  if (!upstream || !url) return headers;
  const cookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [upstream.headers.get("set-cookie") ?? ""];
  const cookie = cookies.find((value) => value.startsWith(`${TRIAL_COOKIE}=`));
  if (!cookie) return headers;
  const parts = cookie.split(";").map((part) => part.trim());
  const value = parts[0].slice(TRIAL_COOKIE.length + 1).replace(/^""$/, "");
  if (!/^[a-zA-Z0-9_-]{0,200}$/.test(value)) return headers;
  const age = parts.find((part) => /^max-age=-?\d{1,9}$/i.test(part));
  headers.set("Set-Cookie", [`${TRIAL_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", ...(age ? [age] : []), ...(url.protocol === "https:" ? ["Secure"] : [])].join("; "));
  return headers;
}

export function deadline(request: Request, milliseconds: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, milliseconds);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) controller.abort();
  return {
    signal: controller.signal, timedOut: () => timedOut,
    close: () => { clearTimeout(timer); request.signal.removeEventListener("abort", abort); },
  };
}

export async function readBounded(stream: ReadableStream<Uint8Array> | null, maximum: number, signal?: AbortSignal) {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new Error("aborted");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new Error("aborted");
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new RangeError("body size"); }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export function parseChatResult(value: unknown, mode: "live" | "trial", key?: string): ChatResult | null {
  if (!isRecord(value)) return null;
  let content: unknown;
  let finishReason: unknown;
  let rawUsage: unknown;
  if (mode === "live") {
    if (!Array.isArray(value.choices) || !isRecord(value.choices[0]) || !isRecord(value.choices[0].message)) return null;
    content = value.choices[0].message.content;
    finishReason = value.choices[0].finish_reason;
    rawUsage = isRecord(value.usage) ? { input: value.usage.prompt_tokens, output: value.usage.completion_tokens, total: value.usage.total_tokens } : null;
  } else {
    content = value.content;
    finishReason = value.finishReason;
    rawUsage = value.usage;
  }
  if (typeof content !== "string" || !content.trim()) return null;
  const usage = isRecord(rawUsage) && count(rawUsage.input) && count(rawUsage.output) && count(rawUsage.total)
    ? { input: rawUsage.input, output: rawUsage.output, total: rawUsage.total } : null;
  return {
    content: key ? content.split(key).join("[redacted]") : content, usage,
    finishReason: finishReason === "stop" || finishReason === "length" || finishReason === "content_filter" ? finishReason : null,
    mode,
  };
}

export function parseTrialConfig(value: unknown): TrialConfig | null {
  if (!isRecord(value) || typeof value.trialAvailable !== "boolean" || !count(value.maxOutputTokens) || value.maxOutputTokens < 1 || value.maxOutputTokens > CHAT_LIMITS.trialTokens) return null;
  const config: TrialConfig = { trialAvailable: value.trialAvailable, maxOutputTokens: value.maxOutputTokens };
  if (count(value.remaining)) config.remaining = value.remaining;
  const limits = { maxHistoryCharacters: CHAT_LIMITS.trialHistory, maxSystemCharacters: CHAT_LIMITS.system, maxMessages: CHAT_LIMITS.messages };
  for (const field of Object.keys(limits) as Array<keyof typeof limits>) {
    if (count(value[field]) && value[field] > 0 && value[field] <= limits[field]) config[field] = value[field];
  }
  return config;
}
