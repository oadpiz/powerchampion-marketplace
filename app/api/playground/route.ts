import { isPlaygroundModel, PLAYGROUND_LIMITS, type PlaygroundResult } from "../../../lib/playground";

export const dynamic = "force-dynamic";
const UPSTREAM = "https://b300.powerchampion.ai/v1/chat/completions";
const RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" };

function error(code: string, status: number) {
  return Response.json({ error: code }, { status, headers: RESPONSE_HEADERS });
}

async function boundedText(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError("Body too large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return error("origin", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return error("input", 415);
  if (Number(request.headers.get("content-length")) > 65536) return error("too_large", 413);

  let body: unknown;
  try {
    body = JSON.parse(await boundedText(request.body, 65536));
  } catch (cause) {
    return error(cause instanceof RangeError ? "too_large" : "input", cause instanceof RangeError ? 413 : 400);
  }
  if (!record(body)) return error("input", 400);
  const { key, model, prompt, system, maxTokens } = body;
  if (typeof key !== "string" || !/^[\x21-\x7E]{8,512}$/.test(key) || !isPlaygroundModel(model) ||
    typeof prompt !== "string" || !prompt.trim() || prompt.length > PLAYGROUND_LIMITS.prompt ||
    typeof system !== "string" || system.length > PLAYGROUND_LIMITS.system ||
    typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > PLAYGROUND_LIMITS.maxTokens) {
    return error("input", 400);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 45000);
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      body: JSON.stringify({
        model, stream: false, max_tokens: maxTokens,
        messages: [
          ...(system.trim() ? [{ role: "system", content: system.trim() }] : []),
          { role: "user", content: prompt.trim() },
        ],
      }),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      if (upstream.status === 401 || upstream.status === 403) return error("authentication", 401);
      if (upstream.status === 402) return error("credits", 402);
      if (upstream.status === 429) return error("rate_limit", 429);
      return error("gateway", 502);
    }

    const payload: unknown = JSON.parse(await boundedText(upstream.body, 524288));
    if (!record(payload) || !Array.isArray(payload.choices) || !record(payload.choices[0])) return error("response", 502);
    const choice = payload.choices[0];
    if (!record(choice.message)) return error("response", 502);
    const message = choice.message;
    const content = typeof message.content === "string" ? message.content : "";
    const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : null;
    if (!content && !reasoning) return error("response", 502);
    const redact = (value: string) => value.split(key).join("[redacted]");
    const usage = record(payload.usage) ? {
      input: tokenCount(payload.usage.prompt_tokens), output: tokenCount(payload.usage.completion_tokens), total: tokenCount(payload.usage.total_tokens),
    } : null;
    const result: PlaygroundResult = {
      content: redact(content), reasoning: reasoning === null ? null : redact(reasoning),
      finishReason: choice.finish_reason === "stop" || choice.finish_reason === "length" || choice.finish_reason === "content_filter" ? choice.finish_reason : null,
      usage,
    };
    return Response.json(result, { headers: RESPONSE_HEADERS });
  } catch {
    if (timedOut) return error("timeout", 504);
    if (request.signal.aborted) return error("cancelled", 499);
    return error("gateway", 502);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", cancel);
  }
}
