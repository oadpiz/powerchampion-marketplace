"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { codePoints, textProblem, unsafeMessage } from "../lib/admin-text";
import { portalRequest } from "../lib/portal-client";
import {
  noteHasPhoneNumber,
  REVIEW_LABELS,
  REVIEW_STATUSES,
  type CallReview,
  type CallReviewResult,
  type MetricKey,
  type QualityDetail,
  type QualityItem,
  type QualityLimits,
  type ReviewLabel,
  type ReviewStatus,
} from "../lib/voice-quality";
import { purposeLabel } from "./admin-voice-dialogs";
import { AdminVoiceQualityContent } from "./admin-voice-quality-content";
import {
  AUTO_FLAG_LABEL,
  DEGRADE_LABEL,
  ENTRY_LABEL,
  HANDOFF_LABEL,
  MESSAGE_OUTCOME_LABEL,
  METER_REASON_LABEL,
  NO_STORE,
  OUTCOME_LABEL,
  REVIEW_LABEL_COPY,
  REVIEW_STATUS_LABEL,
  fill,
  qualityErrorText,
  say,
  taipeiDate,
  taipeiTime,
  working,
  type Copy,
} from "./admin-voice-quality-labels";
import { useLocale } from "./locale-provider";

/*
 * The in-page call drawer of the Quality tab (phase2-contract §7.2 A10, §7.3 A11, §11.3 "抽屜", "審查"). Opened from
 * a row's "Open" button; the heading takes focus, and the list puts focus back on that row's button when it closes.
 * Lines follow the §11.3 wording; a value the call does not have shows "—".
 */

