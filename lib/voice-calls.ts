/**
 * Phone agent call records (phase 2): the enums and API shapes the store's "Calls" page (/account/voice/calls, P2-2)
 * and the operators' "Quality" tab (/admin/voice, P2-6, see lib/voice-quality.ts) share. Shapes follow
 * phase2-contract.md §6 (M13-M17) and the backend's JSON (server/voice_calls.py call_item, call_detail,
 * content_json, store_flag_json); the backend is authoritative.
 *
 * Each enum is written as `export const NAME = [...] as const;` on purpose: server/test_voice_calls_sync.py reads
 * this file and fails when a list differs from the backend's (LESSONS 2026-10-21). Give label tables the matching
 * `Record<…, …>` type so a new value cannot be left without copy.
 */

/** §3.5 result classes (voice_calls.outcome). */
export const OUTCOMES = ["answered", "message", "handoff", "degraded", "not_answered", "hangup_early", "no_speech", "error", "unknown"] as const;
/** How the call came in: phone line, web call, internal softphone, test call. */
export const ENTRIES = ["pstn", "webrtc", "softphone", "try"] as const;
/** §12.2: why a call is or is not billable (A6 metering.py names). */
export const METER_REASONS = [
  "ai_speech",
  "message",
  "callback",
  "try",
  "unknown_line",
  "non_customer_line",
  "channel_not_billable",
  "not_answered",
  "no_message_record",
  "processing_error",
  "notice_hangup",
  "no_speech",
  "short_speech",
  "callback_unconfirmed",
] as const;
export const HANDOFF_REASONS = ["requested", "no_answer", "no_ai_question", "urgent", "complaint"] as const;
export const CALLER_KINDS = ["mobile", "landline", "hidden", "web", "unknown"] as const;
/** M15: phase 2 has one kind of store flag. */
export const FLAG_KINDS = ["wrong_answer"] as const;
/** M14 content.state: none (nothing kept), expired (past every retention date), available. */
export const CONTENT_STATES = ["none", "expired", "available"] as const;
/** What a content link (M17, A12) can open on the Taiwan host. */
export const MEDIA_KINDS = ["recording", "summary", "transcript"] as const;

export type CallOutcome = (typeof OUTCOMES)[number];
export type CallEntry = (typeof ENTRIES)[number];
export type MeterReason = (typeof METER_REASONS)[number];
export type HandoffReason = (typeof HANDOFF_REASONS)[number];
export type CallerKind = (typeof CALLER_KINDS)[number];
export type FlagKind = (typeof FLAG_KINDS)[number];
export type ContentState = (typeof CONTENT_STATES)[number];
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** CallItem (§6). `durationSeconds` is null when the hang-up time is unknown; `caller.tail` is null once expired. */
export type CallItem = {
  id: string;
  ref: string;
  startedAt: string;
  durationSeconds: number | null;
  entry: CallEntry;
  caller: { tail: string | null; kind: CallerKind };
  outcome: CallOutcome;
  hasMessage: boolean;
  handoff: boolean;
  urgent: boolean;
  degraded: boolean;
  flagged: boolean;
  meterUnits: 0 | 1;
  meterReason: MeterReason;
};

/** M13 `limits`; read them from the response, never hard-code them. */
export type CallLimits = { callsPageSize: number; flagNoteChars: number };

/** M13 GET /me/voice/calls. `summary` covers `month` only; `next` is the `before` cursor of the next page or null. */
export type CallList = {
  calls: CallItem[];
  next: string | null;
  summary: {
    month: string;
    total: number;
    byOutcome: Record<CallOutcome, number>;
    meterUnits: number;
    flagged: number;
  };
  limits: CallLimits;
};

/** M13 filters as the BFF forwards them (app/api/portal/[...path]/route.ts checks each one). */
export type CallListQuery = { month?: string; outcome?: CallOutcome; flagged?: "1"; before?: string };

/** M14 content (also A10). */
export type CallContent = {
  expected: boolean;
  hasRecording: boolean;
  transcriptUntil: string | null;
  recordingUntil: string | null;
  state: ContentState;
  linkAvailable: boolean;
};

/** The store's own flag (M14, M15). `reviewed` is true once an operator finished a review; scores stay hidden. */
export type CallFlag = { kind: FlagKind; note: string; flaggedAt: string; reviewed: boolean };

/** M14 GET /me/voice/calls/{id}. */
export type CallDetail = {
  call: CallItem & {
    answeredAt: string | null;
    endedAt: string | null;
    configVersion: number | null;
    handoffReason: HandoffReason | null;
    callbackConfirmed: boolean;
    messageSeconds: number;
    recordingSeconds: number;
  };
  content: CallContent;
  flag: CallFlag | null;
};

