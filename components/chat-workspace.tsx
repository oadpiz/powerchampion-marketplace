"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocale } from "./locale-provider";
import { useModalIsolation } from "./use-modal-isolation";
import { AGENT_TEMPLATES, getAgentTemplate } from "../lib/agents";
import { AGENT_TEST_STORAGE_KEY, buildAgentInstructions, parseAgentTestSession, type AgentDraft } from "../lib/agent-blueprint";
import { CHAT_EXAMPLES } from "../lib/chat-examples";

type Message = { role: "user" | "assistant"; content: string; source?: "example" | "live" | "trial"; model?: string };
type TrialConfig = { trialAvailable: boolean; maxOutputTokens: number; remaining?: number; maxHistoryCharacters?: number; maxSystemCharacters?: number; maxMessages?: number };
type ChatResult = { content: string; mode: "live" | "trial"; finishReason?: string | null; usage: { input: number | null; output: number | null; total: number | null } | null };

function inline(text: string): ReactNode[] { return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part); }
export function ChatAnswer({ content }: { content: string }) {
  return <div className="ai-answer-text">{content.split(/(```[\s\S]*?```)/g).map((part, index) => {
    if (part.startsWith("```")) { const code = part.slice(3, -3).replace(/^[^\n]*\n/, ""); return <pre key={index}><code>{code}</code></pre>; }
    return <div key={index}>{part.split(/\n\s*\n/).filter(Boolean).map((paragraph, position) => /^#{1,3} /.test(paragraph) ? <h3 key={position}>{inline(paragraph.replace(/^#{1,3} /, ""))}</h3> : <p key={position}>{inline(paragraph)}</p>)}</div>;
  })}</div>;
}

export function ChatWorkspace() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [model, setModel] = useState("glm-5.2-fp8");
  const [agentId, setAgentId] = useState("");
  const [custom, setCustom] = useState<AgentDraft | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [config, setConfig] = useState<TrialConfig | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [usage, setUsage] = useState<ChatResult["usage"]>(null);
  const requestRef = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const template = getAgentTemplate(agentId);
  const agentName = custom ? custom.name : template?.name[locale];
  const system = custom ? buildAgentInstructions(custom) : template ? template.instructions[locale] : "You are Power Champion, a helpful AI assistant. Be clear, practical and honest. Match the user's language. Do not claim to browse the web, access private systems or execute actions outside this conversation.";
  useModalIsolation(connectionOpen, modalRef);

  function reset() {
    requestRef.current?.abort();
    requestRef.current = null; inFlight.current = false;
    setMessages([]); setPrompt(""); setPending(""); setBusy(false); setError(""); setNotice(""); setUsage(null); setCopied(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("agent");
      if (id === "custom") {
        try {
          const saved = parseAgentTestSession(sessionStorage.getItem(AGENT_TEST_STORAGE_KEY));
          if (saved) { setCustom(saved.draft); setAgentId("custom"); setModel(saved.draft.model); setPrompt(saved.draft.samplePrompt); }
          else setNotice("draft_expired");
        } catch { setNotice("draft_expired"); }
      } else if (getAgentTemplate(id)) { setAgentId(id!); setPrompt(getAgentTemplate(id)!.starter[locale]); }
      try {
        const response = await fetch("/api/chat/config", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!controller.signal.aborted && response.ok && typeof data.trialAvailable === "boolean") setConfig(data);
      } catch { /* API-key chat remains available when trial discovery fails. */ }
    }
    void initialize();
    window.addEventListener("pc:new-conversation", reset);
    return () => { controller.abort(); requestRef.current?.abort(); window.removeEventListener("pc:new-conversation", reset); };
    // Read the initial route once; language changes should not erase a conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (messages.length || pending) endRef.current?.scrollIntoView?.({ block: "end", behavior: "smooth" }); }, [messages.length, pending]);
  useEffect(() => {
    if (!connectionOpen) return;
    const previous = document.activeElement;
    keyRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setConnectionOpen(false); }
      if (event.key === "Tab") {
        const elements = modalRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input, a[href]");
        const first = elements?.[0], last = elements?.[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", listener);
    return () => { document.removeEventListener("keydown", listener); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [connectionOpen]);

  const errors: Record<string, string> = zh ? {
    authentication: "金鑰無效或沒有此模型的權限，請重新設定。", credits: "API 額度不足，請查看帳戶餘額。", rate_limit: "請求過於頻繁，請稍後再試。", trial_limit: "今天的體驗額度已用完。你可以連接自己的 API 金鑰繼續。", trial_unavailable: "公開試用尚未開放，請連接 API 金鑰，或先探索對話範例。", timeout: "模型回覆逾時，請稍後查看服務狀態。", cancelled: "已停止等待。已送出的請求仍可能計入 API 用量。", input: "對話內容超過限制，請縮短內容或開始新對話。", gateway: "模型服務目前無法完成請求，請稍後重試或查看服務狀態。", network: "目前無法連接模型服務。你的內容仍保留在輸入框中。", response: "模型沒有回傳可用文字，請調整問題後再試。",
  } : {
    authentication: "This key is invalid or cannot access the selected model. Check your connection settings.", credits: "Your API key has insufficient credits. Check your balance.", rate_limit: "Too many requests. Please try again in a moment.", trial_limit: "The trial allowance has been reached. Connect your own API key to continue.", trial_unavailable: "Public trial is not open yet. Connect an API key or explore an example conversation.", timeout: "The model took too long to respond. Check service status before retrying.", cancelled: "Stopped waiting. A request already sent may still count toward API usage.", input: "This conversation exceeds the request limit. Shorten it or start a new conversation.", gateway: "The model service could not complete this request. Try later or check service status.", network: "The model service could not be reached. Your message is still in the composer.", response: "The model did not return usable text. Try adjusting your request.",
  };
  async function send(event: FormEvent) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || inFlight.current) return;
    if (!key && !config?.trialAvailable) { setConnectionOpen(true); return; }
    const history = [...messages.map(({ role, content }) => ({ role, content })), { role: "user" as const, content }];
    const historyLimit = key ? 32000 : (config?.maxHistoryCharacters ?? 8000);
    if (history.length > 24 || history.reduce((sum, item) => sum + item.content.length, 0) > historyLimit || system.length > 16000) { setError("input"); return; }
    const controller = new AbortController(); requestRef.current = controller; inFlight.current = true;
    setBusy(true); setError(""); setNotice(""); setPrompt(""); setPending(content);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: controller.signal, body: JSON.stringify({ ...(key ? { key } : {}), model, messages: history, system, maxTokens: key ? 1024 : (config?.maxOutputTokens ?? 512) }) });
      const data = await response.json();
      if (!response.ok) { const code = typeof data.error === "string" ? data.error : "gateway"; throw new Error(code); }
      if (typeof data.content !== "string" || !data.content.trim()) throw new Error("response");
      if (controller.signal.aborted || requestRef.current !== controller) return;
      setMessages((prior) => [...prior, { role: "user", content }, { role: "assistant", content: data.content, source: data.mode === "trial" ? "trial" : "live", model }]);
      setUsage(data.usage ?? null);
      if (data.mode === "trial") setConfig((prior) => prior ? { ...prior, ...(typeof prior.remaining === "number" ? { remaining: Math.max(0, prior.remaining - 1) } : {}) } : prior);
      if (data.finishReason === "length") setNotice("truncated");
    } catch (cause) {
      if (requestRef.current !== controller) return;
      setPrompt(content); setError(controller.signal.aborted ? "cancelled" : cause instanceof Error && cause.message in errors ? cause.message : "network");
    } finally { if (requestRef.current === controller) { setBusy(false); setPending(""); inFlight.current = false; } }
  }
  function selectExample(id: string) {
    const example = CHAT_EXAMPLES.find((item) => item.id === id)!;
    reset(); setAgentId(""); setCustom(null);
    setMessages([{ role: "user", content: example.prompt[locale], source: "example" }, { role: "assistant", content: example.answer[locale], source: "example" }]);
  }
  async function copy(content: string, index: number) { try { await navigator.clipboard.writeText(content); setCopied(index); } catch { setNotice("copy_error"); } }
  function exportConversation() {
    const text = messages.map((message) => `## ${message.role === "user" ? "You" : "Power Champion"}${message.source === "example" ? " (pre-written example)" : ""}\n\n${message.content}`).join("\n\n---\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "powerchampion-conversation.md"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const active = messages.length > 0 || busy;
  return <main id="main-content" className={`ai-chat-page${active ? " ai-chat-active" : ""}`}>
    <header className="ai-chat-toolbar"><div><span className="ai-toolbar-dot" aria-hidden="true"/><span>{agentName || (zh ? "模型對話" : "Model chat")}</span></div><div><a href="/agents/build">{zh ? "建立智能體" : "Build an agent"}<span aria-hidden="true">↗</span></a><button type="button" onClick={() => setConnectionOpen(true)} className={key || config?.trialAvailable ? "ai-connected" : ""}>{key ? (zh ? "已連接 API" : "API connected") : config?.trialAvailable ? (zh ? "公開體驗" : "Public trial") : (zh ? "連接模型" : "Connect model")}<span aria-hidden="true">⌘</span></button></div></header>
    <div className="ai-conversation-stage">
      {!active && <section className="ai-welcome"><div className="ai-living-mark" aria-hidden="true"><span/><span/><span/><i>✳</i></div><p className="ai-welcome-kicker">{custom ? (zh ? "你的智能體 · 測試工作區" : "YOUR AGENT · TEST WORKSPACE") : template ? (zh ? "專屬任務，專注協作" : "A SPECIALIST AT YOUR SIDE") : "POWER CHAMPION AI"}</p><h1>{agentName ? <>{zh ? "與 " : "Meet "}<em>{agentName}</em>{zh ? " 一起工作" : "."}</> : zh ? <>今天，想讓什麼<br/><em>成為可能？</em></> : <>What will you<br/><em>make possible?</em></>}</h1><p className="ai-welcome-lead">{custom ? custom.purpose : template ? template.description[locale] : zh ? "從一個問題，到一位專屬智能體。讓想法在對話中展開。" : "From a first question to an agent of your own. Start with a conversation."}</p></section>}
      {active && <section className="ai-transcript" aria-label={zh ? "對話內容" : "Conversation"}><div className="ai-transcript-heading"><h1>{agentName || (zh ? "新的對話" : "A new conversation")}</h1><button type="button" onClick={reset} disabled={busy}>{zh ? "新對話" : "New chat"} ＋</button></div>{messages.map((message, index) => <article className={`ai-message ai-message-${message.role}`} key={index}>{message.role === "assistant" && <span className="ai-answer-avatar" aria-hidden="true">✳</span>}<div>{message.role === "assistant" && <div className="ai-message-byline"><strong>{agentName || "Power Champion"}</strong><span>{message.source === "example" ? (zh ? "預寫範例 · 非即時生成" : "Pre-written example · not a live response") : message.source === "trial" ? (zh ? "試用模型回覆" : "Trial model response") : message.model}</span></div>}{message.role === "user" ? <p className="ai-user-text">{message.content}</p> : <><ChatAnswer content={message.content}/><button type="button" className="ai-copy-answer" onClick={() => copy(message.content, index)}>{copied === index ? (zh ? "已複製 ✓" : "Copied ✓") : (zh ? "複製回覆" : "Copy response")}</button></>}</div></article>)}{pending && <><article className="ai-message ai-message-user"><p className="ai-user-text">{pending}</p></article><div className="ai-thinking" role="status"><span>✳</span>{zh ? "正在等待模型回覆…" : "Waiting for the model…"}</div></>}<div ref={endRef}/></section>}
      <section className="ai-composer-area" aria-label={zh ? "對話輸入" : "Message composer"}>{!active && <div className="ai-conversation-modes"><span className="ai-mode-selected">✳ {zh ? "對話" : "Chat"}</span><a href="/agents">◈ {zh ? "智能體" : "Agents"}</a><a href="/agents/build">⊞ {zh ? "自己打造" : "Create your own"}</a></div>}
        {custom && <p className="ai-draft-note">{zh ? "此對話會包含你在建置器加入的參考資料，傳送時交由模型處理。" : "Your builder’s reference material is included in requests you send to the model."} <a href="/agents/build?draft=session">{zh ? "返回編輯" : "Edit agent"}</a></p>}
        <form className="ai-composer" onSubmit={send}><label className="sr-only" htmlFor="ai-prompt">{zh ? "你的訊息" : "Your message"}</label><textarea id="ai-prompt" ref={promptRef} rows={3} maxLength={12000} value={prompt} disabled={busy} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={agentName ? (zh ? `你想請 ${agentName} 協助什麼？` : `What would you like ${agentName} to help with?`) : (zh ? "提出問題、整理想法，或開始打造你的下一個產品…" : "Ask a question, work through an idea, or build something new…")}/><div className="ai-composer-controls"><label><span className="sr-only">{zh ? "選擇模型" : "Choose model"}</span><select value={model} disabled={busy} onChange={(event) => setModel(event.target.value)}><option value="glm-5.2-fp8">GLM 5.2</option><option value="qwen3-vl-30b">Qwen3 VL</option></select></label><span className="ai-text-mode">{zh ? "文字對話" : "Text conversation"}</span>{busy ? <button className="ai-send" type="button" onClick={() => requestRef.current?.abort()} aria-label={zh ? "停止回覆" : "Stop response"}>■</button> : <button className="ai-send" type="submit" disabled={!prompt.trim()} aria-label={zh ? "傳送訊息" : "Send message"}>↑</button>}</div></form>
        {error && <p className="ai-chat-error" role="alert">{errors[error] || errors.gateway} <a href="/status">{zh ? "查看狀態" : "Service status"}</a></p>}
        {notice && <p className="ai-chat-notice" role="status">{notice === "draft_expired" ? (zh ? "智能體測試草稿已過期或無法讀取，請從建置器重新開啟。" : "The agent test draft expired or could not be read. Open it again from the builder.") : notice === "truncated" ? (zh ? "已達本次回覆長度上限。" : "The response reached its output limit.") : (zh ? "無法自動複製，請選取文字後手動複製。" : "Clipboard unavailable. Select the text to copy it manually.")}</p>}
        <div className="ai-composer-note"><span>{key ? (zh ? "使用你的 API 額度；金鑰與對話僅留在此頁記憶體。" : "Uses your API credits. Key and chat stay in this page’s memory.") : config?.trialAvailable ? (zh ? "有限額公開體驗；對話不會存入你的帳戶。" : "Limited public trial. Conversations are not saved to your account.") : (zh ? "先探索範例，或連接 API 金鑰開始即時對話。" : "Explore an example, or connect an API key for live conversation.")}</span>{messages.length > 0 && <button type="button" onClick={exportConversation}>{zh ? "匯出對話" : "Export chat"} ↗</button>}</div>
        {usage?.total !== null && usage?.total !== undefined && <p className="ai-usage">{zh ? "最近一則回覆用量" : "Latest response usage"} · {usage.total.toLocaleString()} tokens</p>}
      </section>
      {!active && <><section className="ai-starters" aria-label={zh ? "開始探索" : "Start exploring"}>{template || custom ? <button type="button" onClick={() => { setPrompt(custom?.samplePrompt || template!.starter[locale]); promptRef.current?.focus(); }}><span aria-hidden="true">↗</span>{zh ? "使用範例問題" : "Use a starting prompt"}</button> : CHAT_EXAMPLES.map((example) => <button type="button" onClick={() => selectExample(example.id)} key={example.id}><span aria-hidden="true">{example.icon}</span>{example.name[locale]}<small>{zh ? "體驗範例" : "Example"}</small></button>)}</section><section className="ai-agent-discovery" aria-label={zh ? "專業助理" : "Specialist assistants"}><div className="ai-discovery-heading"><p>{zh ? "一個工作區，更多專業角色。" : "One workspace. A few extra talents."}</p><a href="/agents">{zh ? "查看全部" : "Meet the agents"} ↗</a></div><div className="ai-agent-shortcuts">{AGENT_TEMPLATES.map((agent) => <button type="button" key={agent.id} onClick={() => { reset(); setCustom(null); setAgentId(agent.id); setPrompt(agent.starter[locale]); }}><span aria-hidden="true">{agent.icon}</span><strong>{agent.name[locale]}</strong><span className="ai-agent-shortcut-arrow" aria-hidden="true">↗</span></button>)}</div></section><p className="ai-home-service-line">{zh ? "需要串接你的知識、工具與流程？" : "Need an agent connected to your knowledge, tools and workflows?"} <a href="/agents#agent-services">{zh ? "讓我們一起建置" : "Let’s build it together"} ↗</a></p></>}
    </div>
    {connectionOpen && <div className="ai-modal-backdrop"><div className="ai-connect-modal" role="dialog" aria-modal="true" aria-labelledby="ai-connect-title" ref={modalRef}><button className="ai-modal-close" type="button" aria-label={zh ? "關閉連線設定" : "Close connection settings"} onClick={() => setConnectionOpen(false)}>×</button><span className="ai-connect-symbol" aria-hidden="true">⌘</span><p className="ai-welcome-kicker">{zh ? "連接你的智慧" : "CONNECT YOUR INTELLIGENCE"}</p><h2 id="ai-connect-title">{zh ? "開始真正的對話。" : "Make the conversation live."}</h2><p>{zh ? "輸入 Power Champion API 金鑰，即可使用模型進行多輪對話。請求可能使用你的 API 額度，包含取消或逾時的請求。" : "Connect a Power Champion API key for multi-turn model conversations. Requests can use your API credits, including cancelled or timed-out requests."}</p><form onSubmit={(event) => { event.preventDefault(); if (!/^[\x21-\x7E]{8,512}$/.test(keyDraft.trim())) { setKeyError(true); return; } setKey(keyDraft.trim()); setKeyDraft(""); setKeyError(false); setConnectionOpen(false); }}><label htmlFor="ai-api-key">{zh ? "API 金鑰" : "API key"}</label><input id="ai-api-key" ref={keyRef} type="password" autoComplete="off" maxLength={512} value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder="sk-…"/>{keyError && <p role="alert">{zh ? "請輸入有效的 API 金鑰格式。" : "Enter a valid API key format."}</p>}<button className="ai-connect-submit" type="submit">{zh ? "連接金鑰" : "Connect API key"} <span aria-hidden="true">↗</span></button></form><p className="ai-key-note">{zh ? "金鑰不會存入瀏覽器或對話匯出檔案，離開頁面即清除。" : "Your key is not saved to browser storage or chat exports. It clears when you leave this page."}</p>{key && <button className="ai-disconnect" type="button" onClick={() => { setKey(""); setKeyDraft(""); setConnectionOpen(false); }}>{zh ? "中斷目前金鑰" : "Disconnect current key"}</button>}<div className="ai-connect-links"><a href="/account/keys">{zh ? "管理 API 金鑰" : "Manage API keys"} ↗</a><a href="/pricing">{zh ? "查看價格" : "View pricing"} ↗</a></div>{!config?.trialAvailable && <p className="ai-trial-note">{zh ? "免金鑰公開試用尚未開放。對話範例可立即探索，且會清楚標示為預寫內容。" : "Key-free public trial is not open yet. Example conversations are available now and are clearly labeled as pre-written content."}</p>}</div></div>}
  </main>;
}
