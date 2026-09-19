/**
 * One endpoint per stored agent, for server-to-server use.
 *
 *   POST /api/agents/<agentId>/chat
 *   Authorization: Bearer <your Power Champion API key>   → pays for the call
 *   X-PC-Agent-Token: pca_…                               → proves access to this agent
 *
 * The agent's stored configuration becomes one system message; the customer's
 * key is forwarded to the fixed gateway for this request and never stored. No
 * cookie is read or set, so there is no browser session to forge, and no CORS
 * header is returned: this is called from a server, not from a page.
 */
import {
  CHAT_LIMITS, chatError, deadline, isRecord, parseChatResult,
  privateServiceOrigin, readBounded, responseHeaders,
} from "../../../../lib/chat-protocol";

export const dynamic = "force-dynamic";

const GATEWAY = "https://b300.powerchampion.ai/v1/chat/completions";
const AGENT_ID = /^[a-f0-9]{32}$/;
const AGENT_TOKEN = /^pca_[A-Za-z0-9_-]{16,180}$/;
const KEY = /^[\x21-\x7E]{8,512}$/;

type ResolvedAgent = { id: string; name: string; version: number; model: string; system: string; maxOutputTokens: number };

function parseMessages(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > CHAT_LIMITS.messages) return null;
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  let characters = 0;
  for (const message of value.messages) {
    if (!isRecord(message) || (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" || !message.content.trim()) return null;
    characters += message.content.length;
    if (characters > CHAT_LIMITS.history) return null;
    messages.push({ role: message.role, content: message.content });
  }
  if (messages[messages.length - 1].role !== "user") return null;
  const requested = value.maxTokens;
  if (requested !== undefined && (typeof requested !== "number" || !Number.isInteger(requested) || requested < 1 || requested > CHAT_LIMITS.maxTokens)) return null;
  return { messages, requested: requested as number | undefined };
}

function parseAgent(value: unknown, agentId: string): ResolvedAgent | null {
  if (!isRecord(value) || !isRecord(value.agent)) return null;
  const agent = value.agent;
  if (agent.id !== agentId || typeof agent.name !== "string" || typeof agent.model !== "string" ||
    typeof agent.system !== "string" || !agent.system.trim() ||
    typeof agent.version !== "number" || typeof agent.maxOutputTokens !== "number" ||
    !Number.isInteger(agent.maxOutputTokens) || agent.maxOutputTokens < 1 || agent.maxOutputTokens > CHAT_LIMITS.maxTokens) return null;
  return { id: agent.id, name: agent.name, version: agent.version, model: agent.model, system: agent.system, maxOutputTokens: agent.maxOutputTokens };
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  if (!AGENT_ID.test(agentId)) return chatError("agent_not_found", 404);
  const token = request.headers.get("x-pc-agent-token") ?? "";
  if (!AGENT_TOKEN.test(token)) return chatError("agent_token", 401);
  const key = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!KEY.test(key)) return chatError("authentication", 401);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return chatError("input", 415);
  if (Number(request.headers.get("content-length")) > CHAT_LIMITS.body) return chatError("too_large", 413);

  const url = new URL(request.url);
  const serviceOrigin = privateServiceOrigin(url);
  if (!serviceOrigin) return chatError("agent_service_unavailable", 503);
  const timer = deadline(request, 45000);
  try {
    let body: unknown;
    try { body = JSON.parse(await readBounded(request.body, CHAT_LIMITS.body, timer.signal)); }
    catch (cause) {
      if (timer.signal.aborted) throw cause;
      return chatError(cause instanceof RangeError ? "too_large" : "input", cause instanceof RangeError ? 413 : 400);
    }
    const parsed = parseMessages(body);
    if (!parsed) return chatError("input", 400);

    const lookup = await fetch(`${serviceOrigin}/api/portal/agents/resolve`, {
      method: "POST", redirect: "manual", cache: "no-store", signal: timer.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json", Origin: url.origin },
      body: JSON.stringify({ token }),
    });
    if (!lookup.ok) { await lookup.body?.cancel(); return chatError(lookup.status >= 500 ? "agent_service_unavailable" : "agent_not_found", lookup.status >= 500 ? 503 : 404); }
    const agent = parseAgent(JSON.parse(await readBounded(lookup.body, 262144, timer.signal)), agentId);
    if (!agent) return chatError("agent_not_found", 404);

    const upstream = await fetch(GATEWAY, {
      method: "POST", redirect: "manual", cache: "no-store", signal: timer.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: agent.model, stream: false,
        max_tokens: Math.min(parsed.requested ?? agent.maxOutputTokens, agent.maxOutputTokens),
        messages: [{ role: "system", content: agent.system }, ...parsed.messages],
      }),
    });
    if (!upstream.ok || (upstream.status >= 300 && upstream.status < 400)) {
      await upstream.body?.cancel();
      if (upstream.status === 401 || upstream.status === 403) return chatError("authentication", 401);
      if (upstream.status === 402) return chatError("credits", 402);
      if (upstream.status === 429) return chatError("rate_limit", 429);
      return chatError("gateway", 502);
    }
    const result = parseChatResult(JSON.parse(await readBounded(upstream.body, CHAT_LIMITS.response, timer.signal)), "live", key);
    if (!result) return chatError("response", 502);
    return Response.json({
      content: result.content, usage: result.usage, finishReason: result.finishReason,
      agent: { id: agent.id, name: agent.name, version: agent.version, model: agent.model },
    }, { headers: responseHeaders(undefined, url) });
  } catch {
    if (timer.timedOut()) return chatError("timeout", 504);
    if (request.signal.aborted) return chatError("cancelled", 499);
    return chatError("gateway", 502);
  } finally { timer.close(); }
}
