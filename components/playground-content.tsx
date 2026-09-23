"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { motion, useAnimationControls } from "motion/react";
import {
  buildPlaygroundCode,
  isPlaygroundModel,
  PLAYGROUND_LIMITS,
  PLAYGROUND_MODELS,
  type PlaygroundResult,
  type PlaygroundCodeLanguage,
} from "../lib/playground";
import { PLAYGROUND_TEXT } from "../lib/playground-copy";
import { useLocale } from "./locale-provider";
import { useMotionAvailability } from "./promo-motion";

const TEXT = PLAYGROUND_TEXT;

type ErrorCode = keyof typeof TEXT.en.errors;
type CompletedRequest = PlaygroundResult & { model: string; durationMs: number };
const codeLanguages = [
  { id: "curl", name: "cURL", file: "request.sh" },
  { id: "python", name: "Python", file: "request.py" },
  { id: "javascript", name: "JavaScript", file: "request.mjs" },
] as const;

function RequestOrb({ busy, canAnimate }: { busy: boolean; canAnimate: boolean }) {
  return <svg className="playground-orb" viewBox="0 0 120 120" fill="none" aria-hidden="true">
    <circle className="playground-orb-ring" cx="60" cy="60" r="47" stroke="currentColor" strokeOpacity=".18" />
    <motion.g key={String(canAnimate)} initial={busy && canAnimate ? { rotate: 0 } : false} animate={{ rotate: busy && canAnimate ? [0, 360] : 0 }} transition={busy && canAnimate ? { duration: 12, repeat: Infinity, ease: "linear" } : { duration: 0 }} style={{ originX: "60px", originY: "60px", transformBox: "view-box" }}>
      <ellipse className="playground-orb-ring" cx="60" cy="60" rx="44" ry="25" transform="rotate(-35 60 60)" stroke="currentColor" strokeOpacity=".5" />
      <ellipse className="playground-orb-ring" cx="60" cy="60" rx="44" ry="25" transform="rotate(35 60 60)" stroke="currentColor" strokeOpacity=".25" />
      <circle cx="92" cy="35" r="3" fill="currentColor" />
    </motion.g>
    <path className="playground-orb-core" d="M60 40v40M40 60h40M46 46l28 28M46 74l28-28" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="60" cy="60" r="5" fill="currentColor" />
  </svg>;
}

