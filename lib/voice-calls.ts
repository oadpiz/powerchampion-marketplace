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
