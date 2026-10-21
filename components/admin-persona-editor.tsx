"use client";

import { useEffect, useState, type MutableRefObject } from "react";
import { codePoints, lineProblem, textProblem, unsafeMessage } from "../lib/admin-text";
import { PortalError, portalErrorText, portalRequest } from "../lib/portal-client";
import { useLocale } from "./locale-provider";

export type PersonaExample = { user: string; assistant: string };
export type PersonaRevisionSummary = {
  rev: number;
  note?: string;
  author?: string;
  created_at?: number | string | null;
  system_len?: number;
  example_count?: number;
};

// Same limits as the portal backend (server/admin_personas.py).
export const MAX_SYSTEM = 32000;
const MAX_EXAMPLES = 50;
const MAX_EXAMPLE_TEXT = 4000;
const MAX_NOTE = 200;
const MAX_INPUT = 4000;
const MAX_TOKENS = 1024;
/** Request body limit for a revision save, in bytes (BFF and backend). */
export const MAX_REVISION_BYTES = 196608;
function revisionError(system: string, examples: PersonaExample[], note: string, zh: boolean): string | null {
  const systemField = { en: "system prompt", zh: "系統提示" };
  const systemProblem = textProblem(system, MAX_SYSTEM);
  if (systemProblem === "unsafe") return unsafeMessage(systemField, zh);
  if (systemProblem === "long")
    return zh ? `系統提示最多 ${MAX_SYSTEM.toLocaleString()} 字。` : `The system prompt can be at most ${MAX_SYSTEM.toLocaleString()} characters.`;
  if (examples.length > MAX_EXAMPLES) return zh ? "範例最多 50 組。" : "Use at most 50 examples.";
  for (const [index, pair] of examples.entries()) {
    const problems = [pair.user, pair.assistant].map((text) => textProblem(text, MAX_EXAMPLE_TEXT));
    if (problems.includes("unsafe")) return unsafeMessage({ en: `example ${index + 1}`, zh: `範例 ${index + 1} ` }, zh);
    if (problems.includes("long"))
      return zh ? `範例 ${index + 1} 的每則訊息最多 4,000 字。` : `Each message in example ${index + 1} can be at most 4,000 characters.`;
    if (!pair.user.trim() && !pair.assistant.trim())
      return zh ? `範例 ${index + 1} 至少要有使用者或助理的內容。` : `Example ${index + 1} needs a user or an assistant message.`;
  }
  const noteProblem = lineProblem(note, MAX_NOTE, false);
  if (noteProblem === "unsafe") return unsafeMessage({ en: "note (a single line)", zh: "備註（須為單行）" }, zh);
  if (noteProblem === "long") return zh ? "備註最多 200 字。" : "The note can be at most 200 characters.";
  return null;
}

