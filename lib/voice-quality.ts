/**
 * Phone agent quality checks (phase 2, P2-6): the enums and API shapes of the "Quality" tab on /admin/voice.
 * Shapes follow phase2-contract.md §7 (A9-A16) and the backend's JSON (server/voice_calls.py quality_item,
 * quality_detail, review_json, listening_json); the backend is authoritative. Shared call enums live in
 * lib/voice-calls.ts.
 *
 * Each enum is written as `export const NAME = [...] as const;` on purpose: server/test_voice_calls_sync.py reads
 * this file and fails when a list differs from the backend's (LESSONS 2026-10-21).
 */
import type {
  CallContent,
  CallEntry,
  CallOutcome,
  HandoffReason,
  MeterReason,
  FlagKind,
} from "./voice-calls";

/** The 5 flags the orchestrator reports, then the 5 the portal adds (voice_calls.auto_flags). */
export const AUTO_FLAGS = [
  "no_answer",
  "low_confidence",
  "impatient",
  "talk_over",
  "no_response",
  "degraded",
  "unknown_number",
  "config_mismatch",
  "source_mismatch",
  "retention_mismatch",
] as const;
/** Why a call fell back to taking a message; `edge_fallback` is set by the portal, the rest are reported. */
export const DEGRADE_REASONS = ["llm", "tts", "asr", "orchestrator", "link", "config", "edge_fallback"] as const;
/** A11 labels (at most `limits.reviewLabelsMax`, no repeats). */
export const REVIEW_LABELS = [
  "wrong_answer",
  "made_up",
  "missed_handoff",
  "over_refusal",
  "number_readback",
  "talk_over",
  "slow",
  "unnatural_voice",
  "disclosure_missing",
  "other",
] as const;
export const REVIEW_STATUSES = ["open", "done"] as const;
/** A14 blind listening log kinds. */
export const LISTENING_KINDS = ["tts_voice", "call_sample", "prompt_audio", "other"] as const;
/** A9 `flag` filter; `any` (store or auto flag) is the default. */
export const QUALITY_FLAG_FILTERS = ["any", "store", "auto", "none", "all"] as const;
/** A9 `reviewed` filter; `0` (no review, or still open) is the default. */
export const QUALITY_REVIEWED_FILTERS = ["0", "1", "all"] as const;
/** A10 `mismatch`: fields where the orchestrator's and the records host's reports disagree. */
export const MISMATCH_FIELDS = ["started_at", "entry", "dialed", "caller_tail", "caller_kind", "ended_at", "ai_answered", "ai_speech_ms"] as const;
/** A10 `metrics` keys, as the orchestrator reports them (snake_case; a value may be null). */
export const METRIC_KEYS = ["reply_p50_ms", "reply_p95_ms", "barge_ins", "fillers", "talk_overs", "no_responses"] as const;
/** A10 `message.outcome`. */
export const MESSAGE_OUTCOMES = ["none", "message", "callback_only", "no_speech", "notice_hangup", "error"] as const;
export const CALLBACK_VIA = ["dtmf", "speech"] as const;

export type AutoFlag = (typeof AUTO_FLAGS)[number];
export type DegradeReason = (typeof DEGRADE_REASONS)[number];
export type ReviewLabel = (typeof REVIEW_LABELS)[number];
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ListeningKind = (typeof LISTENING_KINDS)[number];
export type QualityFlagFilter = (typeof QUALITY_FLAG_FILTERS)[number];
export type QualityReviewedFilter = (typeof QUALITY_REVIEWED_FILTERS)[number];
export type MismatchField = (typeof MISMATCH_FIELDS)[number];
export type MetricKey = (typeof METRIC_KEYS)[number];
export type MessageOutcome = (typeof MESSAGE_OUTCOMES)[number];
export type CallbackVia = (typeof CALLBACK_VIA)[number];

/** An operator's review (A9 item, A10, A11). The backend also returns `note` here. */
export type CallReview = {
  score: number;
  labels: ReviewLabel[];
  status: ReviewStatus;
  note: string;
  reviewer: { id: string; email: string };
  updatedAt: string;
};

