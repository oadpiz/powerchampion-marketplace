"use client";

import Link from "next/link";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { codePoints, unsafeMessage } from "../lib/admin-text";
import { PortalError, portalRequest } from "../lib/portal-client";
import {
  AFTER_HOURS_MODES,
  ASK_CALLBACK,
  RECORDING_MODES,
  WEEKDAYS,
  draftFromSetup,
  draftSegments,
  isSetupResponse,
  minuteText,
  newSegment,
  openingInfo,
  retentionMax,
  rowKey,
  setupChanges,
  setupProblems,
  timeChoices,
  voiceErrorText,
  warningCounts,
  type SetupDraft,
  type VoicePreview,
  type VoicePublishResult,
  type VoiceSetupResponse,
  type VoiceWarning,
} from "../lib/voice-setup";
import type { VoiceSubProps } from "./account-voice";
import { useLocale } from "./locale-provider";

type Load =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: VoiceSetupResponse };

type Notice =
  | { kind: "saved" }
  | { kind: "applied" | "unchanged"; version: number; warnings: VoiceWarning[] };

type PreviewState =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: VoicePreview };

const INDUSTRY: Record<string, [string, string]> = {
  clinic: ["Clinic", "診所"],
  cram: ["Cram school", "補習班"],
  other: ["Other", "其他"],
};

const AFTER_HOURS_LABEL: Record<(typeof AFTER_HOURS_MODES)[number], [string, string]> = {
  answer_and_message: ["Answer questions; take a message when the caller needs a person", "照常回答問題，要找人時請客人留言"],
  message_only: ["Only take a message; do not answer questions", "只請客人留言，不回答問題"],
};

const ASK_CALLBACK_LABEL: Record<(typeof ASK_CALLBACK)[number], [string, string]> = {
  auto: ["When needed", "視情況"],
  always: ["Always", "一定要問"],
  never: ["Never", "不要問"],
};

const RECORDING_LABEL: Record<(typeof RECORDING_MODES)[number], [string, string]> = {
  off: ["Do not record", "不錄音"],
  message_only: ["Record messages only (recommended)", "只錄留言（建議）"],
  full: ["Record whole calls (we must enable this)", "全程錄音（需由我們開通）"],
};

/** Fieldsets group radios and disable the whole form; they should not draw a box of their own. */
const bare = { border: 0, padding: 0, margin: 0, minWidth: 0 } as const;