/** M15 body. `note` is one line, at most `limits.flagNoteChars`, and must not hold a phone number. */
export type CallFlagInput = { kind: FlagKind; note?: string };
/** M15 answer. */
export type CallFlagResult = { changed: boolean; flag: CallFlag };
/** M16 answer. */
export type CallUnflagResult = { changed: boolean };

/**
 * M17 and A12 answer. The token is a secret for 5 minutes: send it only as `Authorization: Bearer …` to the URLs
 * here, and never put it in a URL, a log or an error message (§6.5, §8.3).
 */
export type ContentLink = {
  media: {
    token: string;
    expiresAt: string;
    kinds: MediaKind[];
    urls: Partial<Record<MediaKind, string>>;
  };
};

// ---------------------------------------------------------------- copy and checks shared by the pages (P2-2)

/** One string in both site languages (phase2-contract §11 writes every string as { zh, en }). */
export type CallCopy = { en: string; zh: string };

/** §11.1 result names (also the result filter's options). */
export const OUTCOME_LABELS: Record<CallOutcome, CallCopy> = {
  answered: { en: "Answered", zh: "已回答" },
  message: { en: "Message", zh: "留言" },
  handoff: { en: "Handed off", zh: "轉真人" },
  degraded: { en: "Fallback", zh: "降級" },
  not_answered: { en: "Not connected", zh: "未接通" },
  hangup_early: { en: "Hung up early", zh: "開頭就掛斷" },
  no_speech: { en: "No speech", zh: "沒有說話" },
  error: { en: "Failed", zh: "處理失敗" },
  unknown: { en: "Pending", zh: "待補紀錄" },
};

/** §11.2 "Entry". */
export const ENTRY_LABELS: Record<CallEntry, CallCopy> = {
  pstn: { en: "Phone line", zh: "市話" },
  webrtc: { en: "Web call", zh: "網頁通話" },
  softphone: { en: "Internal softphone", zh: "內部軟電話" },
  try: { en: "Test call", zh: "試打" },
};

/** §12.2: the basis of a billable call, or why a call is not billed. */
export const METER_REASON_LABELS: Record<MeterReason, CallCopy> = {
  ai_speech: { en: "AI answered and the caller spoke for 3 seconds or more", zh: "AI 接聽，客人說話滿 3 秒" },
  message: { en: "A message was left", zh: "有留言" },
  callback: { en: "A callback number was left", zh: "留下回電號碼" },
  try: { en: "Test calls are free", zh: "試打不計費" },
  unknown_line: { en: "Number not in the number table", zh: "號碼不在號碼表" },
  non_customer_line: { en: "Demo or test number", zh: "示範或測試號碼" },
  channel_not_billable: { en: "Web calls are not billed", zh: "網頁通話不計費" },
  not_answered: { en: "Not answered by the system", zh: "系統沒有接起" },
  no_message_record: { en: "No message record", zh: "沒有留言紀錄" },
  processing_error: { en: "Processing failed", zh: "處理失敗" },
  notice_hangup: { en: "Hung up during the notice", zh: "告知語中掛斷" },
  no_speech: { en: "The caller did not speak", zh: "客人沒有說話" },
  short_speech: { en: "Less than 3 seconds of speech", zh: "說話不足 3 秒" },
  callback_unconfirmed: { en: "Callback number not confirmed", zh: "回電號碼沒有確認" },
};

/**
 * §11.2 "Handed off: {reason}". The contract names the field but gives no copy for its 5 values; these follow the
 * reasons' meaning in RC (requested by the caller, AI had no answer, a question the AI may not answer, urgent words,
 * a complaint).
 */
export const HANDOFF_REASON_LABELS: Record<HandoffReason, CallCopy> = {
  requested: { en: "the caller asked for a person", zh: "客人要求找真人" },
  no_answer: { en: "the AI had no answer", zh: "AI 答不出來" },
  no_ai_question: { en: "a question the AI is set not to answer", zh: "問到設定成不讓 AI 回答的題目" },
  urgent: { en: "urgent words were heard", zh: "聽到緊急字眼" },
  complaint: { en: "the caller complained", zh: "客人抱怨" },
};

/** A voice_calls.id (M14-M17 path): 32 lowercase hex. */
export const CALL_ROW_ID = /^[a-f0-9]{32}$/;
/** M13 `before` / `next`: the 10-digit started_at, "-", the id. */
export const CALL_CURSOR = /^\d{10}-[a-f0-9]{32}$/;

/** §1.5 `flagNoteChars`. M14 carries no `limits`, so one call's page uses this; M13's `limits` wins on the list. */
export const FLAG_NOTE_CHARS_DEFAULT = 100;

/**
 * §6.3 phone-number check, the same pattern as the backend's voice_calls.PHONE_LIKE: 8 or more digits (ASCII or
 * full-width) that may be split by spaces or "-". The whitespace class is Python's str.isspace() set written out,
 * because JavaScript's \s differs (it has U+FEFF, Python has U+001C-U+001F and U+0085).
 */