const D = {
  close: { zh: "關閉", en: "Close" },
  loading: { zh: "正在載入通話…", en: "Loading the call…" },
  identity: { zh: "識別", en: "Identity" },
  identityLine: { zh: "通話編號 {callId}・號碼 {dialed}{purpose}・入口 {entry}", en: "Call {callId} · Number {dialed}{purpose} · Entry {entry}" },
  times: { zh: "時間", en: "Time" },
  timesLine: { zh: "開始 {start}・接起 {answered}・結束 {ended}・長度 {length}", en: "Started {start} · Answered {answered} · Ended {ended} · Length {length}" },
  length: { zh: "{m} 分 {s} 秒", en: "{m}m {s}s" },
  versions: { zh: "版本", en: "Versions" },
  versionLine: { zh: "設定第 {n} 版（sha {sha}）・告知 {notice}", en: "Settings v{n} (sha {sha}) · Notice {notice}" },
  noSettings: { zh: "沒有使用 AI 設定・告知 {notice}", en: "No AI settings used · Notice {notice}" },
  result: { zh: "結果", en: "Result" },
  handoff: { zh: "轉真人：{reason}", en: "Handed off: {reason}" },
  urgent: { zh: "這通聽到緊急字眼。", en: "Urgent words were heard on this call." },
  measures: { zh: "指標", en: "Measures" },
  measuresLine: {
    zh: "客人說話：AI 段 {s} 秒、合計 {t} 秒・{turns} 輪・回應 p50 {a} ms／p95 {b} ms・插話 {c}・墊話 {d}・搶話 {e}・沒回應 {f}",
    en: "Caller spoke: {s} s with the AI, {t} s in total · {turns} turns · reply p50 {a} ms / p95 {b} ms · barge-ins {c} · fillers {d} · talk-overs {e} · no responses {f}",
  },
  message: { zh: "留言", en: "Message" },
  messageLine: { zh: "{outcome}（說話 {speech} 秒、錄音 {recording} 秒）", en: "{outcome} ({speech} s of speech, {recording} s recorded)" },
  callback: { zh: "回電號碼已確認（{via}）", en: "Callback number confirmed ({via})" },
  declined: { zh: "客人要求不錄音", en: "The caller asked not to be recorded" },
  pending: { zh: "留言結果還沒收到。", en: "The message result has not arrived yet." },
  fallback: { zh: "降級：{reason}", en: "Fallback: {reason}" },
  flags: { zh: "自動標記", en: "Auto flags" },
  sources: { zh: "來源", en: "Sources" },
  sourcesLine: { zh: "編排器 {orchestrator}・紀錄端 {records}", en: "Orchestrator {orchestrator} · Records {records}" },
  notReceived: { zh: "尚未收到", en: "not received" },
  mismatch: { zh: "兩邊紀錄不一致的欄位：{fields}", en: "Fields that disagree: {fields}" },
  meter: { zh: "計量", en: "Metering" },
  meterLine: { zh: "預估 {units} 則（{reason}，規則 {rule}）", en: "Estimated {units} ({reason}, rule {rule})" },
  retention: { zh: "保存", en: "Retention" },
  retentionLine: {
    zh: "逐字稿到 {transcript}・錄音到 {recording}・明細到 {detail}・錄音天數：店家 {snap}，上報 {rep}",
    en: "Transcript until {transcript} · Recording until {recording} · Record until {detail} · Recording days: store {snap}, reported {rep}",
  },
  storeFlag: { zh: "店家標記", en: "Store flag" },
  storeFlagLine: { zh: "店家在 {time} 標記「答錯了」：{note}", en: "The store flagged this as a wrong answer on {time}: {note}" },
  storeFlagBare: { zh: "店家在 {time} 標記「答錯了」。", en: "The store flagged this as a wrong answer on {time}." },
  review: { zh: "審查", en: "Review" },
  score: { zh: "分數（1 很差～5 很好）", en: "Score (1 poor – 5 good)" },
  labels: { zh: "標籤（最多 {n} 個）", en: "Labels (up to {n})" },
  note: { zh: "備註（最多 {n} 字）", en: "Note (up to {n} characters)" },
  noteHint: {
    zh: "只寫判斷與處理，不要貼逐字稿、客人電話或姓名。",
    en: "Write only your judgement and follow-up; do not paste the transcript or the caller's number or name.",
  },
  noteCount: { zh: "{n} / {max} 字", en: "{n} / {max} characters" },
  status: { zh: "狀態", en: "Status" },
  save: { zh: "儲存審查", en: "Save review" },
  saved: { zh: "已儲存（{reviewer}，{time}）", en: "Saved ({reviewer}, {time})" },
  savedNow: { zh: "已儲存審查。", en: "The review is saved." },
  unchanged: { zh: "審查沒有變更。", en: "The review did not change." },
  needScore: { zh: "請選擇分數（1～5）。", en: "Choose a score from 1 to 5." },
  tooManyLabels: { zh: "標籤最多 {n} 個。", en: "Choose up to {n} labels." },
  noteTooLong: { zh: "備註最多 {n} 字。", en: "The note can be up to {n} characters." },
  noteNumber: { zh: "備註裡不要寫電話號碼。", en: "Do not put phone numbers in the note." },
} satisfies Record<string, Copy>;

const VIA: Record<string, Copy> = { dtmf: { zh: "按鍵", en: "keypad" }, speech: { zh: "語音", en: "speech" } };

/** Limits when A9 has not answered yet: phase2-contract §1.5 (A9 `limits` replaces them as soon as it arrives). */
const FALLBACK_LIMITS: QualityLimits = { callsPageSize: 100, reviewNoteChars: 500, reviewLabelsMax: 6, listeningMax: 500 };

const dash = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? "—" : String(value));