export function PlaygroundContent() {
  const { locale } = useLocale();
  const t = TEXT[locale];
  const canAnimate = useMotionAvailability();
  const responseAnimation = useAnimationControls();
  const [model, setModel] = useState("glm-5.2-fp8");
  const [key, setKey] = useState("");
  const [system, setSystem] = useState("");
  const [prompt, setPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState("512");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompletedRequest | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [responseCopy, setResponseCopy] = useState<"idle" | "copied" | "error">("idle");
  const [codeLanguage, setCodeLanguage] = useState<PlaygroundCodeLanguage>("curl");
  const codeTabs = useRef<HTMLDivElement>(null);
  const codeCopySequence = useRef(0);
  const responseCopySequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    const queryModel = new URLSearchParams(window.location.search).get("model");
    // Read the browser query after hydration so server and initial client HTML agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isPlaygroundModel(queryModel)) setModel(queryModel);
    return () => {
      sequence.current += 1;
      codeCopySequence.current += 1;
      responseCopySequence.current += 1;
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
  // Redact raw values before serialization changes quotes and backslashes.
  const redactPrompt = (value: string) => key.trim() ? value.split(key.trim()).join("[redacted]") : value;
  const code = buildPlaygroundCode(
    model,
    redactPrompt(prompt),
    redactPrompt(system),
    validTokens ? tokenLimit : 512,
    codeLanguage,
  );
  const readyMessage = !validKey ? (key ? t.invalidKey : t.needsKey) : !prompt.trim() ? t.needsPrompt : !validTokens ? t.invalidTokens : t.canSend;
  const responseState = busy ? "loading" : error ? "error" : cancelled ? "cancelled" : result ? "complete" : "empty";

  useEffect(() => {
    if (canAnimate) void responseAnimation.start({ opacity: 1, y: 0, transition: { duration: 0.35 } });
    else responseAnimation.set({ opacity: 1, y: 0 });
    return () => responseAnimation.stop();
  }, [canAnimate, responseState, responseAnimation]);

  function invalidateCodeCopy() {
    codeCopySequence.current += 1;
    setCopyState("idle");
  }

  function selectCodeLanguage(language: PlaygroundCodeLanguage) {
    setCodeLanguage(language);
    invalidateCodeCopy();
  }

  function navigateCode(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
    if (next === null) return;
    event.preventDefault();
    selectCodeLanguage(codeLanguages[next].id);
    codeTabs.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

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
    invalidateCodeCopy();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestNumber = ++sequence.current;
    const started = performance.now();
    const requestedModel = model;
    setBusy(true);
    setError(null);
    setResult(null);
    setCancelled(false);
    setResponseCopy("idle");
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
        const scrub = (text: string) => text.split(key.trim()).join("[redacted]");
        setResult({
          ...data as PlaygroundResult,
          content: scrub(data.content),
          reasoning: typeof data.reasoning === "string" ? scrub(data.reasoning) : null,
          model: requestedModel,
          durationMs: Math.max(0, performance.now() - started),
        });
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
    const copyNumber = ++codeCopySequence.current;
    try {
      await navigator.clipboard.writeText(code);
      if (copyNumber === codeCopySequence.current) setCopyState("copied");
    } catch {
      if (copyNumber === codeCopySequence.current) setCopyState("error");
    }
  }

  async function copyResponse() {
    if (!result?.content) return;
    const copyNumber = ++responseCopySequence.current;
    const requestNumber = sequence.current;
    try {
      await navigator.clipboard.writeText(result.content);
      if (copyNumber === responseCopySequence.current && requestNumber === sequence.current) setResponseCopy("copied");
    } catch {
      if (copyNumber === responseCopySequence.current && requestNumber === sequence.current) setResponseCopy("error");
    }
  }

  return (
    <main
      id="main-content"
      className="platform-page playground-page"
      aria-labelledby="playground-title"
      data-motion={canAnimate ? "on" : "off"}
    >
      <header className="playground-heading">
        <div>
          <p className="playground-eyebrow">{t.eyebrow}</p>
          <h1 id="playground-title">{t.title}</h1>
          <p>{t.lead}</p>
        </div>
        <div className="playground-heading-side">
          <p className="playground-protocol"><span aria-hidden="true">✳</span>{t.protocol}</p>
        <a className="playground-status-link" href="/status">
          {t.status} <span aria-hidden="true">↗</span>
        </a>
        </div>
      </header>

      <div className="playground-readiness">
        {t.steps.map((label, index) => <span key={label} data-complete={[true, validKey, !!prompt.trim()][index]}><small aria-hidden="true">{String(index + 1).padStart(2, "0")}</small>{label}</span>)}
      </div>

      <form className="playground-workbench" onSubmit={submit}>
        <aside
          className="playground-settings"
          aria-labelledby="playground-settings-title"
        >
          <h2 id="playground-settings-title"><span className="playground-section-index" aria-hidden="true">01</span>{t.setup}</h2>
          <label htmlFor="playground-model">{t.model}</label>
          <select
            id="playground-model"
            value={model}
            disabled={busy}
            onChange={(event) => {
              setModel(event.target.value);
              invalidateCodeCopy();
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
            onChange={(event) => { setKey(event.target.value); invalidateCodeCopy(); }}
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
          <details className="playground-advanced">
            <summary><span>{t.advanced}</span><small>{t.advancedNote}</small></summary>
            <div className="playground-advanced-fields">
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
              invalidateCodeCopy();
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
              invalidateCodeCopy();
            }}
            aria-describedby="playground-tokens-note"
            aria-invalid={!validTokens}
          />
          <p id="playground-tokens-note" className="playground-helper">
            {t.tokensNote}
          </p>
            </div>
          </details>
        </aside>

        <div className="playground-canvas">
          <div className="playground-prompt-panel">
            <div className="playground-examples">
              <div className="playground-example-label"><span>{t.examplesTitle}</span><small>{t.examplesNote}</small></div>
              <div className="playground-example-grid">
                {t.presets.map((preset) => <motion.button className="playground-example-card" type="button" key={preset.id} disabled={busy} aria-pressed={prompt === preset.prompt} whileHover={canAnimate && !busy ? { y: -2 } : undefined} whileTap={canAnimate && !busy ? { scale: 0.98 } : undefined} onClick={() => { setPrompt(preset.prompt); invalidateCodeCopy(); }}>
                  <span className="playground-example-icon" aria-hidden="true">{preset.icon}</span><strong>{preset.title}</strong><span>{preset.detail}</span><b aria-hidden="true">↗</b>
                </motion.button>)}
              </div>
            </div>
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
                  invalidateCodeCopy();
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
                invalidateCodeCopy();
              }}
              placeholder={t.promptPlaceholder}
              rows={6}
              required
            />
            <div className="playground-prompt-meta"><span>{prompt.length.toLocaleString(locale === "zh" ? "zh-TW" : "en-US")} / 12,000 {t.characters}</span><span id="playground-ready-note">{busy ? t.sending : readyMessage}</span></div>
            <div className="playground-send-row">
              <p id="playground-billing-note">{t.billed}</p>
              {busy ? (
                <button
                  type="button"
                  className="playground-cancel"
                  onClick={(event) => {
                    // React reuses this node as the submit button after cancel.
                    // Stop the native click from submitting that new button.
                    event.preventDefault();
                    cancelRequest();
                  }}
                >
                  {t.cancel}
                </button>
              ) : (
                <button
                  type="submit"
                  className="playground-send"
                  disabled={!canSend}
                  aria-describedby="playground-billing-note playground-ready-note"
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
              <div className="playground-result-meta">
                <span className="playground-response-model">{result?.model ?? model}</span>
                {result && <span className="playground-duration" title={t.requestTime} aria-label={`${t.requestTime}: ${(result.durationMs / 1000).toFixed(1)} s`}>{(result.durationMs / 1000).toFixed(1)} s</span>}
                {result?.content && <button className="playground-copy-answer" type="button" onClick={copyResponse}>{t.copyResponse}<span aria-hidden="true"> ⧉</span></button>}
              </div>
            </div>
            <motion.div key={responseState} initial={canAnimate ? { opacity: 0.7, y: 8 } : false} animate={responseAnimation}>
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
                <RequestOrb busy canAnimate={canAnimate} />
                <h3>{t.waiting}</h3>
                <p>{t.waitingNote}</p>
              </div>
            )}
            {!busy && !result && !error && !cancelled && (
              <div className="playground-empty">
                <RequestOrb busy={false} canAnimate={canAnimate} />
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
            </motion.div>
            <p className="playground-copy-status" role="status">{responseCopy === "copied" ? t.responseCopied : responseCopy === "error" ? t.responseCopyFailed : ""}</p>
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
            <div className="playground-code-tabs" role="tablist" aria-label={t.codeLanguages} ref={codeTabs}>
              {codeLanguages.map((language, index) => <button key={language.id} type="button" role="tab" id={`playground-code-${language.id}`} aria-controls="playground-code-panel" aria-selected={codeLanguage === language.id} tabIndex={codeLanguage === language.id ? 0 : -1} onClick={() => selectCodeLanguage(language.id)} onKeyDown={(event) => navigateCode(event, index)}>{language.name}{codeLanguage === language.id && <motion.span className="playground-code-tab-line" layoutId="playground-code-language" transition={{ duration: canAnimate ? 0.25 : 0 }} />}</button>)}
            </div>
          </div>
          <button type="button" onClick={copyCode}>
            {copyState === "copied" ? t.copied : t.copy}
          </button>
        </div>
        <div role="tabpanel" id="playground-code-panel" aria-labelledby={`playground-code-${codeLanguage}`}>
          <div className="playground-code-runtime"><span>{t.runtimes[codeLanguage]}</span><span className="playground-code-filename">{codeLanguages.find((language) => language.id === codeLanguage)?.file}</span></div>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need to focus and horizontally scroll the code sample. */}
        <pre role="region" aria-label={`${t.code} — ${codeLanguage}`} tabIndex={0}>
          <code>{code}</code>
        </pre>
        </div>
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
