"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  buildPlaygroundCode,
  isPlaygroundModel,
  PLAYGROUND_LIMITS,
  PLAYGROUND_MODELS,
  type PlaygroundResult,
} from "../lib/playground";
import { useLocale } from "./locale-provider";

const TEXT = {
  en: {
    eyebrow: "DEVELOPER WORKSPACE",
    title: "Playground",
    lead: "Try a prompt. Inspect the response. Take it into your application.",
    setup: "Request settings",
    model: "Model",
    textOnly:
      "Text requests only. For vision, image and audio inputs, use the API documentation.",
    key: "API key",
    keyPlaceholder: "Enter your PowerChampion API key",
    keyNote:
      "Your key stays in this page’s memory and is forwarded only to the PowerChampion gateway for your request. It is not saved by this workbench.",
    clearKey: "Clear key",
    getKey: "Get API access",
    status: "Check service status",
    system: "System instructions",
    optional: "Optional",
    systemPlaceholder:
      "You are a helpful assistant. Keep your answers clear and concise.",
    tokens: "Maximum output tokens",
    tokensNote: "1–4,096 tokens. Actual usage depends on the model response.",
    prompt: "Your prompt",
    promptPlaceholder: "What would you like to explore?",
    singleTurn: "Single-turn request",
    example: "Use an example",
    examplePrompt:
      "Explain how an API works in two sentences, then give one practical example for a small business.",
    send: "Send API request",
    sending: "Waiting for response…",
    cancel: "Cancel request",
    billed:
      "Requests use your API credits and may be billed, including requests you cancel or that time out.",
    result: "Response",
    ready: "Ready when you are",
    empty:
      "Choose a model, enter your key and send a prompt. The actual model response will appear here.",
    waiting: "Your request is running on the selected model.",
    waitingNote:
      "A response may take up to 45 seconds. You can cancel at any time.",
    input: "Input tokens",
    output: "Output tokens",
    total: "Total tokens",
    unavailable: "Not reported",
    usageNote:
      "Token counts are reported by the gateway. Check your balance for billing information.",
    balance: "View balance",
    reasoning: "Model reasoning",
    noContent:
      "The model returned reasoning without a final answer. Try increasing the output token limit.",
    truncated:
      "The response reached the output token limit. Increase the limit for a longer response.",
    filtered: "The model marked this response as filtered.",
    code: "Request code",
    copy: "Copy code",
    copied: "Copied",
    copyFailed: "Copy is unavailable. Select the code to copy it manually.",
    codeNote:
      "Set POWERCHAMPION_API_KEY in your environment. This example reflects the settings above and excludes your key.",
    docs: "Read the API docs",
    cancelled: "Request cancelled. Gateway usage may still be billed.",
    errors: {
      authentication:
        "Please check that your API key is valid and has access to this model.",
      credits:
        "Your key has insufficient credits. Check your balance or contact support to top up.",
      rate_limit:
        "The gateway is limiting requests. Wait a moment before trying again.",
      timeout:
        "The request timed out. Check service status before retrying; usage may still be billed.",
      input:
        "Check your key, prompt and output token limit before sending again.",
      too_large:
        "Your request is too large. Shorten your prompt and system instructions.",
      origin:
        "This request could not be verified. Refresh the page and try again.",
      response:
        "The gateway did not return a usable text response. Check service status or try another model.",
      gateway:
        "The model gateway is unavailable or could not complete the request. Check service status before trying again.",
      network:
        "The request could not reach the gateway. Check your connection and service status; avoid repeated retries.",
    },
  },
  zh: {
    eyebrow: "開發者工作區",
    title: "模型測試台",
    lead: "測試提示詞、檢視模型回覆，接著整合到你的應用程式。",
    setup: "請求設定",
    model: "模型",
    textOnly: "此處僅支援文字請求。視覺、圖像與音訊輸入請參考 API 文件。",
    key: "API 金鑰",
    keyPlaceholder: "輸入你的 PowerChampion API 金鑰",
    keyNote:
      "金鑰僅留在此頁面的記憶體，傳送請求時才轉送至 PowerChampion 閘道。此工作台不會儲存金鑰。",
    clearKey: "清除金鑰",
    getKey: "取得 API 存取",
    status: "查看服務狀態",
    system: "系統指令",
    optional: "選填",
    systemPlaceholder: "你是一位助理，請用清楚且簡潔的方式回答。",
    tokens: "最大輸出 Token 數",
    tokensNote: "可設定 1–4,096 Tokens，實際用量由模型回覆決定。",
    prompt: "你的提示詞",
    promptPlaceholder: "你想探索什麼？",
    singleTurn: "單輪請求",
    example: "使用範例",
    examplePrompt:
      "用兩句話解釋 API 如何運作，再舉一個適合小型企業的實際應用。",
    send: "傳送 API 請求",
    sending: "等待模型回覆…",
    cancel: "取消請求",
    billed: "請求會使用你的 API 額度並可能產生費用，包含已取消或逾時的請求。",
    result: "模型回覆",
    ready: "準備好就能開始",
    empty: "選擇模型、輸入金鑰並傳送提示詞，實際的模型回覆會顯示在這裡。",
    waiting: "你選擇的模型正在處理請求。",
    waitingNote: "最長等待 45 秒，你可以隨時取消。",
    input: "輸入 Tokens",
    output: "輸出 Tokens",
    total: "總 Tokens",
    unavailable: "未回報",
    usageNote: "Token 數由閘道回報，實際計費請查看額度餘額。",
    balance: "查看餘額",
    reasoning: "模型推理",
    noContent:
      "模型回傳了推理內容，但沒有最終回答。可嘗試提高輸出 Token 上限。",
    truncated: "回覆已達到輸出 Token 上限，如需更長回覆可提高上限。",
    filtered: "模型將此回覆標記為已過濾。",
    code: "請求程式碼",
    copy: "複製程式碼",
    copied: "已複製",
    copyFailed: "目前無法自動複製，請選取程式碼後手動複製。",
    codeNote:
      "請在環境變數設定 POWERCHAMPION_API_KEY。範例會依上方設定更新，並排除你的金鑰。",
    docs: "閱讀 API 文件",
    cancelled: "已取消請求，閘道仍可能計入已使用的用量。",
    errors: {
      authentication: "請確認 API 金鑰有效，且有權使用此模型。",
      credits: "此金鑰的額度不足，請查看餘額或聯繫支援儲值。",
      rate_limit: "閘道正在限制請求頻率，請稍後再試。",
      timeout: "請求已逾時。重試前請先查看服務狀態，已使用的用量仍可能計費。",
      input: "請確認金鑰、提示詞與輸出 Token 上限設定。",
      too_large: "請求內容過長，請縮短提示詞與系統指令。",
      origin: "無法驗證此請求，請重新整理頁面後再試。",
      response: "閘道沒有回傳可用的文字回覆，請查看服務狀態或改用其他模型。",
      gateway: "模型閘道目前無法使用或無法完成請求，請先查看服務狀態再試。",
      network: "請求無法連上閘道，請檢查網路與服務狀態，避免連續重試。",
    },
  },
};