const PY_SPACE = "\\t\\n\\v\\f\\r\\u001c-\\u001f \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export const PHONE_LIKE = new RegExp(`[0-9０-９][0-9０-９${PY_SPACE}-]{6,}[0-9０-９]`);
export const hasPhoneNumber = (text: string) => PHONE_LIKE.test(text);

/** The Taiwan host's error codes a page can get back (§8.3). */
export const MEDIA_ERRORS = [
  "media_token_invalid",
  "media_token_expired",
  "media_forbidden",
  "media_expired",
  "media_not_ready",
  "media_not_found",
] as const;
export type MediaError = (typeof MEDIA_ERRORS)[number];

/** §8.3 transcript answer (the minimum shape; the Taiwan host may add fields). */
export type MediaTranscript = { call_id: string; segments: { speaker: "caller" | "ai" | "system"; start_ms: number; text: string }[] };
/** §8.3 summary answer; the callback number and the message text exist only here, never in portal. */
export type MediaSummary = {
  call_id: string;
  summary: string;
  callback_number: string | null;
  message_text: string | null;
  urgent: boolean;
};

// ---------------------------------------------------------------- Taipei time and display text (§11)

/** Taipei is fixed UTC+8 (phase 1 contract §10 item 15); no time-zone database is needed. */
const TAIPEI_MS = 8 * 3600 * 1000;
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (month: number) => MONTHS_EN[month - 1].slice(0, 3);

export type TaipeiParts = { year: number; month: number; day: number; hour: string; minute: string; second: string };

/** The Taipei wall-clock parts of an ISO time; null when it does not parse. */
export function taipeiParts(value: string | null | undefined): TaipeiParts | null {
  if (!value) return null;
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) return null;
  const local = new Date(epoch + TAIPEI_MS);
  const two = (n: number) => String(n).padStart(2, "0");
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: two(local.getUTCHours()),
    minute: two(local.getUTCMinutes()),
    second: two(local.getUTCSeconds()),
  };
}

/** The Taipei month (YYYY-MM) of an epoch in milliseconds: M13's `month`. */
export function taipeiMonth(epochMs: number): string {
  const local = new Date(epochMs + TAIPEI_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** YYYY-MM moved by whole months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** §11.1 "{YYYY} 年 {M} 月" / "{Month} {YYYY}". */
export function monthLabel(month: string, zh: boolean): string {
  const [year, number] = month.split("-").map(Number);
  return zh ? `${year} 年 ${number} 月` : `${MONTHS_EN[number - 1]} ${year}`;
}

/** A Taipei date and time; the list leaves the year out (the month is the filter). "—" when it does not parse. */
export function callTime(value: string | null, zh: boolean, withYear = true): string {
  const parts = taipeiParts(value);
  if (!parts) return "—";
  const time = `${parts.hour}:${parts.minute}`;
  if (zh) return `${withYear ? `${parts.year} 年 ` : ""}${parts.month} 月 ${parts.day} 日 ${time}`;
  return `${short(parts.month)} ${parts.day}${withYear ? `, ${parts.year}` : ""}, ${time}`;
}

/** A Taipei calendar date ("until" dates, §11.2). */
export function dateText(value: string | null, zh: boolean): string {
  const parts = taipeiParts(value);
  if (!parts) return "—";
  return zh ? `${parts.year} 年 ${parts.month} 月 ${parts.day} 日` : `${short(parts.month)} ${parts.day}, ${parts.year}`;
}

/** §11.1 "{m} 分 {s} 秒" / "{m}m {s}s"; "—" when the hang-up time is unknown (null). */
export function durationText(seconds: number | null, zh: boolean): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return zh ? `${minutes} 分 ${rest} 秒` : `${minutes}m ${rest}s`;
}

/** §11.1 "Caller": a test call, a web call, a hidden number, or the last 3 digits with the line type; "—" without them. */
export function callerText(call: Pick<CallItem, "entry" | "caller">, zh: boolean): string {
  const { tail, kind } = call.caller;
  if (call.entry === "try") return zh ? "試打" : "Test call";
  if (call.entry === "webrtc" || kind === "web") return zh ? "網頁通話" : "Web call";
  if (kind === "hidden") return zh ? "未顯示號碼" : "Number hidden";
  if (!tail) return "—";
  if (kind === "mobile") return zh ? `尾碼 ${tail}（手機）` : `Ends in ${tail} (mobile)`;
  if (kind === "landline") return zh ? `尾碼 ${tail}（市話）` : `Ends in ${tail} (landline)`;
  return zh ? `尾碼 ${tail}` : `Ends in ${tail}`;
}