export function RevisionEditor({
  personaId,
  initialSystem,
  initialExamples,
  onSaved,
  dirtyRef,
}: {
  personaId: string;
  initialSystem: string;
  initialExamples: PersonaExample[];
  onSaved: (rev: number, activated: boolean) => void;
  /** Set to true while the draft differs from what it was prefilled with. */
  dirtyRef?: MutableRefObject<boolean>;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [system, setSystem] = useState(initialSystem);
  const [examples, setExamples] = useState<PersonaExample[]>(initialExamples);
  const [note, setNote] = useState("");
  const [activate, setActivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const dirty =
    system !== initialSystem || JSON.stringify(examples) !== JSON.stringify(initialExamples) || note !== "" || activate;
  useEffect(() => {
    if (dirtyRef) dirtyRef.current = dirty;
  });
  const bodyBytes = new TextEncoder().encode(JSON.stringify({ system, examples, note: note.trim(), activate })).length;
  const tooLarge = bodyBytes > MAX_REVISION_BYTES;

  function updateExample(index: number, field: keyof PersonaExample, value: string) {
    setExamples((current) => current.map((pair, i) => (i === index ? { ...pair, [field]: value } : pair)));
  }

  async function save() {
    if (busy) return;
    const invalid =
      revisionError(system, examples, note, zh) ??
      (tooLarge
        ? zh
          ? `這個版本共 ${bodyBytes.toLocaleString()} 位元組，超過上限 ${MAX_REVISION_BYTES.toLocaleString()}；請縮短系統提示或範例。`
          : `This revision is ${bodyBytes.toLocaleString()} bytes, over the ${MAX_REVISION_BYTES.toLocaleString()}-byte limit. Shorten the system prompt or the examples.`
        : null);
    if (invalid) {
      setMessage(invalid);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await portalRequest<{ rev: number }>(`/admin/personas/${encodeURIComponent(personaId)}/revisions`, {
        method: "POST",
        body: JSON.stringify({ system, examples, note: note.trim(), activate }),
      });
      onSaved(result.rev, activate);
    } catch (reason: unknown) {
      setMessage(portalErrorText(reason, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="portal-panel">
      <h2>{zh ? "新增版本" : "New revision"}</h2>
      <p className="portal-note">
        {zh ? "已預填目前檢視的版本；儲存會建立新版本，不會修改舊版本。" : "Prefilled from the revision you are viewing. Saving creates a new revision; older ones are kept."}
      </p>
      <label className="portal-field">
        {zh ? "系統提示" : "System prompt"}
        <textarea rows={8} value={system} disabled={busy} onChange={(event) => setSystem(event.target.value)} />
      </label>
      <p className="portal-note" aria-live="polite">{`${codePoints(system).toLocaleString()} / ${MAX_SYSTEM.toLocaleString()}`}</p>
      <fieldset className="portal-field">
        <legend>{zh ? "範例對話" : "Examples"}</legend>
        {examples.map((pair, index) => (
          <div key={index} className="portal-actions">
            <label className="portal-field">
              {zh ? `範例 ${index + 1} 使用者` : `Example ${index + 1} user`}
              <textarea rows={2} value={pair.user} disabled={busy} onChange={(event) => updateExample(index, "user", event.target.value)} />
            </label>
            <label className="portal-field">
              {zh ? `範例 ${index + 1} 助理` : `Example ${index + 1} assistant`}
              <textarea rows={2} value={pair.assistant} disabled={busy} onChange={(event) => updateExample(index, "assistant", event.target.value)} />
            </label>
            <button type="button" className="portal-text-button" disabled={busy} onClick={() => setExamples((current) => current.filter((_, i) => i !== index))}>
              {zh ? `移除範例 ${index + 1}` : `Remove example ${index + 1}`}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="portal-button-secondary"
          disabled={busy || examples.length >= MAX_EXAMPLES}
          onClick={() => setExamples((current) => [...current, { user: "", assistant: "" }])}
        >
          {zh ? "新增範例" : "Add example"}
        </button>
      </fieldset>
      <label className="portal-field">
        {zh ? "備註" : "Note"}
        <input value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
      </label>
      <p className={tooLarge ? "portal-error" : "portal-note"}>
        {zh ? "內容大小：" : "Size: "}
        {`${bodyBytes.toLocaleString()} / ${MAX_REVISION_BYTES.toLocaleString()} ${zh ? "位元組" : "bytes"}`}
      </p>
      <label>
        <input type="checkbox" checked={activate} disabled={busy} onChange={(event) => setActivate(event.target.checked)} />{" "}
        {zh ? "儲存後立即啟用" : "Activate immediately after saving"}
      </label>
      {message !== null && (
        <p className="portal-error" role="alert">{message}</p>
      )}
      <div className="portal-actions">
        <button type="button" className="portal-button" disabled={busy || tooLarge} onClick={save}>
          {busy ? (zh ? "儲存中…" : "Saving…") : zh ? "儲存版本" : "Save revision"}
        </button>
      </div>
    </section>
  );
}

type TryResult = { rev: number | null; note?: string; reply?: string; usage?: Record<string, unknown> | null; error?: string };

function revisionLabel(rev: number | null, zh: boolean) {
  return rev === null ? (zh ? "使用中版本" : "Active revision") : zh ? `版本 ${rev}` : `Revision ${rev}`;
}

function tokenCount(usage: Record<string, unknown> | null | undefined, key: string) {
  const value = usage?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "—";
}

export function TryPanel({
  personaId,
  revisions,
  hasActive,
}: {
  personaId: string;
  revisions: PersonaRevisionSummary[];
  hasActive: boolean;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [input, setInput] = useState("");
  const [revA, setRevA] = useState<string>(hasActive ? "" : String(revisions[0]?.rev ?? ""));
  const [revB, setRevB] = useState<string>("none");
  const [maxTokens, setMaxTokens] = useState("300");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<TryResult[] | null>(null);
  const disabled = revisions.length === 0;

  async function run() {
    if (busy || disabled) return;
    const tokens = Number(maxTokens);
    const inputProblem = textProblem(input, MAX_INPUT);
    if (inputProblem === "unsafe") {
      setMessage(unsafeMessage({ en: "test message", zh: "測試訊息" }, zh));
      return;
    }
    if (!input.trim() || inputProblem === "long") {
      setMessage(zh ? "請輸入 1–4,000 字的測試訊息。" : "Enter a test message of 1 to 4,000 characters.");
      return;
    }
    if (!Number.isInteger(tokens) || tokens < 1 || tokens > MAX_TOKENS) {
      setMessage(zh ? "最大 token 數須為 1–1,024 的整數。" : "Max tokens must be a whole number from 1 to 1,024.");
      return;
    }
    const revs: (number | null)[] = [revA === "" ? null : Number(revA)];
    if (revB !== "none") revs.push(revB === "" ? null : Number(revB));
    setBusy(true);
    setMessage(null);
    setResults(null);
    try {
      const response = await portalRequest<{ results: TryResult[] }>(`/admin/personas/${encodeURIComponent(personaId)}/try`, {
        method: "POST",
        body: JSON.stringify({ input, revs, maxTokens: tokens }),
      });
      setResults(Array.isArray(response.results) ? response.results : []);
    } catch (reason: unknown) {
      // 504 is either the gateway not answering in time (gateway_timeout) or the BFF's own 95 s limit.
      const timedOut = reason instanceof PortalError && reason.status === 504;
      setMessage(
        timedOut
          ? zh
            ? "試跑逾時，沒有收到結果；模型可能已經執行並用掉 token，重試前請先確認用量。"
            : "The try timed out without a result. The model may still have run and used tokens; check usage before retrying."
          : portalErrorText(reason, locale),
      );
    } finally {
      setBusy(false);
    }
  }

  const options = (
    <>
      {hasActive && <option value="">{revisionLabel(null, zh)}</option>}
      {revisions.map((item) => (
        <option key={item.rev} value={String(item.rev)}>{revisionLabel(item.rev, zh)}</option>
      ))}
    </>
  );
  return (
    <section className="portal-panel">
      <h2>{zh ? "試跑" : "Try"}</h2>
      {disabled ? (
        <p className="portal-note">{zh ? "需要先有一個版本才能試跑。" : "Save a revision before trying this persona."}</p>
      ) : (
        <>
          <label className="portal-field">
            {zh ? "測試訊息" : "Test message"}
            <textarea rows={3} value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} />
          </label>
          <label className="portal-field">
            {zh ? "版本 A" : "Revision A"}
            <select value={revA} disabled={busy} onChange={(event) => setRevA(event.target.value)}>{options}</select>
          </label>
          <label className="portal-field">
            {zh ? "版本 B（比較，可選）" : "Revision B (compare, optional)"}
            <select value={revB} disabled={busy} onChange={(event) => setRevB(event.target.value)}>
              <option value="none">{zh ? "不比較" : "No comparison"}</option>
              {options}
            </select>
          </label>
          <label className="portal-field">
            {zh ? "最大 token 數" : "Max tokens"}
            <input type="number" min={1} max={MAX_TOKENS} value={maxTokens} disabled={busy} onChange={(event) => setMaxTokens(event.target.value)} />
          </label>
          <p className="portal-note">
            {zh
              ? "每次試跑都會實際呼叫模型並計入閘道用量（會留下操作紀錄）。最多約 90 秒；逾時的試跑仍可能已經用掉 token。"
              : "Every try calls the model and counts toward gateway usage (it is recorded in the audit log). It can take up to about 90 seconds; a try that times out may still have used tokens."}
          </p>
          {message !== null && (
            <p className="portal-error" role="alert">{message}</p>
          )}
          <div className="portal-actions">
            <button type="button" className="portal-button" disabled={busy} onClick={run}>
              {busy ? (zh ? "試跑中…" : "Running…") : zh ? "試跑" : "Run try"}
            </button>
            {busy && <span className="portal-note" role="status">{zh ? "最多約 90 秒" : "This can take up to about 90 seconds."}</span>}
          </div>
          <div
            className="persona-try-results"
            aria-live="polite"
            style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(results?.length ?? 1, 1)}, minmax(0, 1fr))`, gap: "1rem" }}
          >
              {(results ?? []).map((result, index) => (
                <article key={index} className="portal-panel" aria-label={revisionLabel(result.rev ?? null, zh)}>
                  <h3>{revisionLabel(result.rev ?? null, zh)}</h3>
                  {typeof result.error === "string" ? (
                    <p className="portal-error">{result.error}</p>
                  ) : (
                    <>
                      <pre style={{ whiteSpace: "pre-wrap" }}>{result.reply ?? ""}</pre>
                      <p className="portal-note">
                        {zh ? "輸入／輸出 token：" : "Input / output tokens: "}
                        {tokenCount(result.usage, "prompt_tokens")} / {tokenCount(result.usage, "completion_tokens")}
                      </p>
                    </>
                  )}
                </article>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