type ErrorCode = keyof typeof TEXT.en.errors;

export function PlaygroundContent() {
  const { locale } = useLocale();
  const t = TEXT[locale];
  const [model, setModel] = useState("glm-5.2-fp8");
  const [key, setKey] = useState("");
  const [system, setSystem] = useState("");
  const [prompt, setPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState("512");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const activeRequest = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    const queryModel = new URLSearchParams(window.location.search).get("model");
    // Read the browser query after hydration so server and initial client HTML agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isPlaygroundModel(queryModel)) setModel(queryModel);
    return () => {
      sequence.current += 1;
      activeRequest.current?.abort();
    };
  }, []);

  const tokenLimit = Number(maxTokens);
  const validTokens =
    Number.isInteger(tokenLimit) &&
    tokenLimit >= 1 &&
    tokenLimit <= PLAYGROUND_LIMITS.maxTokens;
  const validKey = /^[\x21-\x7E]{8,512}$/.test(key.trim());
  const canSend = validKey && !!prompt.trim() && validTokens && !busy;
  const generatedCode = buildPlaygroundCode(
    model,
    prompt,
    system,
    validTokens ? tokenLimit : 512,
  );
  const code = key.trim()
    ? generatedCode.split(key.trim()).join("[redacted]")
    : generatedCode;

  function cancelRequest() {
    sequence.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setBusy(false);
    setCancelled(true);
    setError(null);
  }

  function clearKey() {
    if (busy) cancelRequest();
    setKey("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestNumber = ++sequence.current;
    setBusy(true);
    setError(null);
    setResult(null);
    setCancelled(false);
    try {
      const response = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          key: key.trim(),
          model,
          prompt,
          system,
          maxTokens: tokenLimit,
        }),
      });
      const data = await response.json();
      if (requestNumber !== sequence.current) return;
      if (!response.ok) {
        const errorCode =
          typeof data?.error === "string" &&
          Object.hasOwn(TEXT.en.errors, data.error)
            ? (data.error as ErrorCode)
            : "gateway";
        setError(errorCode);
      } else if (typeof data?.content === "string") {
        setResult(data as PlaygroundResult);
      } else setError("response");
    } catch {
      if (requestNumber === sequence.current && !controller.signal.aborted)
        setError("network");
    } finally {
      if (requestNumber === sequence.current) {
        setBusy(false);
        activeRequest.current = null;
      }
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <main
      id="main-content"
      className="platform-page playground-page"
      aria-labelledby="playground-title"
    >
      <header className="playground-heading">
        <div>
          <p className="playground-eyebrow">{t.eyebrow}</p>
          <h1 id="playground-title">{t.title}</h1>
          <p>{t.lead}</p>
        </div>
        <a className="playground-status-link" href="/status">
          {t.status} <span aria-hidden="true">↗</span>
        </a>
      </header>

      <form className="playground-workbench" onSubmit={submit}>
        <aside
          className="playground-settings"
          aria-labelledby="playground-settings-title"
        >
          <h2 id="playground-settings-title">{t.setup}</h2>
          <label htmlFor="playground-model">{t.model}</label>
          <select
            id="playground-model"
            value={model}
            disabled={busy}
            onChange={(event) => {
              setModel(event.target.value);
              setCopyState("idle");
            }}
          >
            {PLAYGROUND_MODELS.map((item) => (
              <option key={item.modelId} value={item.modelId}>
                {item.name}
              </option>
            ))}
          </select>
          <p className="playground-helper">{t.textOnly}</p>
          <div className="playground-label-row">
            <label htmlFor="playground-key">{t.key}</label>
            <button type="button" disabled={!key} onClick={clearKey}>
              {t.clearKey}
            </button>
          </div>
          <input
            id="playground-key"
            type="password"
            value={key}
            maxLength={512}
            disabled={busy}
            onChange={(event) => setKey(event.target.value)}
            placeholder={t.keyPlaceholder}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="playground-key-note"
          />
          <p id="playground-key-note" className="playground-helper">
            {t.keyNote}
          </p>
          <button
            className="playground-access"
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("powerchampion:launch-access"),
              )
            }
          >
            {t.getKey} <span aria-hidden="true">↗</span>
          </button>
          <div className="playground-setting-divider" />
          <div className="playground-label-row">
            <label htmlFor="playground-system">{t.system}</label>
            <span>{t.optional}</span>
          </div>
          <textarea
            id="playground-system"
            value={system}
            maxLength={PLAYGROUND_LIMITS.system}
            disabled={busy}
            onChange={(event) => {
              setSystem(event.target.value);
              setCopyState("idle");
            }}
            placeholder={t.systemPlaceholder}
            rows={4}
          />
          <label htmlFor="playground-tokens">{t.tokens}</label>
          <input
            id="playground-tokens"
            type="number"
            value={maxTokens}
            min={1}
            max={PLAYGROUND_LIMITS.maxTokens}
            step={1}
            disabled={busy}
            onChange={(event) => {
              setMaxTokens(event.target.value);
              setCopyState("idle");
            }}
            aria-describedby="playground-tokens-note"
            aria-invalid={!validTokens}
          />
          <p id="playground-tokens-note" className="playground-helper">
            {t.tokensNote}
          </p>
        </aside>

        <div className="playground-canvas">
          <div className="playground-prompt-panel">
            <div className="playground-panel-heading">
              <div>
                <label htmlFor="playground-prompt">{t.prompt}</label>
                <span>{t.singleTurn}</span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPrompt(t.examplePrompt);
                  setCopyState("idle");
                }}
              >
                {t.example}
              </button>
            </div>
            <textarea
              id="playground-prompt"
              value={prompt}
              maxLength={PLAYGROUND_LIMITS.prompt}
              disabled={busy}
              onChange={(event) => {
                setPrompt(event.target.value);
                setCopyState("idle");
              }}
              placeholder={t.promptPlaceholder}
              rows={6}
              required
            />
            <div className="playground-send-row">
              <p id="playground-billing-note">{t.billed}</p>
              {busy ? (
                <button
                  type="button"
                  className="playground-cancel"
                  onClick={cancelRequest}
                >
                  {t.cancel}
                </button>
              ) : (
                <button
                  type="submit"
                  className="playground-send"
                  disabled={!canSend}
                  aria-describedby="playground-billing-note"
                >
                  {t.send} <span aria-hidden="true">↗</span>
                </button>
              )}
            </div>
          </div>

          <section
            className="playground-response-panel"
            aria-labelledby="playground-response-title"
            aria-busy={busy}
          >
            <div className="playground-panel-heading">
              <h2 id="playground-response-title">{t.result}</h2>
              <span>{busy ? t.sending : model}</span>
            </div>
            {error && (
              <div className="playground-error" role="alert">
                <p>{t.errors[error]}</p>
                <a href="/status">{t.status} ↗</a>
              </div>
            )}
            {cancelled && (
              <p className="playground-notice" role="status">
                {t.cancelled}
              </p>
            )}
            {busy && (
              <div className="playground-empty" role="status">
                <span className="playground-loader" aria-hidden="true" />
                <h3>{t.waiting}</h3>
                <p>{t.waitingNote}</p>
              </div>
            )}
            {!busy && !result && !error && !cancelled && (
              <div className="playground-empty">
                <span className="playground-empty-mark" aria-hidden="true">
                  ✳
                </span>
                <h3>{t.ready}</h3>
                <p>{t.empty}</p>
              </div>
            )}
            {result && (
              <div className="playground-result" aria-live="polite">
                {result.reasoning && (
                  <details className="playground-reasoning">
                    <summary>{t.reasoning}</summary>
                    <p>{result.reasoning}</p>
                  </details>
                )}
                <p className="playground-answer">
                  {result.content || t.noContent}
                </p>
                {result.finishReason === "length" && (
                  <p className="playground-notice">{t.truncated}</p>
                )}
                {result.finishReason === "content_filter" && (
                  <p className="playground-notice">{t.filtered}</p>
                )}
                <dl className="playground-usage">
                  {(
                    [
                      ["input", t.input],
                      ["output", t.output],
                      ["total", t.total],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <dt>{label}</dt>
                      <dd>
                        {result.usage?.[field]?.toLocaleString(
                          locale === "zh" ? "zh-TW" : "en-US",
                        ) ?? t.unavailable}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="playground-helper">
                  {t.usageNote} <a href="/console">{t.balance} ↗</a>
                </p>
              </div>
            )}
          </section>
        </div>
      </form>

      <section
        className="playground-code-panel"
        aria-labelledby="playground-code-title"
      >
        <div className="playground-panel-heading">
          <div>
            <h2 id="playground-code-title">{t.code}</h2>
            <span>cURL</span>
          </div>
          <button type="button" onClick={copyCode}>
            {copyState === "copied" ? t.copied : t.copy}
          </button>
        </div>
        <pre aria-label={t.code}>
          <code>{code}</code>
        </pre>
        <div className="playground-code-footer">
          <p>{t.codeNote}</p>
          <a href="/docs">{t.docs} ↗</a>
        </div>
        <p className="playground-copy-status" role="status">
          {copyState === "copied"
            ? t.copied
            : copyState === "error"
              ? t.copyFailed
              : ""}
        </p>
      </section>
    </main>
  );
}