/** QualityItem (§7.1). `store` is null when the dialed number is not in the number table. */
export type QualityItem = {
  id: string;
  callId: string;
  store: { id: string; name: string } | null;
  startedAt: string;
  durationSeconds: number | null;
  entry: CallEntry;
  dialed: string;
  /** The number table's purpose (VOICE_PURPOSES in components/admin-voice-dialogs.tsx); null when not in the table. */
  numberPurpose: string | null;
  outcome: CallOutcome;
  degraded: boolean;
  degradeReason: DegradeReason | null;
  handoff: boolean;
  handoffReason: HandoffReason | null;
  urgent: boolean;
  autoFlags: AutoFlag[];
  storeFlag: { kind: FlagKind; note: string; flaggedAt: string } | null;
  review: CallReview | null;
  meterUnits: 0 | 1;
  meterReason: MeterReason;
};

/** A9 `limits`; read them from the response, never hard-code them. */
export type QualityLimits = { callsPageSize: number; reviewNoteChars: number; reviewLabelsMax: number; listeningMax: number };

/** A9 GET /admin/voice/quality/calls. `counts` ignore paging and filters. */
export type QualityList = {
  calls: QualityItem[];
  next: string | null;
  counts: { storeFlaggedOpen: number; autoFlaggedOpen: number };
  limits: QualityLimits;
};

/** A9 filters as the BFF forwards them (app/api/portal/[...path]/route.ts checks each one). */
export type QualityListQuery = {
  store?: string;
  flag?: QualityFlagFilter;
  reviewed?: QualityReviewedFilter;
  month?: string;
  outcome?: CallOutcome;
  entry?: CallEntry;
  before?: string;
};

type ReportSource = { receivedAt: string; sha256: string } | null;

/** A10 GET /admin/voice/quality/calls/{id}. Never carries either report's text. */
export type QualityDetail = {
  call: QualityItem & {
    answeredAt: string | null;
    endedAt: string | null;
    configVersion: number | null;
    configSha256: string | null;
    disclosureVersion: string | null;
    turns: number;
    aiAnswered: boolean;
    aiSpeechSeconds: number;
    callSpeechSeconds: number;
    metrics: Partial<Record<MetricKey, number | null>>;
    message: {
      outcome: MessageOutcome;
      final: boolean;
      speechSeconds: number;
      recordingSeconds: number;
      callbackConfirmed: boolean;
      callbackVia: CallbackVia | null;
      recordingSaved: boolean;
      recordingDeclined: boolean;
    };
    mismatch: MismatchField[];
    retention: {
      snapshotDays: number;
      reportedDays: number | null;
      transcriptUntil: string;
      recordingUntil: string;
      detailUntil: string;
    };
    meterRule: string;
  };
  content: CallContent;
  sources: { orchestrator: ReportSource; records: ReportSource };
};

/** A11 body. `note` is multi-line, at most `limits.reviewNoteChars`, and must not hold a phone number. */
export type CallReviewInput = { score: number; labels?: ReviewLabel[]; note?: string; status: ReviewStatus };
/** A11 answer. */
export type CallReviewResult = { changed: boolean; review: CallReview };

/** ListeningLog (§7.5). `passed` null means "recorded only". */
export type ListeningLog = {
  id: string;
  title: string;
  kind: ListeningKind;
  heldOn: string;
  sampleCount: number;
  raterCount: number;
  passed: boolean | null;
  summary: string;
  reportRef: string;
  createdBy: { id: string; email: string };
  createdAt: string;
  updatedAt: string;
};

/** A14 and A15 body: every writable field, `summary` and `reportRef` may be "". */
export type ListeningInput = Pick<ListeningLog, "title" | "kind" | "heldOn" | "sampleCount" | "raterCount" | "passed" | "summary" | "reportRef">;
/** A13 answer, newest first, at most `limits.listeningMax`. */
export type ListeningList = { logs: ListeningLog[] };
