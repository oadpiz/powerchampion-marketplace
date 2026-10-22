"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { codePoints, lineProblem, unsafeMessage } from "../lib/admin-text";
import { PortalError, portalRequest } from "../lib/portal-client";
import {
  CALL_ROW_ID,
  ENTRY_LABELS,
  FLAG_NOTE_CHARS_DEFAULT,
  HANDOFF_REASON_LABELS,
  METER_REASON_LABELS,
  OUTCOME_LABELS,
  callTime,
  callerText,
  durationText,
  hasPhoneNumber,
  taipeiParts,
  type CallDetail,
  type CallFlag,
  type CallFlagResult,
  type CallItem,
  type CallUnflagResult,
} from "../lib/voice-calls";
import { voiceErrorText } from "../lib/voice-setup";
import type { VoiceSubProps } from "./account-voice";
import { CallContentPanel } from "./account-voice-calls-content";
import { useLocale } from "./locale-provider";

/** §11.1 badges: test call, fallback (unless that is already the result), urgent. */
export function CallBadges({ call, zh }: { call: Pick<CallItem, "entry" | "outcome" | "degraded" | "urgent">; zh: boolean }) {
  const badges: string[] = [];
  if (call.entry === "try") badges.push(zh ? "試打" : "Test call");
  if (call.degraded && call.outcome !== "degraded") badges.push(zh ? "降級" : "Fallback");
  if (call.urgent) badges.push(zh ? "緊急" : "Urgent");
  return (
    <>
      {badges.map((badge) => (
        <span key={badge}>
          {" "}
          <span className="portal-badge">{badge}</span>
        </span>
      ))}
    </>
  );
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only an M14 body is rendered; anything else shows the load error. */
function isCallDetail(value: unknown): value is CallDetail {
  return (
    record(value) &&
    record(value.call) &&
    typeof value.call.id === "string" &&
    record(value.call.caller) &&
    record(value.content) &&
    (value.flag === null || record(value.flag))
  );
}

/** A modal <dialog> like the FAQ page's (jsdom has no showModal, so `open` is set instead); focus returns on close. */
function Modal({ labelledBy, busy, onClose, children }: { labelledBy: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    element.querySelector<HTMLElement>("input, button")?.focus();
    return () => {
      if (typeof element.close === "function") element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="portal-dialog"
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

/**
 * §12.1 and phase 1 §9 copy for the errors this page can get; the temporary-password one links to Security. `action`
 * names a write that failed with a network error or 5xx, so it does not read like the list's load failure.
 */
function callErrorText(error: unknown, locale: "en" | "zh", action?: "flag" | "unflag"): ReactNode {
  const zh = locale === "zh";
  const code = error instanceof PortalError ? error.code : "";
  if (code === "call_not_found")
    return zh ? "這通紀錄不存在，或不屬於你的店。" : "This call does not exist or does not belong to your store.";
  if (code === "note_contains_number") return zh ? "備註裡不要寫電話號碼。" : "Do not put phone numbers in the note.";
  if (code === "password_change_required")
    return (
      <>
        {zh ? "請先到「" : "Change the temporary password we gave you under "}
        <Link href="/account/security">{zh ? "安全性" : "Security"}</Link>
        {zh ? "」變更我們發給你的臨時密碼，才能查看內容或標記。" : " before viewing content or flagging calls."}
      </>
    );
  if (code === "voice_store_not_found" || code === "store_suspended") return voiceErrorText(error, locale);
  // Not in the contract's §11.2 (fix round): a flag that did not go through is not a page that did not load.
  if (action && (!(error instanceof PortalError) || error.status >= 500))
    return action === "flag"
      ? zh
        ? "標記沒有送出，請稍後再試。"
        : "The flag was not sent. Try again later."
      : zh
        ? "標記沒有取消，請稍後再試。"
        : "The flag was not removed. Try again later.";
  if (!(error instanceof PortalError) || error.status >= 500 || error.status === 404)
    return zh ? "通話紀錄載入失敗，請重新整理。" : "Calls could not be loaded. Reload the page.";
  return voiceErrorText(error, locale);
}

type Load = { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; detail: CallDetail };

/**
 * /account/voice/calls/<id>, one call (phase2-contract §6.2-§6.5, §11.2): its facts and estimated billing, the
 * content read from the Taiwan host on request (CallContentPanel), and the store's "wrong answer" flag (M15, M16).
 */
export function AccountVoiceCallDetail({ summary, onChanged, callId }: VoiceSubProps & { callId: string }): ReactElement {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const valid = CALL_ROW_ID.test(callId);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    async function read() {
      // Another call's page reuses this component, so the previous call is never shown while the next one loads.
      setLoad({ status: "loading" });
      try {
        const detail = await portalRequest<unknown>(`/me/voice/calls/${callId}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!isCallDetail(detail)) throw new PortalError(502, "service_unavailable", "Unexpected answer.");
        setLoad({ status: "ready", detail });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", error });
      }
    }
    void read();
    return () => controller.abort();
  }, [callId, valid, reload]);

  const back = (
    <p>
      <Link href="/account/voice/calls">{zh ? "← 通話紀錄" : "← Calls"}</Link>
    </p>
  );
  // The route only lets 32 lowercase hex through; anything else is the not-found case without asking the backend.
  const shown: Load = valid ? load : { status: "error", error: new PortalError(404, "call_not_found", "Not found.") };
  if (shown.status !== "ready")
    return (
      <section className="portal-panel" aria-labelledby="voice-call-title">
        {back}
        <h2 id="voice-call-title">{zh ? "通話明細" : "Call details"}</h2>
        {shown.status === "loading" ? (
          <p className="portal-empty" role="status">
            {zh ? "正在載入通話紀錄…" : "Loading calls…"}
          </p>
        ) : (
          <div className="portal-empty">
            <p className="portal-error" role="alert">
              {callErrorText(shown.error, locale)}
            </p>
            {!(shown.error instanceof PortalError && shown.error.code === "call_not_found") && (
              <button type="button" className="portal-button-secondary" onClick={() => setReload((value) => value + 1)}>
                {zh ? "重新載入" : "Try again"}
              </button>
            )}
          </div>
        )}
      </section>
    );

  const { detail } = shown;
  return (
    <CallView
      key={detail.call.id}
      detail={detail}
      suspended={summary.store.status === "suspended"}
      locked={summary.account.passwordChangeRequired}
      back={back}
      onFlag={(flag) => setLoad({ status: "ready", detail: { ...detail, flag, call: { ...detail.call, flagged: flag !== null } } })}
      onChanged={onChanged}
    />
  );
}

function CallView({
  detail,
  suspended,
  locked,
  back,
  onFlag,
  onChanged,
}: {
  detail: CallDetail;
  suspended: boolean;
  locked: boolean;
  back: ReactNode;
  onFlag: (flag: CallFlag | null) => void;
  onChanged: () => void;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const { call, content, flag } = detail;
  const started = taipeiParts(call.startedAt);
  const title = started
    ? zh
      ? `${callTime(call.startedAt, zh)} 的來電`
      : `Call on ${callTime(call.startedAt, zh).replace(/, (\d\d:\d\d)$/, " at $1")}`
    : zh
      ? "通話明細"
      : "Call details";
  const ended = taipeiParts(call.endedAt);
  const time = started
    ? `${callTime(call.startedAt, zh)}:${started.second}${ended ? `${zh ? "～" : " – "}${ended.hour}:${ended.minute}:${ended.second}` : ""}`
    : "—";
  const reason = METER_REASON_LABELS[call.meterReason]?.[locale] ?? call.meterReason;
  const billing =
    call.meterUnits === 1
      ? zh
        ? `預估計 1 則（${reason}）`
        : `Estimated 1 billable (${reason})`
      : zh
        ? `不計費：${reason}`
        : `Not billed: ${reason}`;
  const handoffReason = call.handoffReason ? HANDOFF_REASON_LABELS[call.handoffReason]?.[locale] : null;

  // Like the phase 1 pages, each part is its own panel, so its text gets the panel's sizes.
  return (
    <>
      <section className="portal-panel" aria-labelledby="voice-call-title">
        {back}
        <h2 id="voice-call-title">
          {title}
          <CallBadges call={call} zh={zh} />
        </h2>
        <p>
          {zh ? `通話編號 ${call.ref}` : `Call ID ${call.ref}`}{" "}
          <span className="portal-hint">{zh ? "跟我們聯絡時請提供這個編號" : "Give us this ID if you contact us"}</span>
        </p>
        <dl className="portal-meta">
          <dt>{zh ? "時間" : "Time"}</dt>
          <dd>{time}</dd>
          <dt>{zh ? "長度" : "Length"}</dt>
          <dd>{durationText(call.durationSeconds, zh)}</dd>
          <dt>{zh ? "來電" : "Caller"}</dt>
          <dd>{callerText(call, zh)}</dd>
          <dt>{zh ? "入口" : "Entry"}</dt>
          <dd>{ENTRY_LABELS[call.entry]?.[locale] ?? call.entry}</dd>
          <dt>{zh ? "結果" : "Result"}</dt>
          <dd>{OUTCOME_LABELS[call.outcome]?.[locale] ?? call.outcome}</dd>
          <dt>{zh ? "設定版本" : "Settings version"}</dt>
          <dd>
            {call.configVersion === null
              ? zh
                ? "沒有使用 AI 設定"
                : "No AI settings used"
              : zh
                ? `第 ${call.configVersion} 版`
                : `Version ${call.configVersion}`}
          </dd>
          <dt>{zh ? "計費" : "Billing"}</dt>
          <dd>{billing}</dd>
        </dl>
        {call.handoff && (
          <p>{handoffReason ? (zh ? `轉真人：${handoffReason}` : `Handed off: ${handoffReason}`) : zh ? "轉真人" : "Handed off"}</p>
        )}
        {call.urgent && <p>{zh ? "這通聽到緊急字眼。" : "Urgent words were heard on this call."}</p>}
        {call.degraded && (
          <p>
            {zh
              ? "AI 這通暫時無法服務，已改請客人留言。"
              : "The AI could not serve this call, so the caller was asked to leave a message."}
          </p>
        )}
        {call.hasMessage && <p>{zh ? "客人有留言" : "The caller left a message"}</p>}
        {call.callbackConfirmed && <p>{zh ? "留了回電號碼（已確認）" : "Left a callback number (confirmed)"}</p>}
        {locked && (
          <p className="portal-note" role="status">
            {zh ? "請先到「" : "Change the temporary password we gave you under "}
            <Link href="/account/security">{zh ? "安全性" : "Security"}</Link>
            {zh ? "」變更我們發給你的臨時密碼，才能查看內容或標記。" : " before viewing content or flagging calls."}
          </p>
        )}
      </section>
      <CallContentPanel callRowId={call.id} content={content} locked={locked} onChanged={onChanged} />
      {/* "Did the AI get it wrong?" only where the AI took part (a settings version was used); a flag set before stays removable. */}
      {(call.configVersion !== null || flag !== null) && (
        <FlagPanel callRowId={call.id} flag={flag} suspended={suspended} locked={locked} onFlag={onFlag} onChanged={onChanged} />
      )}
    </>
  );
}

/** Why the note would be refused, checked like the backend (single line, length in code points, no phone number). */
function noteProblem(note: string, maximum: number): "unsafe" | "long" | "number" | null {
  const problem = lineProblem(note, maximum, false);
  if (problem === "unsafe" || problem === "long") return problem;
  return hasPhoneNumber(note.trim()) ? "number" : null;
}

/** §6.3-§6.4, §11.2: flag the call as a wrong answer (with an optional note), or remove the flag. */
function FlagPanel({
  callRowId,
  flag,
  suspended,
  locked,
  onFlag,
  onChanged,
}: {
  callRowId: string;
  flag: CallFlag | null;
  suspended: boolean;
  locked: boolean;
  onFlag: (flag: CallFlag | null) => void;
  onChanged: () => void;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const maximum = FLAG_NOTE_CHARS_DEFAULT;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"flag" | "unflag" | null>(null);
  const [error, setError] = useState<{ cause: unknown; action: "flag" | "unflag" } | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  /** Element id to focus after the re-render a write causes (its button is replaced; phase 1 focus fix). */
  const focusId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    // Runs after the dialog's own focus restore (its cleanup), so this one wins.
    if (focusId.current === null) return;
    const element = document.getElementById(focusId.current);
    focusId.current = null;
    element?.focus();
  });

  const disabled = suspended || locked;
  const problem = noteProblem(note, maximum);
  const problemText =
    problem === "unsafe"
      ? unsafeMessage({ en: "note", zh: "備註" }, zh)
      : problem === "long"
        ? zh
          ? `備註最多 ${maximum} 字。`
          : `The note can be up to ${maximum} characters.`
        : problem === "number"
          ? zh
            ? "備註裡不要寫電話號碼。"
            : "Do not put phone numbers in the note."
          : null;

  function afterError(cause: unknown, action: "flag" | "unflag") {
    setError({ cause, action });
    // The store or the account changed under us: re-read M1 so the shell says so.
    if (cause instanceof PortalError && ["store_suspended", "password_change_required", "voice_store_not_found"].includes(cause.code)) onChanged();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || disabled || problem !== null) return;
    inFlight.current = true;
    setBusy("flag");
    setError(null);
    try {
      const result = await portalRequest<CallFlagResult>(`/me/voice/calls/${callRowId}/flag`, {
        method: "POST",
        body: JSON.stringify({ kind: "wrong_answer", note: note.trim() }),
      });
      if (!mounted.current) return;
      focusId.current = "voice-call-unflag";
      setOpen(false);
      onFlag(result.flag);
    } catch (cause) {
      if (mounted.current) afterError(cause, "flag");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  async function unflag() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy("unflag");
    setError(null);
    try {
      // M16 reads no body.
      await portalRequest<CallUnflagResult>(`/me/voice/calls/${callRowId}/flag`, { method: "DELETE" });
      if (!mounted.current) return;
      focusId.current = "voice-call-flag-open";
      onFlag(null);
    } catch (cause) {
      if (mounted.current) afterError(cause, "unflag");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  const flagged = flag !== null;
  const flaggedAt = flagged ? callTime(flag.flaggedAt, zh) : "";
  return (
    <section className="portal-panel" aria-labelledby="voice-call-flag-title">
      <h3 id="voice-call-flag-title">{zh ? "標記「答錯了」" : "Flag as wrong answer"}</h3>
      {suspended && (
        <p className="portal-note" role="status">
          {zh
            ? "這家店的電話客服已暫停，不能標記，但仍可查看紀錄。"
            : "Phone agent is suspended for this store; you cannot flag calls but can still view them."}
        </p>
      )}
      {flagged ? (
        <>
          <p>
            {zh ? `你在 ${flaggedAt} 標記了「答錯了」。` : `You flagged this call as a wrong answer on ${flaggedAt}.`}
          </p>
          {flag.note && (
            <dl className="portal-meta">
              <dt>{zh ? "哪裡答錯了？" : "What was wrong?"}</dt>
              <dd>{flag.note}</dd>
            </dl>
          )}
          <p className="portal-muted">
            {flag.reviewed
              ? zh
                ? "我們已經檢查過這通。"
                : "We have reviewed this call."
              : zh
                ? "我們還沒檢查這通。"
                : "We have not reviewed this call yet."}
          </p>
          <div className="portal-actions">
            <button
              id="voice-call-unflag"
              type="button"
              className="portal-button-secondary"
              disabled={disabled || busy !== null}
              onClick={() => void unflag()}
            >
              {busy === "unflag" ? (zh ? "處理中…" : "Working…") : zh ? "取消標記" : "Remove flag"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="portal-muted">
            {zh ? "AI 這通答錯了嗎？標記後我們會檢查並改進。" : "Did the AI get something wrong on this call? Flag it and we will review it."}
          </p>
          <div className="portal-actions">
            <button
              id="voice-call-flag-open"
              type="button"
              className="portal-button-secondary"
              disabled={disabled || busy !== null}
              onClick={() => {
                setNote("");
                setError(null);
                setOpen(true);
              }}
            >
              {zh ? "標記「答錯了」" : "Flag as wrong answer"}
            </button>
          </div>
        </>
      )}
      {!open && error !== null && (
        <p className="portal-error" role="alert">
          {callErrorText(error.cause, locale, error.action)}
        </p>
      )}
      {open && (
        <Modal labelledBy="voice-call-flag-dialog-title" busy={busy === "flag"} onClose={() => setOpen(false)}>
          <form onSubmit={(event) => void submit(event)} noValidate>
            <h2 id="voice-call-flag-dialog-title">{zh ? "標記「答錯了」" : "Flag as wrong answer"}</h2>
            <label className="portal-field">
              {zh ? `哪裡答錯了？（選填，最多 ${maximum} 字）` : `What was wrong? (optional, up to ${maximum} characters)`}
              <input
                type="text"
                value={note}
                aria-invalid={problem !== null}
                aria-describedby="voice-call-flag-hint"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            <p id="voice-call-flag-hint" className="portal-hint">
              {zh ? "請不要寫客人的電話號碼或姓名。" : "Do not include the caller's phone number or name."}{" "}
              {zh ? `${codePoints(note.trim())} / ${maximum} 字` : `${codePoints(note.trim())} / ${maximum} characters`}
            </p>
            {problemText !== null && (
              <p className="portal-error" role="alert">
                {problemText}
              </p>
            )}
            {error !== null && (
              <p className="portal-error" role="alert">
                {callErrorText(error.cause, locale, error.action)}
              </p>
            )}
            <div className="portal-actions">
              <button type="button" className="portal-button-secondary" disabled={busy === "flag"} onClick={() => setOpen(false)}>
                {zh ? "取消" : "Cancel"}
              </button>
              <button type="submit" className="portal-button" disabled={busy !== null || problem !== null || disabled}>
                {busy === "flag" ? (zh ? "處理中…" : "Working…") : zh ? "送出" : "Flag"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
