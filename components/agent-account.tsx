"use client";

/**
 * Saves the agent being built to the signed-in account and shows the endpoint
 * it can be called on. The agent token is displayed once, right after it is
 * issued; afterwards only its prefix is known, here and on the server.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "./locale-provider";
import {
  AGENT_CHAT_MODEL_IDS, AGENT_TONES, buildAgentInstructions,
  type AgentDraft,
} from "../lib/agent-blueprint";

type SavedAgent = {
  id: string;
  name: string;
  version: number;
  tokenPrefix: string;
  updatedAt: number;
};

type State =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "unavailable" }
  | { kind: "ready"; agents: SavedAgent[] };

const COPY = {
  en: {
    title: "Save to your account",
    lead: "A saved agent gets its own endpoint. Your application calls it with your API key; the instructions stay on the server.",
    signedOut: "Sign in to save this agent to your account.",
    signIn: "Sign in",
    register: "Create an account",
    unavailable: "The account service is unavailable right now. Your draft stays in this browser.",
    saveNew: "Save as a new agent",
    update: "Save a new version",
    load: "Open",
    rotate: "New token",
    remove: "Delete",
    confirm: "Confirm delete",
    empty: "No saved agents yet.",
    versionLabel: "version",
    tokenTitle: "Agent token — shown once",
    tokenNote: "Store it like a password. If you lose it, issue a new one; the old token stops working.",
    endpointTitle: "Call this agent",
    saved: "Saved.",
    updated: "New version saved.",
    loaded: "Loaded into the builder.",
    removed: "Agent deleted. Its endpoint no longer answers.",
    rotated: "New token issued. The previous one no longer works.",
    failed: "That did not go through. Please try again.",
    invalid: "Complete the agent before saving it.",
    copy: "Copy",
    copied: "Copied ✓",
    limits: "Conversations are not stored. Usage is billed to the key you send, at published rates.",
  },
  zh: {
    title: "儲存到你的帳號",
    lead: "儲存後的智能體有自己的端點。你的應用程式用自己的 API 金鑰呼叫它，指令留在伺服器上。",
    signedOut: "登入後即可把這個智能體存進帳號。",
    signIn: "登入",
    register: "建立帳號",
    unavailable: "帳號服務目前無法使用，草稿仍保留在這個瀏覽器。",
    saveNew: "另存為新的智能體",
    update: "儲存新版本",
    load: "開啟",
    rotate: "換新權杖",
    remove: "刪除",
    confirm: "確認刪除",
    empty: "尚未儲存任何智能體。",
    versionLabel: "版本",
    tokenTitle: "智能體權杖 —— 只顯示這一次",
    tokenNote: "請當成密碼保管。遺失就換一把新的，舊的會立刻失效。",
    endpointTitle: "呼叫這個智能體",
    saved: "已儲存。",
    updated: "已儲存新版本。",
    loaded: "已載入建置器。",
    removed: "已刪除，該端點不再回應。",
    rotated: "已換發新權杖，舊的立即失效。",
    failed: "沒有成功，請再試一次。",
    invalid: "請先把智能體填寫完整再儲存。",
    copy: "複製",
    copied: "已複製 ✓",
    limits: "對話不會被儲存。用量依刊登費率計入你送出的那把金鑰。",
  },
};

function endpointSnippet(origin: string, agentId: string, token: string | null) {
  const secret = token ?? "$PC_AGENT_TOKEN";
  return [
    `curl ${origin}/api/agents/${agentId}/chat \\`,
    `  -H "Authorization: Bearer $POWERCHAMPION_API_KEY" \\`,
    `  -H "X-PC-Agent-Token: ${secret}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"messages":[{"role":"user","content":"Hello"}]}'`,
  ].join("\n");
}

function draftBody(draft: AgentDraft) {
  return {
    name: draft.name.trim(),
    purpose: draft.purpose.trim(),
    model: draft.model,
    instructions: draft.systemInstructions.trim(),
    tone: draft.tone,
    knowledge: draft.knowledge.trim(),
    samplePrompt: draft.samplePrompt.trim(),
    systemPrompt: buildAgentInstructions(draft),
    maxOutputTokens: 1024,
  };
}

function toDraft(saved: Record<string, unknown>, fallback: AgentDraft): AgentDraft | null {
  const configuration = saved.configuration;
  if (typeof saved.name !== "string" || typeof configuration !== "object" || configuration === null) return null;
  const value = configuration as Record<string, unknown>;
  const model = AGENT_CHAT_MODEL_IDS.find((id) => id === value.model) ?? fallback.model;
  const tone = AGENT_TONES.find((id) => id === value.tone) ?? fallback.tone;
  const text = (field: unknown) => (typeof field === "string" ? field : "");
  return {
    version: 1,
    templateId: fallback.templateId,
    name: saved.name,
    purpose: text(value.purpose),
    model,
    systemInstructions: text(value.instructions),
    tone,
    knowledge: text(value.knowledge),
    samplePrompt: text(value.samplePrompt),
  };
}

export function AgentAccount({
  draft, valid, onLoad,
}: { draft: AgentDraft; valid: boolean; onLoad: (draft: AgentDraft) => void }) {
  const { locale } = useLocale();
  const t = COPY[locale];
  const [state, setState] = useState<State>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [token, setToken] = useState<{ agentId: string; value: string } | null>(null);
  const [message, setMessage] = useState<keyof typeof t | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/portal/agents", { headers: { Accept: "application/json" } });
      if (response.status === 401) return setState({ kind: "signedOut" });
      if (!response.ok) return setState({ kind: "unavailable" });
      const body: unknown = await response.json();
      const agents = (body as { agents?: SavedAgent[] }).agents;
      setState({ kind: "ready", agents: Array.isArray(agents) ? agents : [] });
    } catch {
      setState({ kind: "unavailable" });
    }
  }, []);

  useEffect(() => {
    // List the account's agents once the component is on the client; every
    // state update below happens after the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function send(path: string, method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401) { setState({ kind: "signedOut" }); return null; }
      if (!response.ok) { setMessage("failed"); return null; }
      return (await response.json()) as Record<string, unknown>;
    } catch {
      setMessage("failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveNew() {
    if (!valid) return setMessage("invalid");
    const result = await send("/api/portal/agents", "POST", draftBody(draft));
    if (!result) return;
    const agent = result.agent as SavedAgent;
    if (typeof result.token === "string") setToken({ agentId: agent.id, value: result.token });
    setSelected(agent.id);
    setMessage("saved");
    await load();
  }

  async function update(agentId: string) {
    if (!valid) return setMessage("invalid");
    const result = await send(`/api/portal/agents/${agentId}/versions`, "POST", draftBody(draft));
    if (!result) return;
    setMessage("updated");
    await load();
  }

  async function open(agentId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/portal/agents/${agentId}`, { headers: { Accept: "application/json" } });
      if (response.status === 401) return setState({ kind: "signedOut" });
      if (!response.ok) return setMessage("failed");
      const body = (await response.json()) as { agent?: Record<string, unknown> };
      const loaded = body.agent ? toDraft(body.agent, draft) : null;
      if (!loaded) return setMessage("failed");
      onLoad(loaded);
      setSelected(agentId);
      setMessage("loaded");
    } catch {
      setMessage("failed");
    } finally {
      setBusy(false);
    }
  }

  async function rotate(agentId: string) {
    const result = await send(`/api/portal/agents/${agentId}/token`, "POST", {});
    if (!result || typeof result.token !== "string") return;
    setToken({ agentId, value: result.token });
    setMessage("rotated");
    await load();
  }

  async function remove(agentId: string) {
    if (pendingDelete !== agentId) return setPendingDelete(agentId);
    setPendingDelete(null);
    const result = await send(`/api/portal/agents/${agentId}`, "DELETE");
    if (!result) return;
    if (selected === agentId) setSelected(null);
    if (token?.agentId === agentId) setToken(null);
    setMessage("removed");
    await load();
  }

  async function copySnippet(snippet: string) {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("failed");
    }
  }

  const origin = typeof window === "undefined" ? "https://powerchampion.ai" : window.location.origin;
  const endpointFor = selected ?? token?.agentId ?? null;

  return (
    <section className="agent-account" aria-labelledby="agent-account-title">
      <h3 id="agent-account-title">{t.title}</h3>
      <p className="agent-account-lead">{t.lead}</p>

      {state.kind === "loading" && <p className="agent-account-note">…</p>}

      {state.kind === "signedOut" && (
        <p className="agent-account-note">
          {t.signedOut}{" "}
          <a href="/login">{t.signIn}</a> · <a href="/register">{t.register}</a>
        </p>
      )}

      {state.kind === "unavailable" && <p className="agent-account-note">{t.unavailable}</p>}

      {state.kind === "ready" && (
        <>
          <div className="agent-account-actions">
            <button type="button" onClick={saveNew} disabled={busy}>{t.saveNew}</button>
            {selected && (
              <button type="button" onClick={() => update(selected)} disabled={busy}>{t.update}</button>
            )}
          </div>

          {state.agents.length === 0 ? (
            <p className="agent-account-note">{t.empty}</p>
          ) : (
            <ul className="agent-account-list">
              {state.agents.map((agent) => (
                <li key={agent.id} aria-current={agent.id === selected ? "true" : undefined}>
                  <div>
                    <strong>{agent.name}</strong>
                    <span>{t.versionLabel} {agent.version} · {agent.tokenPrefix}…</span>
                  </div>
                  <div className="agent-account-row-actions">
                    <button type="button" onClick={() => open(agent.id)} disabled={busy}>{t.load}</button>
                    <button type="button" onClick={() => rotate(agent.id)} disabled={busy}>{t.rotate}</button>
                    <button type="button" onClick={() => remove(agent.id)} disabled={busy}>
                      {pendingDelete === agent.id ? t.confirm : t.remove}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {token && (
            <div className="agent-account-token">
              <p>{t.tokenTitle}</p>
              <code>{token.value}</code>
              <p>{t.tokenNote}</p>
            </div>
          )}

          {endpointFor && (
            <div className="agent-account-endpoint">
              <p>{t.endpointTitle}</p>
              <pre><code>{endpointSnippet(origin, endpointFor, token?.agentId === endpointFor ? token.value : null)}</code></pre>
              <button type="button" onClick={() => copySnippet(endpointSnippet(origin, endpointFor, token?.agentId === endpointFor ? token.value : null))}>
                {copied ? t.copied : t.copy}
              </button>
              <p className="agent-account-note">{t.limits}</p>
            </div>
          )}
        </>
      )}

      <p className="agent-account-message" role="status">{message ? t[message] : ""}</p>
    </section>
  );
}