export function AdminVoiceQualityDrawer({
  item,
  limits,
  onClose,
  onReviewed,
}: {
  item: QualityItem;
  limits: QualityLimits | null;
  onClose: () => void;
  onReviewed: (call: QualityDetail["call"], review: CallReview, before: CallReview | null) => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [result, setResult] = useState<{ data: QualityDetail | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    portalRequest<QualityDetail>(`/admin/voice/quality/calls/${item.id}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ data: null, error, loading: false });
      });
    return () => controller.abort();
  }, [item.id]);

  const detail = result.data;
  const call = detail?.call ?? item;
  const title = `${call.store?.name ?? say(NO_STORE, zh)}${zh ? "・" : " · "}${taipeiTime(call.startedAt, zh)}`;
  return (
    <section id="voice-quality-drawer" className="portal-panel" aria-labelledby="voice-quality-drawer-title">
      <div className="portal-panel-heading">
        <h2 id="voice-quality-drawer-title" ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" className="portal-button-secondary" onClick={onClose}>
          {say(D.close, zh)}
        </button>
      </div>
      {result.loading && (
        <p className="portal-muted" role="status">
          {say(D.loading, zh)}
        </p>
      )}
      {result.error !== null && (
        <p className="portal-error" role="alert">
          {qualityErrorText(result.error, locale)}
        </p>
      )}
      {detail && (
        <>
          <CallFacts detail={detail} zh={zh} />
          <AdminVoiceQualityContent rowId={detail.call.id} content={detail.content} />
          <ReviewForm
            detail={detail}
            limits={limits ?? FALLBACK_LIMITS}
            onSaved={(review, before) => {
              setResult((current) => (current.data ? { ...current, data: { ...current.data, call: { ...current.data.call, review } } } : current));
              onReviewed(detail.call, review, before);
            }}
          />
        </>
      )}
    </section>
  );
}

function CallFacts({ detail, zh }: { detail: QualityDetail; zh: boolean }) {
  const { call, sources } = detail;
  const t = (copy: Copy, values: Record<string, string | number> = {}) => fill(say(copy, zh), values);
  const metric = (key: MetricKey) => dash(call.metrics[key]);
  const length =
    call.durationSeconds === null ? "—" : t(D.length, { m: Math.floor(call.durationSeconds / 60), s: call.durationSeconds % 60 });
  const message = call.message;
  const messageParts = [
    t(D.messageLine, {
      outcome: MESSAGE_OUTCOME_LABEL[message.outcome] ? say(MESSAGE_OUTCOME_LABEL[message.outcome], zh) : message.outcome,
      speech: message.speechSeconds,
      recording: message.recordingSeconds,
    }),
  ];
  if (message.callbackConfirmed) messageParts.push(t(D.callback, { via: message.callbackVia && VIA[message.callbackVia] ? say(VIA[message.callbackVia], zh) : "—" }));
  if (message.recordingDeclined) messageParts.push(say(D.declined, zh));
  const sep = zh ? "・" : " · ";
  const received = (source: QualityDetail["sources"]["orchestrator"]) => (source ? taipeiTime(source.receivedAt, zh) : say(D.notReceived, zh));
  return (
    <dl className="portal-meta">
      <dt>{say(D.identity, zh)}</dt>
      <dd>
        {t(D.identityLine, {
          callId: call.callId,
          dialed: dash(call.dialed),
          purpose: call.numberPurpose ? (zh ? `（${purposeLabel(call.numberPurpose, zh)}）` : ` (${purposeLabel(call.numberPurpose, zh)})`) : "",
          entry: ENTRY_LABEL[call.entry] ? say(ENTRY_LABEL[call.entry], zh) : call.entry,
        })}
      </dd>
      <dt>{say(D.times, zh)}</dt>
      <dd>
        {t(D.timesLine, {
          start: taipeiTime(call.startedAt, zh),
          answered: taipeiTime(call.answeredAt, zh),
          ended: taipeiTime(call.endedAt, zh),
          length,
        })}
      </dd>
      <dt>{say(D.versions, zh)}</dt>
      <dd>
        {call.configVersion === null
          ? t(D.noSettings, { notice: dash(call.disclosureVersion) })
          : t(D.versionLine, { n: call.configVersion, sha: dash(call.configSha256?.slice(0, 8)), notice: dash(call.disclosureVersion) })}
      </dd>
      <dt>{say(D.result, zh)}</dt>
      <dd>
        {[
          OUTCOME_LABEL[call.outcome] ? say(OUTCOME_LABEL[call.outcome], zh) : call.outcome,
          ...(call.handoff ? [t(D.handoff, { reason: call.handoffReason && HANDOFF_LABEL[call.handoffReason] ? say(HANDOFF_LABEL[call.handoffReason], zh) : "—" })] : []),
          ...(call.degraded ? [t(D.fallback, { reason: call.degradeReason && DEGRADE_LABEL[call.degradeReason] ? say(DEGRADE_LABEL[call.degradeReason], zh) : "—" })] : []),
        ].join(sep)}
        {call.urgent && (
          <>
            <br />
            {say(D.urgent, zh)}
          </>
        )}
      </dd>
      <dt>{say(D.measures, zh)}</dt>
      <dd>
        {t(D.measuresLine, {
          s: call.aiSpeechSeconds,
          t: call.callSpeechSeconds,
          turns: call.turns,
          a: metric("reply_p50_ms"),
          b: metric("reply_p95_ms"),
          c: metric("barge_ins"),
          d: metric("fillers"),
          e: metric("talk_overs"),
          f: metric("no_responses"),
        })}
      </dd>
      <dt>{say(D.message, zh)}</dt>
      <dd>
        {messageParts.join(sep)}
        {!message.final && (
          <>
            <br />
            {say(D.pending, zh)}
          </>
        )}
      </dd>
      {call.autoFlags.length > 0 && (
        <>
          <dt>{say(D.flags, zh)}</dt>
          <dd>{call.autoFlags.map((flag) => (AUTO_FLAG_LABEL[flag] ? say(AUTO_FLAG_LABEL[flag], zh) : flag)).join(zh ? "、" : ", ")}</dd>
        </>
      )}
      <dt>{say(D.sources, zh)}</dt>
      <dd>
        {t(D.sourcesLine, { orchestrator: received(sources.orchestrator), records: received(sources.records) })}
        {call.mismatch.length > 0 && (
          <>
            <br />
            {t(D.mismatch, { fields: call.mismatch.join(", ") })}
          </>
        )}
      </dd>
      <dt>{say(D.meter, zh)}</dt>
      <dd>
        {t(D.meterLine, {
          units: call.meterUnits,
          reason: METER_REASON_LABEL[call.meterReason] ? say(METER_REASON_LABEL[call.meterReason], zh) : call.meterReason,
          rule: call.meterRule,
        })}
      </dd>
      <dt>{say(D.retention, zh)}</dt>
      <dd>
        {t(D.retentionLine, {
          transcript: taipeiDate(call.retention.transcriptUntil, zh),
          recording: taipeiDate(call.retention.recordingUntil, zh),
          detail: taipeiDate(call.retention.detailUntil, zh),
          snap: call.retention.snapshotDays,
          rep: dash(call.retention.reportedDays),
        })}
      </dd>
      {call.storeFlag && (
        <>
          <dt>{say(D.storeFlag, zh)}</dt>
          <dd>
            {call.storeFlag.note
              ? t(D.storeFlagLine, { time: taipeiTime(call.storeFlag.flaggedAt, zh), note: call.storeFlag.note })
              : t(D.storeFlagBare, { time: taipeiTime(call.storeFlag.flaggedAt, zh) })}
          </dd>
        </>
      )}
    </dl>
  );
}

function ReviewForm({
  detail,
  limits,
  onSaved,
}: {
  detail: QualityDetail;
  limits: QualityLimits;
  onSaved: (review: CallReview, before: CallReview | null) => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const current = detail.call.review;
  const [score, setScore] = useState<number | null>(current?.score ?? null);
  const [labels, setLabels] = useState<ReviewLabel[]>(current?.labels ?? []);
  const [note, setNote] = useState(current?.note ?? "");
  // A new review defaults to done: reviewing a flagged call usually finishes it; "open" keeps it in "To review".
  const [status, setStatus] = useState<ReviewStatus>(current?.status ?? "done");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<{ kind: "error" | "status"; text: string } | null>(null);
  const t = (copy: Copy, values: Record<string, string | number> = {}) => fill(say(copy, zh), values);
  const maxLabels = limits.reviewLabelsMax;
  const maxNote = limits.reviewNoteChars;

  function validate(): string | null {
    if (score === null) return say(D.needScore, zh);
    if (labels.length > maxLabels) return t(D.tooManyLabels, { n: maxLabels });
    if (textProblem(note, Number.MAX_SAFE_INTEGER) === "unsafe") return unsafeMessage({ en: "note", zh: "備註" }, zh);
    if (codePoints(note.trim()) > maxNote) return t(D.noteTooLong, { n: maxNote });
    if (noteHasPhoneNumber(note)) return say(D.noteNumber, zh);
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    const invalid = validate();
    if (invalid) {
      setMessage({ kind: "error", text: invalid });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await portalRequest<CallReviewResult>(`/admin/voice/quality/calls/${detail.call.id}/review`, {
        method: "POST",
        body: JSON.stringify({ score, labels: REVIEW_LABELS.filter((label) => labels.includes(label)), note: note.trim(), status }),
      });
      setNote(result.review.note);
      setMessage({ kind: "status", text: say(result.changed ? D.savedNow : D.unchanged, zh) });
      onSaved(result.review, detail.call.review);
    } catch (error: unknown) {
      setMessage({ kind: "error", text: qualityErrorText(error, locale) });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const review = detail.call.review;
  return (
    <form onSubmit={(event) => void submit(event)} noValidate aria-labelledby="voice-quality-review-title">
      <h3 id="voice-quality-review-title">{say(D.review, zh)}</h3>
      <fieldset className="portal-choices">
        <legend>{say(D.score, zh)}</legend>
        {[1, 2, 3, 4, 5].map((value) => (
          <label key={value} className="portal-choice">
            <input
              type="radio"
              name="voice-review-score"
              value={value}
              checked={score === value}
              disabled={busy}
              onChange={() => setScore(value)}
            />
            {value}
          </label>
        ))}
      </fieldset>
      <fieldset className="portal-choices">
        <legend>{t(D.labels, { n: maxLabels })}</legend>
        {REVIEW_LABELS.map((value) => {
          const checked = labels.includes(value);
          return (
            <label key={value} className="portal-choice">
              <input
                type="checkbox"
                checked={checked}
                disabled={busy || (!checked && labels.length >= maxLabels)}
                onChange={() => setLabels((list) => (checked ? list.filter((label) => label !== value) : [...list, value]))}
              />
              {say(REVIEW_LABEL_COPY[value], zh)}
            </label>
          );
        })}
      </fieldset>
      <label className="portal-field">
        {t(D.note, { n: maxNote })}
        <textarea
          value={note}
          disabled={busy}
          rows={4}
          aria-describedby="voice-quality-note-hint voice-quality-note-count"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <p id="voice-quality-note-hint" className="portal-hint">
        {say(D.noteHint, zh)}
      </p>
      <p id="voice-quality-note-count" className="portal-hint">
        {t(D.noteCount, { n: codePoints(note.trim()), max: maxNote })}
      </p>
      <fieldset className="portal-choices">
        <legend>{say(D.status, zh)}</legend>
        {REVIEW_STATUSES.map((value) => (
          <label key={value} className="portal-choice">
            <input type="radio" name="voice-review-status" value={value} checked={status === value} disabled={busy} onChange={() => setStatus(value)} />
            {say(REVIEW_STATUS_LABEL[value], zh)}
          </label>
        ))}
      </fieldset>
      {review && (
        <p className="portal-muted" data-voice-review-saved="">
          {t(D.saved, { reviewer: review.reviewer.email, time: taipeiTime(review.updatedAt, zh) })}
        </p>
      )}
      {message !== null && (
        <p className={message.kind === "error" ? "portal-error" : "portal-note"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      <div className="portal-actions">
        <button type="submit" className="portal-button" disabled={busy}>
          {busy ? working(zh) : say(D.save, zh)}
        </button>
      </div>
    </form>
  );
}