/** /account/voice/setup and /account/voice (contract §8.2): the merchant's setup, saved with M3 and applied with M11. */
export const AccountVoiceSetup: (props: VoiceSubProps) => ReactElement = ({ summary, onChanged }: VoiceSubProps) => {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const pick = (pair: [string, string]) => pair[zh ? 1 : 0];
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [busy, setBusy] = useState<"save" | "apply" | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    async function run() {
      setLoad({ status: "loading" });
      try {
        const data = await portalRequest<unknown>("/me/voice/setup", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!isSetupResponse(data)) throw new PortalError(502, "service_unavailable", "Unexpected setup response.");
        setLoad({ status: "ready", data });
        setDraft(draftFromSetup(data.setup));
      } catch (cause) {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", error: cause });
      }
    }
    void run();
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!previewOpen) return;
    const controller = new AbortController();
    async function run() {
      setPreview({ status: "loading" });
      try {
        const data = await portalRequest<VoicePreview>("/me/voice/preview", { signal: controller.signal });
        if (!controller.signal.aborted) setPreview({ status: "ready", data });
      } catch (cause) {
        if (!controller.signal.aborted) setPreview({ status: "error", error: cause });
      }
    }
    void run();
    return () => controller.abort();
  }, [previewOpen, previewNonce]);

  if (load.status !== "ready" || !draft)
    return (
      <section className="portal-panel" aria-labelledby="voice-setup-title">
        <h2 id="voice-setup-title">{zh ? "設定" : "Setup"}</h2>
        {load.status === "error" ? (
          <>
            <p role="alert" className="portal-error">
              {voiceErrorText(load.error, locale, summary.limits)}
            </p>
            <div className="portal-actions">
              <button type="button" className="portal-button-secondary" onClick={() => setAttempt((value) => value + 1)}>
                {zh ? "重新載入" : "Try again"}
              </button>
            </div>
          </>
        ) : (
          <p className="portal-empty" role="status">
            {zh ? "正在載入設定…" : "Loading settings…"}
          </p>
        )}
      </section>
    );

  const { setup, disclosure, template } = load.data;
  const limits = load.data.limits;
  const readOnly = setup.status === "suspended" || summary.store.status === "suspended";
  const opening = openingInfo(disclosure.template, draft.name, draft.greeting, limits);
  const problems = setupProblems(draft, disclosure.template, limits, setup.recordingMode);
  const changes = setupChanges(setup, draft);
  const dirty = Object.keys(changes).length > 0;
  const seconds = opening.seconds.toFixed(1);
  const keepMax = retentionMax(draft.recordingMode, limits);
  const update = (patch: Partial<SetupDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setNotice(null);
  };

  async function save(apply: boolean) {
    // The fieldset already disables the buttons; this also covers a click that reaches the handler anyway.
    if (!draft || load.status !== "ready" || problems.any || readOnly || busy !== null) return;
    setBusy(apply ? "apply" : "save");
    setActionError(null);
    setNotice(null);
    let saved = false;
    try {
      const body = setupChanges(load.data.setup, draft);
      if (Object.keys(body).length) {
        const result = await portalRequest<unknown>("/me/voice/setup", { method: "POST", body: JSON.stringify(body) });
        if (!isSetupResponse(result)) throw new PortalError(502, "service_unavailable", "Unexpected setup response.");
        saved = true;
        setLoad({ status: "ready", data: result });
        setDraft(draftFromSetup(result.setup));
      }
      if (!apply) {
        setNotice({ kind: "saved" });
      } else {
        // Contract §1.1: a POST without fields still sends {} so the backend sees a JSON body.
        const result = await portalRequest<VoicePublishResult>("/me/voice/publish", { method: "POST", body: "{}" });
        setNotice({
          kind: result.changed ? "applied" : "unchanged",
          version: result.version ?? summary.store.currentVersion ?? 0,
          warnings: Array.isArray(result.warnings) ? result.warnings : [],
        });
      }
      onChanged();
      setPreviewNonce((value) => value + 1);
    } catch (cause) {
      setActionError(cause);
      if (saved) {
        setNotice({ kind: "saved" });
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  }

  const securityLink = (text: string) => <Link href="/account/security">{text}</Link>;
  const errorText = (error: unknown): ReactNode =>
    error instanceof PortalError && error.code === "password_change_required" ? (
      zh ? (
        <>請先到「{securityLink("安全性")}」變更我們發給你的臨時密碼，再修改設定或試打。</>
      ) : (
        <>Change the temporary password we gave you under {securityLink("Security")} before editing or trying a call.</>
      )
    ) : (
      voiceErrorText(error, locale, limits)
    );

  const nameMessage =
    problems.name === "empty"
      ? zh
        ? "請填寫店名。"
        : "Enter a store name."
      : problems.name === "long"
        ? zh
          ? `店名最多 ${limits.storeNameChars} 字（不含空白）。`
          : `The store name can be up to ${limits.storeNameChars} characters, not counting spaces.`
        : problems.name === "unsafe"
          ? unsafeMessage({ en: "store name", zh: "店名" }, zh)
          : null;
  const greetingMessage =
    problems.greeting === "long"
      ? voiceErrorText(new PortalError(400, "greeting_too_long", ""), locale, limits)
      : problems.greeting === "unsafe"
        ? unsafeMessage({ en: "greeting", zh: "開場白" }, zh)
        : null;
  const shortenField = opening.shorten === "name" ? (zh ? "店名" : "store name") : zh ? "開場白" : "greeting";

  const setSegment = (key: number, patch: { openMin?: number; closeMin?: number }) =>
    update({ hours: draft.hours.map((segment) => (segment.key === key ? { ...segment, ...patch } : segment)) });
  const setClosure = (key: number, patch: { date?: string; note?: string }) =>
    update({ closures: draft.closures.map((closure) => (closure.key === key ? { ...closure, ...patch } : closure)) });

  const segmentMessage = (problem: string | undefined) =>
    problem === "order"
      ? zh
        ? "結束時間要晚於開始時間。"
        : "The end time must be later than the start time."
      : problem === "overlap"
        ? zh
          ? "同一天的時段不能重疊。"
          : "Hours on the same day cannot overlap."
        : null;
  const closureMessage = (problem: string | undefined) =>
    problem === "duplicate"
      ? zh
        ? "這個日期已經加過了。"
        : "This date is already listed."
      : problem === "date"
        ? voiceErrorText(new PortalError(400, "closures_invalid", ""), locale, limits)
        : problem === "note_long"
          ? zh
            ? `備註最多 ${limits.closureNoteChars} 字。`
            : `Notes can be up to ${limits.closureNoteChars} characters.`
          : problem === "note_unsafe"
            ? unsafeMessage({ en: "note", zh: "備註" }, zh)
            : null;

  const counts = notice && notice.kind !== "saved" ? warningCounts(notice.warnings) : null;

  return (
    <form
      aria-labelledby="voice-setup-title"
      onSubmit={(event) => {
        // Saving is only ever a button press; Enter in a field must not apply a new version.
        event.preventDefault();
      }}
    >
      <fieldset style={bare} disabled={readOnly || busy !== null}>
        <section className="portal-panel" aria-labelledby="voice-setup-basics">
          <h2 id="voice-setup-title">{zh ? "設定" : "Setup"}</h2>
          <h3 id="voice-setup-basics">{zh ? "基本資料" : "Basics"}</h3>
          <label className="portal-field">
            {zh ? "店名" : "Store name"}
            <input
              value={draft.name}
              autoComplete="organization"
              aria-describedby="voice-setup-name-hint voice-setup-name-left"
              aria-invalid={problems.name !== null || opening.shorten === "name"}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <p id="voice-setup-name-hint" className="portal-hint">
            {zh ? "客人會在開場聽到這個名字。" : "Callers hear this name at the start of the call."}
          </p>
          {/* Amendment A1: the notice, the store name and the greeting share the 15-second opening. */}
          <p id="voice-setup-name-left" className={opening.ok ? "portal-hint" : "portal-error"} aria-live="polite">
            {opening.ok
              ? zh
                ? `開場白剩餘字數：${opening.remaining}（告知文字、店名、開場白合計最多 ${limits.openingNonSpaceMax} 字，不含空白）`
                : `Greeting characters left: ${opening.remaining} (the notice, store name and greeting share ${limits.openingNonSpaceMax} characters, not counting spaces)`
              : zh
                ? `開場超過 ${limits.openingSecondsMax} 秒，請縮短${shortenField}。`
                : `The opening is longer than ${limits.openingSecondsMax} seconds. Shorten the ${shortenField}.`}
          </p>
          {nameMessage && (
            <p className="portal-error" role="alert">
              {nameMessage}
            </p>
          )}
          <p>
            {zh ? "產業：" : "Industry: "}
            {INDUSTRY[setup.industry] ? pick(INDUSTRY[setup.industry]) : setup.industry}
          </p>
          <p className="portal-hint">{zh ? "產業由我們在開通時設定。" : "We set the industry when we open your account."}</p>
        </section>

        <section className="portal-panel" aria-labelledby="voice-setup-opening">
          <h3 id="voice-setup-opening">{zh ? "開場" : "Opening"}</h3>
          <label className="portal-field">
            {zh ? "開場白" : "Greeting"}
            <input
              value={draft.greeting}
              aria-describedby="voice-setup-greeting-count"
              aria-invalid={problems.greeting !== null || opening.shorten === "greeting"}
              onChange={(event) => update({ greeting: event.target.value })}
            />
          </label>
          <p id="voice-setup-greeting-count" className="portal-hint">
            {zh
              ? `${codePoints(draft.greeting.trim())} / ${limits.greetingChars} 字`
              : `${codePoints(draft.greeting.trim())} / ${limits.greetingChars} characters`}
          </p>
          {greetingMessage && (
            <p className="portal-error" role="alert">
              {greetingMessage}
            </p>
          )}
          {template.available && (
            <div className="portal-actions">
              <button
                type="button"
                className="portal-button-secondary"
                onClick={() => update({ greeting: template.greetingExample })}
              >
                {zh ? "用範本的開場白" : "Use the template greeting"}
              </button>
            </div>
          )}
          <p>{zh ? "客人接通後會先聽到：" : "Callers hear this first:"}</p>
          <p className="portal-note" aria-live="polite" data-voice-opening="">
            {opening.text}
          </p>
          <p className="portal-hint">
            {zh
              ? "前半段是平台固定的告知（會帶入店名），後半段是你的開場白。"
              : "The first part is the fixed notice (with your store name); the rest is your greeting."}
          </p>
          <p aria-live="polite">
            {zh
              ? `約 ${seconds} 秒（上限 ${limits.openingSecondsMax} 秒）`
              : `About ${seconds} s (limit ${limits.openingSecondsMax} s)`}
          </p>
          {!opening.ok && (
            <p className="portal-error" role="alert">
              {zh
                ? `開場太長（約 ${seconds} 秒），請把開場白縮短到 ${limits.openingSecondsMax} 秒內，才能儲存。`
                : `The opening is too long (about ${seconds} s). Shorten the greeting to ${limits.openingSecondsMax} s or less to save.`}
            </p>
          )}
        </section>

        <section className="portal-panel" aria-labelledby="voice-setup-hours">
          <h3 id="voice-setup-hours">{zh ? "營業時間" : "Business hours"}</h3>
          <p className="portal-hint">
            {zh
              ? "營業時間內與下班時間，AI 的說法會不一樣。沒有設定時，AI 會一直當作下班時間。"
              : "The AI answers differently during and outside business hours. Without hours, it always treats calls as after hours."}
          </p>
          {template.available && (
            <div className="portal-actions">
              <button
                type="button"
                className="portal-button-secondary"
                onClick={() => update({ hours: draftSegments(template.hoursExample) })}
              >
                {zh ? "用範本的營業時間" : "Use the template hours"}
              </button>
            </div>
          )}
          <div className="portal-table-wrap">
            <table className="portal-table">
              <tbody>
                {WEEKDAYS.map((day, weekday) => {
                  const label = zh ? day.zh : day.en;
                  const segments = draft.hours.filter((segment) => segment.weekday === weekday);
                  const full = segments.length >= limits.hoursSegmentsPerDay;
                  return (
                    <tr key={day.en}>
                      <th scope="row">{label}</th>
                      <td>
                        {segments.length === 0 && <span className="portal-muted">{zh ? "休息" : "Closed"}</span>}
                        {segments.map((segment, index) => {
                          const message = segmentMessage(problems.segments.get(segment.key));
                          const name = zh ? `${label}第 ${index + 1} 段` : `${label} range ${index + 1}`;
                          return (
                            <div key={segment.key} className="portal-field" style={{ margin: "0 0 10px" }}>
                              <div className="portal-actions">
                                <select
                                  style={{ width: "auto" }}
                                  aria-label={zh ? `${name}開始` : `${name} from`}
                                  value={segment.openMin}
                                  aria-invalid={message !== null}
                                  onChange={(event) => setSegment(segment.key, { openMin: Number(event.target.value) })}
                                >
                                  {timeChoices("open", segment.openMin).map((minute) => (
                                    <option key={minute} value={minute}>
                                      {minuteText(minute)}
                                    </option>
                                  ))}
                                </select>
                                <span>{zh ? "到" : "to"}</span>
                                <select
                                  style={{ width: "auto" }}
                                  aria-label={zh ? `${name}結束` : `${name} to`}
                                  value={segment.closeMin}
                                  aria-invalid={message !== null}
                                  onChange={(event) => setSegment(segment.key, { closeMin: Number(event.target.value) })}
                                >
                                  {timeChoices("close", segment.closeMin).map((minute) => (
                                    <option key={minute} value={minute}>
                                      {minuteText(minute)}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="portal-text-button"
                                  aria-label={zh ? `刪除${name}` : `Remove ${name}`}
                                  onClick={() => update({ hours: draft.hours.filter((item) => item.key !== segment.key) })}
                                >
                                  {zh ? "刪除" : "Remove"}
                                </button>
                              </div>
                              {message && (
                                <span className="portal-error" role="alert">
                                  {message}
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {problems.crowdedDays.has(weekday) && (
                          <p className="portal-error" role="alert">
                            {zh
                              ? `每天最多 ${limits.hoursSegmentsPerDay} 個時段。`
                              : `Up to ${limits.hoursSegmentsPerDay} time ranges per day.`}
                          </p>
                        )}
                        <div>
                          <button
                            type="button"
                            className="portal-text-button"
                            disabled={full}
                            title={
                              full
                                ? zh
                                  ? `每天最多 ${limits.hoursSegmentsPerDay} 個時段。`
                                  : `Up to ${limits.hoursSegmentsPerDay} time ranges per day.`
                                : undefined
                            }
                            aria-label={zh ? `${label}：＋新增時段` : `+ Add hours (${label})`}
                            onClick={() => update({ hours: [...draft.hours, newSegment(draft.hours, weekday)] })}
                          >
                            {zh ? "＋新增時段" : "+ Add hours"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3 id="voice-setup-closures">{zh ? "特殊休假日" : "Special closures"}</h3>
          {draft.closures.map((closure, index) => {
            const message = closureMessage(problems.closures.get(closure.key));
            const name = zh ? `第 ${index + 1} 個休假日` : `closure ${index + 1}`;
            return (
              <div key={closure.key} className="portal-field" style={{ margin: "0 0 10px" }}>
                <div className="portal-actions">
                  <input
                    type="date"
                    style={{ width: "auto" }}
                    aria-label={zh ? `${name}的日期` : `Date of ${name}`}
                    aria-invalid={message !== null}
                    value={closure.date}
                    onChange={(event) => setClosure(closure.key, { date: event.target.value })}
                  />
                  <input
                    style={{ width: "auto", flex: 1 }}
                    aria-label={zh ? `${name}的備註（選填）` : `Note for ${name} (optional)`}
                    placeholder={zh ? "備註（選填）" : "Note (optional)"}
                    value={closure.note}
                    onChange={(event) => setClosure(closure.key, { note: event.target.value })}
                  />
                  <button
                    type="button"
                    className="portal-text-button"
                    aria-label={zh ? `刪除${name}` : `Remove ${name}`}
                    onClick={() => update({ closures: draft.closures.filter((item) => item.key !== closure.key) })}
                  >
                    {zh ? "刪除" : "Remove"}
                  </button>
                </div>
                {message && (
                  <span className="portal-error" role="alert">
                    {message}
                  </span>
                )}
              </div>
            );
          })}
          {problems.tooManyClosures && (
            <p className="portal-error" role="alert">
              {zh ? `最多 ${limits.closuresMax} 個休假日。` : `Up to ${limits.closuresMax} closures.`}
            </p>
          )}
          <div className="portal-actions">
            <button
              type="button"
              className="portal-text-button"
              disabled={draft.closures.length >= limits.closuresMax}
              onClick={() => update({ closures: [...draft.closures, { date: "", note: "", key: rowKey() }] })}
            >
              {zh ? "＋新增休假日" : "+ Add a closure"}
            </button>
          </div>
        </section>

        <section className="portal-panel" aria-labelledby="voice-setup-messages">
          <h3 id="voice-setup-messages">{zh ? "留言與回電" : "Messages and callbacks"}</h3>
          <fieldset style={bare} className="portal-field">
            <legend>{zh ? "下班時間的做法" : "After hours"}</legend>
            {AFTER_HOURS_MODES.map((mode) => (
              <label key={mode}>
                <input
                  type="radio"
                  name="voice-after-hours"
                  value={mode}
                  checked={draft.afterHoursMode === mode}
                  onChange={() => update({ afterHoursMode: mode })}
                />{" "}
                {pick(AFTER_HOURS_LABEL[mode])}
              </label>
            ))}
          </fieldset>
          <label className="portal-field">
            {zh ? "要不要問客人的回電號碼" : "Ask for a callback number"}
            <select value={draft.askCallback} onChange={(event) => update({ askCallback: event.target.value })}>
              {ASK_CALLBACK.map((mode) => (
                <option key={mode} value={mode}>
                  {pick(ASK_CALLBACK_LABEL[mode])}
                </option>
              ))}
            </select>
          </label>
          <div className="portal-field">
            <div className="portal-actions">
              <span>{zh ? "留言最長" : "Messages up to"}</span>
              <input
                type="number"
                inputMode="numeric"
                style={{ width: "6em" }}
                min={limits.maxMessageSecondsMin}
                max={limits.maxMessageSecondsMax}
                step={1}
                aria-label={zh ? "留言最長秒數" : "Maximum message length in seconds"}
                aria-invalid={problems.maxMessageSeconds}
                value={draft.maxMessageSeconds}
                onChange={(event) => update({ maxMessageSeconds: event.target.value })}
              />
              <span>
                {zh
                  ? `秒（${limits.maxMessageSecondsMin}～${limits.maxMessageSecondsMax}）`
                  : `s (${limits.maxMessageSecondsMin}–${limits.maxMessageSecondsMax})`}
              </span>
            </div>
            {problems.maxMessageSeconds && (
              <span className="portal-error" role="alert">
                {zh
                  ? `留言長度要在 ${limits.maxMessageSecondsMin}～${limits.maxMessageSecondsMax} 秒之間（整數）。`
                  : `Messages must be ${limits.maxMessageSecondsMin}–${limits.maxMessageSecondsMax} s (whole seconds).`}
              </span>
            )}
          </div>
          <p>
            {zh
              ? "需要真人時：請店家回電（即時轉接之後才開放）"
              : "When a person is needed: we ask the store to call back (live transfer comes later)"}
          </p>
        </section>

        <section className="portal-panel" aria-labelledby="voice-setup-recording">
          <h3 id="voice-setup-recording">{zh ? "錄音與保存" : "Recording and retention"}</h3>
          <fieldset style={bare} className="portal-field">
            <legend>{zh ? "錄音方式" : "Recording"}</legend>
            {RECORDING_MODES.map((mode) => (
              <label key={mode}>
                <input
                  type="radio"
                  name="voice-recording"
                  value={mode}
                  checked={draft.recordingMode === mode}
                  // Whole-call recording is enabled by us (contract §3.3): it can be kept, never chosen here.
                  disabled={mode === "full" && setup.recordingMode !== "full"}
                  onChange={() => update({ recordingMode: mode })}
                />{" "}
                {pick(RECORDING_LABEL[mode])}
              </label>
            ))}
          </fieldset>
          <div className="portal-field">
            <div className="portal-actions">
              <span>{zh ? "錄音保存" : "Keep recordings for"}</span>
              <input
                type="number"
                inputMode="numeric"
                style={{ width: "6em" }}
                min={1}
                max={keepMax}
                step={1}
                aria-label={zh ? "錄音保存天數" : "Days to keep recordings"}
                aria-describedby="voice-setup-retention-hint"
                aria-invalid={problems.retentionDays !== null}
                value={draft.retentionDays}
                onChange={(event) => update({ retentionDays: event.target.value })}
              />
              <span>{zh ? "天" : "days"}</span>
            </div>
            <span id="voice-setup-retention-hint" className="portal-hint">
              {zh ? `最多 ${keepMax} 天，只能設得比上限短。` : `Up to ${keepMax} days; you can only shorten it.`}
            </span>
            {problems.retentionDays && (
              <span className="portal-error" role="alert">
                {problems.retentionDays === "over"
                  ? `${voiceErrorText(new PortalError(400, "retention_exceeds_limit", ""), locale, limits)}${
                      zh ? `（最多 ${keepMax} 天）` : ` (up to ${keepMax} days)`
                    }`
                  : zh
                    ? "請輸入 1 以上的整數天數。"
                    : "Enter a whole number of days, 1 or more."}
              </span>
            )}
          </div>
          <p className="portal-hint">{zh ? "試打不計費，也不留存錄音。" : "Test calls are free and are not recorded."}</p>
        </section>

        <section className="portal-panel" aria-label={zh ? "儲存" : "Save"}>
          <p>
            {setup.aiAnswerEnabled
              ? zh
                ? "AI 回答：已開啟。"
                : "AI answers: on."
              : zh
                ? "AI 回答：尚未開啟。正式來電目前只會請客人留言；試打一律會用 AI 回答，讓你先聽聽看。"
                : "AI answers: not turned on yet. Real calls only take messages for now; test calls always use AI answers so you can hear them."}
          </p>
          {problems.any && (
            <p className="portal-hint">
              {zh ? "請先修正上面標示的欄位，才能儲存。" : "Fix the fields marked above before you save."}
            </p>
          )}
          <div className="portal-actions">
            <button
              type="button"
              className="portal-button-secondary"
              disabled={!dirty || problems.any || readOnly || busy !== null}
              onClick={() => void save(false)}
            >
              {busy === "save" ? (zh ? "處理中…" : "Working…") : zh ? "儲存" : "Save"}
            </button>
            <button
              type="button"
              className="portal-button"
              disabled={problems.any || readOnly || busy !== null}
              onClick={() => void save(true)}
            >
              {busy === "apply" ? (zh ? "處理中…" : "Working…") : zh ? "儲存並套用" : "Save and apply"}
            </button>
          </div>
        </section>
      </fieldset>

      {(actionError !== null || notice) && (
        <section className="portal-panel" aria-label={zh ? "結果" : "Result"}>
          {actionError !== null && (
            <p className="portal-error" role="alert">
              {errorText(actionError)}
            </p>
          )}
          {notice?.kind === "saved" && (
            <p className="portal-note" role="status">
              {zh ? "已儲存。按「儲存並套用」後，試打才會用到。" : 'Saved. Use "Save and apply" so test calls use it.'}
            </p>
          )}
          {notice && notice.kind !== "saved" && (
            <p className="portal-note" role="status">
              {notice.kind === "unchanged" ? (
                zh ? (
                  `內容沒有變更，仍是第 ${notice.version} 版。`
                ) : (
                  `Nothing changed; still version ${notice.version}.`
                )
              ) : zh ? (
                <>
                  已套用第 {notice.version} 版，可以到「<Link href="/account/voice/try">試打一通</Link>」聽聽看。
                </>
              ) : (
                <>
                  Version {notice.version} is applied. Go to &quot;<Link href="/account/voice/try">Try a call</Link>&quot; to
                  hear it.
                </>
              )}
            </p>
          )}
          {counts && counts.placeholders > 0 && (
            <p className="portal-note" role="status">
              {zh ? (
                <>
                  還有 {counts.placeholders} 個地方寫著「（請填入）」，AI 可能會照著念。請到「
                  <Link href="/account/voice/faq">常見問答</Link>」補上。
                </>
              ) : (
                <>
                  {counts.placeholders} places still say &quot;（請填入）&quot; (to be filled in); the AI may read them aloud.
                  Fill them in on <Link href="/account/voice/faq">FAQ</Link>.
                </>
              )}
            </p>
          )}
          {counts?.hoursEmpty && (
            <p className="portal-note" role="status">
              {zh
                ? "還沒設定營業時間，AI 會一直當作下班時間。"
                : "No business hours yet; the AI will treat every call as after hours."}
            </p>
          )}
        </section>
      )}

      <section className="portal-panel" aria-label={zh ? "AI 會收到的內容" : "What the AI receives"}>
        <button
          type="button"
          className="portal-text-button"
          aria-expanded={previewOpen}
          aria-controls="voice-setup-ai-preview"
          onClick={() => setPreviewOpen((open) => !open)}
        >
          {zh ? "查看 AI 會收到的完整內容" : "Show everything the AI receives"}
        </button>
        {previewOpen && (
          <div id="voice-setup-ai-preview">
            {/* Amendment A2: store text in the prompt has its brackets replaced, so the preview can differ. */}
            <p className="portal-hint">
              {zh
                ? "這裡是已儲存的草稿編譯後的樣子，還沒儲存的修改不會出現。為了避免店家文字被當成規則，【】和〖〗會換成「」；店名和不讓 AI 回答的問題會放在引號裡，裡面的【】〖〗「」會換成『』。"
                : "This is the saved draft as the AI gets it; unsaved edits are not included. So that store text cannot pass for rules, 【】 and 〖〗 are replaced with 「」; the store name and the questions the AI must not answer are quoted, and any 【】〖〗「」 in them become 『』."}
            </p>
            {preview.status === "loading" && (
              <p className="portal-empty" role="status">
                {zh ? "正在載入…" : "Loading…"}
              </p>
            )}
            {preview.status === "error" && (
              <p className="portal-error" role="alert">
                {voiceErrorText(preview.error, locale, limits)}
              </p>
            )}
            {preview.status === "ready" &&
              (Array.isArray(preview.data.problems) ? preview.data.problems : []).map((problem, index) => (
                <p key={`${problem.code}-${index}`} className="portal-error">
                  {voiceErrorText(new PortalError(409, problem.code, problem.detail ?? ""), locale, limits)}
                </p>
              ))}
            {preview.status === "ready" && typeof preview.data.config?.prompt?.prefix === "string" && (
              <pre className="portal-note" style={{ whiteSpace: "pre-wrap" }} data-voice-prompt="">
                {preview.data.config.prompt.prefix}
              </pre>
            )}
          </div>
        )}
      </section>
    </form>
  );
};
