import {
  CHAT_LIMITS, chatError, deadline, isRecord, parseChatRequest, parseChatResult,
  privateServiceOrigin, readBounded, responseHeaders, sameOrigin, trialHeaders,
} from "../../../lib/chat-protocol";

export const dynamic = "force-dynamic";
const GATEWAY = "https://b300.powerchampion.ai/v1/chat/completions";
const TRIAL_ERRORS: Record<string, number> = {
  trial_unavailable: 503, trial_limit: 429, input: 400, authentication: 401,
  credits: 402, rate_limit: 429, gateway: 502, timeout: 504, cancelled: 499, response: 502,
};

export async function POST(request: Request) {
  if (!sameOrigin(request, true)) return chatError("origin", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return chatError("input", 415);
  if (Number(request.headers.get("content-length")) > CHAT_LIMITS.body) return chatError("too_large", 413);
  const timer = deadline(request, 45000);
  try {
    let value: unknown;
    try { value = JSON.parse(await readBounded(request.body, CHAT_LIMITS.body, timer.signal)); }
    catch (cause) {
      if (timer.signal.aborted) throw cause;
      return chatError(cause instanceof RangeError ? "too_large" : "input", cause instanceof RangeError ? 413 : 400);
    }
    const body = parseChatRequest(value);
    if (!body) return chatError("input", 400);
    const mode = body.key ? "live" : "trial";
    const url = new URL(request.url);
    const privateOrigin = mode === "trial" ? privateServiceOrigin(url) : null;
    if (mode === "trial" && !privateOrigin) return chatError("trial_unavailable", 503);
    const headers = mode === "live"
      ? new Headers({ Authorization: `Bearer ${body.key}`, "Content-Type": "application/json" })
      : trialHeaders(request);
    headers.set("Content-Type", "application/json");
    const upstream = await fetch(mode === "live" ? GATEWAY : `${privateOrigin}/api/portal/trial/chat`, {
      method: "POST", headers, redirect: "manual", cache: "no-store", signal: timer.signal,
      body: JSON.stringify(mode === "live" ? {
        model: body.model, stream: false, max_tokens: body.maxTokens,
        messages: [...(body.system.trim() ? [{ role: "system", content: body.system }] : []), ...body.messages],
      } : body),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return chatError("gateway", 502);
    }
    if (!upstream.ok && mode === "live") {
      await upstream.body?.cancel();
      if (upstream.status === 401 || upstream.status === 403) return chatError("authentication", 401);
      if (upstream.status === 402) return chatError("credits", 402);
      if (upstream.status === 429) return chatError("rate_limit", 429);
      return chatError("gateway", 502);
    }
    const payload: unknown = JSON.parse(await readBounded(upstream.body, CHAT_LIMITS.response, timer.signal));
    if (!upstream.ok) {
      if (isRecord(payload) && typeof payload.error === "string" && Object.hasOwn(TRIAL_ERRORS, payload.error)) {
        return Response.json({ error: payload.error }, {
          status: payload.error === "input" && upstream.status === 413 ? 413 : TRIAL_ERRORS[payload.error],
          headers: responseHeaders(upstream, url),
        });
      }
      return Response.json({ error: "trial_unavailable" }, { status: 503, headers: responseHeaders(upstream, url) });
    }
    const result = parseChatResult(payload, mode, body.key);
    if (!result) return chatError("response", 502);
    return Response.json(result, { headers: responseHeaders(mode === "trial" ? upstream : undefined, url) });
  } catch {
    if (timer.timedOut()) return chatError("timeout", 504);
    if (request.signal.aborted) return chatError("cancelled", 499);
    return chatError("gateway", 502);
  } finally { timer.close(); }
}
