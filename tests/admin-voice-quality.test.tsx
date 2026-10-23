import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPortal } from "../components/admin-portal";
import {
  AUTO_FLAG_LABEL,
  DEGRADE_LABEL,
  DELETION_REASON_LABEL,
  DELETION_STATUS_LABEL,
  ENTRY_LABEL,
  HANDOFF_LABEL,
  LISTENING_KIND_LABEL,
  MESSAGE_OUTCOME_LABEL,
  METER_REASON_LABEL,
  OUTCOME_LABEL,
  REVIEW_LABEL_COPY,
  qualityErrorText,
} from "../components/admin-voice-quality-labels";
import { PortalError } from "../lib/portal-client";
import { ENTRIES, HANDOFF_REASONS, METER_REASONS, OUTCOMES, callTime, hasPhoneNumber } from "../lib/voice-calls";
import {
  AUTO_FLAGS,
  DEGRADE_REASONS,
  DELETION_REASONS,
  DELETION_STATUSES,
  LISTENING_FIELD_LIMITS,
  LISTENING_KINDS,
  MESSAGE_OUTCOMES,
  REVIEW_LABELS,
  csvCell,
  toCsv,
} from "../lib/voice-quality";
import { wrap } from "./support/admin-fetch";

/*
 * P2-6, the "Quality" tab on /admin/voice (phase2-contract §7, §10.1, §11.3, §12). The backend below answers like the
 * contract and server/voice_call_routes.py: the BFF allowlist and A9 filter checks in front (§10.1), the A11 and
 * A14/A15 field rules with the same error codes (score 1-5, at most 6 distinct labels, notes of at most 500/1000
 * characters, no phone number, 500 entries), and A12 with its own refusals. Enum values are written out from the
 * contract here on purpose (not imported from the component), so a drift in the page fails these tests.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const CONTRACT = {
  outcomes: ["answered", "message", "handoff", "degraded", "not_answered", "hangup_early", "no_speech", "error", "unknown"],
  entries: ["pstn", "webrtc", "softphone", "try"],
  reviewLabels: ["wrong_answer", "made_up", "missed_handoff", "over_refusal", "number_readback", "talk_over", "slow", "unnatural_voice", "disclosure_missing", "other"],
  listeningKinds: ["tts_voice", "call_sample", "prompt_audio", "other"],
};
const AGENT = "[a-f0-9]{32}";
// §10.1, written out.
const BFF: Record<string, RegExp[]> = {
  GET: [/^\/session$/, /^\/admin\/voice\/(stores|numbers)$/, /^\/admin\/voice\/quality\/(calls|listening)$/, new RegExp(`^/admin/voice/quality/calls/${AGENT}$`)],
  POST: [new RegExp(`^/admin/voice/quality/calls/${AGENT}/(review|content-link)$`), /^\/admin\/voice\/quality\/listening$/, new RegExp(`^/admin/voice/quality/listening/${AGENT}$`)],
  DELETE: [new RegExp(`^/admin/voice/quality/listening/${AGENT}$`)],
};
const A9_FILTERS: [string, RegExp][] = [
  ["month", /^\d{4}-(0[1-9]|1[0-2])$/],
  ["outcome", /^(answered|message|handoff|degraded|not_answered|hangup_early|no_speech|error|unknown)$/],
  ["before", /^\d{10}-[a-f0-9]{32}$/],
  ["store", /^[a-f0-9]{32}$/],
  ["flag", /^(any|store|auto|none|all)$/],
  ["reviewed", /^(0|1|all)$/],
  ["entry", /^(pstn|webrtc|softphone|try)$/],
  ["ref", /^[a-f0-9]{8}$/],
];
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
// eslint-disable-next-line no-control-regex
const UNSAFE_LINE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\u061c]/;
const MEDIA = "https://media.test";

const hex = (n: number) => n.toString(16).padStart(32, "0");
const ID = { clinic: "a".repeat(32), formula: "b".repeat(32) };
const ADMIN = { id: hex(7), email: "ops@powerchampion.example", name: "Ops", role: "admin" };
const fail = (status: number, error: string, detail = "The request was rejected.") => Response.json({ error, detail }, { status });
const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);
/** The page's Taipei time format: the store pages' 24-hour one, with the year (en); the tests also check the +8 hours. */
const taipei = (iso: string) => callTime(iso, false);
const T1 = taipei("2026-10-21T01:15:02Z");
const taipeiMonth = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 7);

type Review = { score: number; labels: string[]; status: string; note: string; reviewer: { id: string; email: string }; updatedAt: string };
type MockCall = {
  id: string;
  callId: string;
  store: { id: string; name: string } | null;
  startedAt: string;
  durationSeconds: number | null;
  entry: string;
  dialed: string | null;
  numberPurpose: string | null;
  outcome: string;
  degraded: boolean;
  degradeReason: string | null;
  handoff: boolean;
  handoffReason: string | null;
  urgent: boolean;
  autoFlags: string[];
  storeFlag: { kind: string; note: string; flaggedAt: string } | null;
  review: Review | null;
  meterUnits: number;
  meterReason: string;
  // A10 only
  answeredAt: string | null;
  endedAt: string | null;
  configVersion: number | null;
  configSha256: string | null;
  disclosureVersion: string | null;
  turns: number;
  aiAnswered: boolean;
  aiSpeechSeconds: number;
  callSpeechSeconds: number;
  metrics: Record<string, number | null>;
  message: Record<string, unknown>;
  mismatch: string[];
  retention: { snapshotDays: number; reportedDays: number | null; transcriptUntil: string; recordingUntil: string; detailUntil: string };
  meterRule: string;
  content: { expected: boolean; hasRecording: boolean; transcriptUntil: string | null; recordingUntil: string | null; state: string; linkAvailable: boolean };
  sources: { orchestrator: { receivedAt: string; sha256: string } | null; records: { receivedAt: string; sha256: string } | null };
  // §16: the store's deletion (A9 item and A10), the Taiwan host's confirmation and the requests (A10 only).
  storeDeletedAt: string | null;
  contentPurgedAt: string | null;
  deletions: { id: string; reason: string; kinds: string[]; status: string; requestedAt: string; doneAt: string | null; filesDeleted: number | null; rowsDeleted: number | null }[];
  /** What the Taiwan host has for this call. */
  media: { transcript?: unknown; summary?: unknown; recording?: boolean };
};
const ITEM_KEYS = ["id", "callId", "store", "startedAt", "durationSeconds", "entry", "dialed", "numberPurpose", "outcome", "degraded", "degradeReason",
  "handoff", "handoffReason", "urgent", "autoFlags", "storeFlag", "review", "meterUnits", "meterReason", "storeDeletedAt"] as const;

function mockCall(n: number, overrides: Partial<MockCall>): MockCall {
  const startedAt = overrides.startedAt ?? "2026-10-21T01:15:02Z";
  return {
    id: hex(1000 + n),
    callId: `1797815702.${100 + n}`,
    store: { id: ID.clinic, name: "晴光牙醫診所" },
    startedAt,
    durationSeconds: 159,
    entry: "pstn",
    dialed: "+886227001001",
    numberPurpose: "customer",
    outcome: "answered",
    degraded: false,
    degradeReason: null,
    handoff: false,
    handoffReason: null,
    urgent: false,
    autoFlags: [],
    storeFlag: null,
    review: null,
    meterUnits: 1,
    meterReason: "ai_speech",
    answeredAt: startedAt,
    endedAt: "2026-10-21T01:17:41Z",
    configVersion: 3,
    configSha256: "0123abcd" + "9".repeat(56),
    disclosureVersion: "d1",
    turns: 6,
    aiAnswered: true,
    aiSpeechSeconds: 12.3,
    callSpeechSeconds: 12.3,
    metrics: { reply_p50_ms: 820, reply_p95_ms: 1430, barge_ins: 1, fillers: 2, talk_overs: 0, no_responses: null },
    // recordingSaved is what content.hasRecording reports (the backend derives both from recording_saved).
    message: { outcome: "none", final: true, speechSeconds: 0, recordingSeconds: 0, callbackConfirmed: false, callbackVia: null, recordingSaved: true, recordingDeclined: false },
    mismatch: [],
    retention: { snapshotDays: 30, reportedDays: null, transcriptUntil: "2027-01-19T01:15:02Z", recordingUntil: "2026-11-20T01:15:02Z", detailUntil: "2027-11-25T01:15:02Z" },
    meterRule: "q5-draft-1",
    content: { expected: true, hasRecording: true, transcriptUntil: "2027-01-19T01:15:02Z", recordingUntil: "2026-11-20T01:15:02Z", state: "available", linkAvailable: true },
    sources: { orchestrator: { receivedAt: "2026-10-21T01:17:45Z", sha256: "f".repeat(64) }, records: null },
    storeDeletedAt: null,
    contentPurgedAt: null,
    deletions: [],
    media: {
      transcript: { call_id: "x", segments: [{ speaker: "caller", start_ms: 0, text: "洗牙多少錢？" }, { speaker: "ai", start_ms: 2100, text: "洗牙是 800 元。" }] },
      summary: { call_id: "x", summary: "問洗牙價格", callback_number: null, message_text: null, urgent: false },
      recording: true,
    },
    ...overrides,
  };
}

const RECENT = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
/** Five calls: the default view (flagged, not reviewed) shows c1, c2, c3 and c5; c4 is reviewed and unflagged. */
const seedCalls = (): MockCall[] => [
  mockCall(1, { startedAt: "2026-10-21T01:15:02Z", storeFlag: { kind: "wrong_answer", note: "價格答錯", flaggedAt: "2026-10-21T02:00:00Z" } }),
  mockCall(2, {
    startedAt: "2026-10-20T03:00:00Z",
    store: { id: ID.formula, name: '=HYPERLINK("http://x")' },
    outcome: "message",
    autoFlags: ["low_confidence", "talk_over"],
    review: { score: 2, labels: ["slow"], status: "open", note: "再聽一次", reviewer: { id: ADMIN.id, email: ADMIN.email }, updatedAt: "2026-10-20T04:00:00Z" },
    meterReason: "message",
  }),
  mockCall(3, {
    startedAt: "2026-10-19T03:00:00Z",
    store: null,
    dialed: "-5551234",
    numberPurpose: null,
    autoFlags: ["unknown_number"],
    meterUnits: 0,
    meterReason: "unknown_line",
    content: { expected: false, hasRecording: false, transcriptUntil: null, recordingUntil: null, state: "none", linkAvailable: true },
  }),
  mockCall(4, {
    startedAt: "2026-10-18T03:00:00Z",
    review: { score: 5, labels: [], status: "done", note: "", reviewer: { id: ADMIN.id, email: ADMIN.email }, updatedAt: "2026-10-18T04:00:00Z" },
  }),
  mockCall(5, {
    startedAt: RECENT,
    entry: "try",
    dialed: null,
    numberPurpose: null,
    outcome: "degraded",
    degraded: true,
    degradeReason: "tts",
    autoFlags: ["degraded"],
    meterUnits: 0,
    meterReason: "try",
  }),
];

const seedStores = () => [
  { id: ID.clinic, name: "晴光牙醫診所", industry: "clinic", status: "testing", owner: { id: hex(1), email: "owner@clinic.example", name: "林" }, currentVersion: 3, faqCount: 0, kbChars: 0, lastTryAt: null, aiAnswerEnabled: true, recordingMode: "full", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
  { id: ID.formula, name: '=HYPERLINK("http://x")', industry: "other", status: "draft", owner: { id: hex(2), email: "f@x.example", name: "F" }, currentVersion: null, faqCount: 0, kbChars: 0, lastTryAt: null, aiAnswerEnabled: false, recordingMode: "off", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
];

type Log = { id: string; title: string; kind: string; heldOn: string; sampleCount: number; raterCount: number; passed: boolean | null; summary: string; reportRef: string; createdBy: { id: string; email: string }; createdAt: string; updatedAt: string };
const mockLog = (n: number, overrides: Partial<Log> = {}): Log => ({
  id: hex(5000 + n),
  title: `盲聽 ${n}`,
  kind: "tts_voice",
  heldOn: `2026-10-${String(10 + n).padStart(2, "0")}`,
  sampleCount: 40,
  raterCount: 5,
  passed: true,
  summary: "",
  reportRef: "",
  createdBy: { id: ADMIN.id, email: ADMIN.email },
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
  ...overrides,
});

type Recorded = { method: string; path: string; body: unknown };
type MediaBehaviour = "ok" | "not_ready" | "expire_once" | "expire_always" | "network" | "wrong_shape";

class QualityBackend {
  calls = seedCalls();
  logs: Log[] = [mockLog(1, { reportRef: "javascript:alert(1)", summary: "MOS 4.1\n第二行" }), mockLog(2, { kind: "call_sample", passed: null })];
  stores = seedStores();
  enabled = true;
  pageSize = 100;
  mediaAvailable = true;
  linksUsed = 0;
  linkLimit = 60;
  media: MediaBehaviour = "ok";
  requests: Recorded[] = [];
  mediaRequests: { url: string; auth: string | null; credentials: RequestCredentials | undefined; redirect: RequestRedirect | undefined }[] = [];
  /** Replaces an A12 answer's urls (e.g. a plain-http host the page must refuse to send the token to). */
  linkUrls?: (urls: Record<string, string>) => Record<string, string>;
  serial = 0;
  tokens: string[] = [];
  private expiredOnce = new Set<string>();

  install() {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => this.handle(String(input), init)));
    return this;
  }

  private item(call: MockCall) {
    return Object.fromEntries(ITEM_KEYS.map((key) => [key, call[key]]));
  }

  private open(call: MockCall) {
    return call.review === null || call.review.status === "open";
  }

  private async handle(url: string, init?: RequestInit): Promise<Response> {
    if (url.startsWith(MEDIA)) return this.mediaRoute(url, init);
    const method = init?.method ?? "GET";
    const full = url.replace("/api/portal", "");
    const [path, search = ""] = full.split("?");
    let body: unknown = undefined;
    if (init?.body) body = JSON.parse(String(init.body));
    this.requests.push({ method, path: full, body });
    if (!(BFF[method] ?? []).some((pattern) => pattern.test(path))) return fail(404, "not_found", "This portal endpoint is not available for this request.");
    if (path === "/session") return Response.json({ user: ADMIN });
    if (!this.enabled) return fail(404, "not_found", "Not Found");
    if (method === "POST" && (new Headers(init?.headers).get("Content-Type") !== "application/json" || typeof body !== "object" || body === null || Array.isArray(body)))
      return fail(400, "invalid_input", "Send a JSON object.");
    return this.route(method, path, new URLSearchParams(search), (body ?? {}) as Record<string, unknown>);
  }

  private route(method: string, path: string, query: URLSearchParams, body: Record<string, unknown>): Response {
    if (path === "/admin/voice/stores") return Response.json({ stores: this.stores });
    if (method === "GET" && path === "/admin/voice/quality/calls") return this.list(query);
    let match = path.match(/^\/admin\/voice\/quality\/calls\/([a-f0-9]{32})(?:\/(review|content-link))?$/);
    if (match) {
      const call = this.calls.find((item) => item.id === match![1]);
      if (!call) return fail(404, "call_not_found", "This call does not exist.");
      if (!match[2]) {
        const { content, sources, deletions, media: _media, ...rest } = call;
        void _media;
        return Response.json({ call: rest, content, sources, deletions });
      }
      return match[2] === "review" ? this.review(call, body) : this.contentLink(call);
    }
    if (path === "/admin/voice/quality/listening") {
      if (method === "GET") return Response.json({ logs: [...this.logs].sort((a, b) => b.heldOn.localeCompare(a.heldOn) || b.createdAt.localeCompare(a.createdAt)) });
      const fields = this.listeningFields(body);
      if (fields instanceof Response) return fields;
      if (this.logs.length >= 500) return fail(409, "listening_limit", "Up to 500 entries. Delete old ones first.");
      const stamp = new Date(Date.UTC(2026, 9, 22, 0, 0, this.serial++)).toISOString().replace(".000Z", "Z");
      const log: Log = { ...fields, id: hex(9000 + this.serial), createdBy: { id: ADMIN.id, email: ADMIN.email }, createdAt: stamp, updatedAt: stamp };
      this.logs.push(log);
      return Response.json({ log }, { status: 201 });
    }
    match = path.match(/^\/admin\/voice\/quality\/listening\/([a-f0-9]{32})$/);
    if (match) {
      const log = this.logs.find((item) => item.id === match![1]);
      if (!log) return fail(404, "listening_not_found", "This entry no longer exists. Reload the page.");
      if (method === "DELETE") {
        this.logs = this.logs.filter((item) => item !== log);
        return Response.json({ ok: true });
      }
      const fields = this.listeningFields(body);
      if (fields instanceof Response) return fields;
      const same = (Object.keys(fields) as (keyof typeof fields)[]).every((key) => log[key] === fields[key]);
      if (same) return Response.json({ changed: false, log });
      Object.assign(log, fields, { updatedAt: "2026-10-22T09:00:00Z" });
      return Response.json({ changed: true, log });
    }
    return fail(404, "not_found", "Not Found");
  }

  private list(query: URLSearchParams): Response {
    const params: Record<string, string> = {};
    // The BFF (§10.1): each listed filter must match; anything else is dropped.
    for (const [name, pattern] of A9_FILTERS) {
      const value = query.get(name);
      if (value === null) continue;
      if (!pattern.test(value)) return fail(400, "invalid_input", `Choose a valid ${name} filter.`);
      params[name] = value;
    }
    // Like A9: a `ref` lookup does not hide calls behind the default "flagged, to review" filters.
    const flag = params.flag ?? (params.ref ? "all" : "any");
    const reviewed = params.reviewed ?? (params.ref ? "all" : "0");
    let rows = this.calls.filter((call) => {
      const store = call.storeFlag !== null;
      const auto = call.autoFlags.length > 0;
      if (params.ref && !call.id.startsWith(params.ref)) return false;
      if (params.store && call.store?.id !== params.store) return false;
      if (flag === "any" && !(store || auto)) return false;
      if (flag === "store" && !store) return false;
      if (flag === "auto" && !auto) return false;
      if (flag === "none" && (store || auto)) return false;
      if (reviewed === "0" && !this.open(call)) return false;
      if (reviewed === "1" && call.review?.status !== "done") return false;
      if (params.month && taipeiMonth(call.startedAt) !== params.month) return false;
      if (params.outcome && call.outcome !== params.outcome) return false;
      if (params.entry && call.entry !== params.entry) return false;
      return true;
    });
    rows.sort((a, b) => epoch(b.startedAt) - epoch(a.startedAt) || b.id.localeCompare(a.id));
    if (params.before) {
      const [at, id] = params.before.split("-");
      rows = rows.filter((call) => epoch(call.startedAt) < Number(at) || (epoch(call.startedAt) === Number(at) && call.id < id));
    }
    const page = rows.slice(0, this.pageSize);
    const last = page[page.length - 1];
    const next = rows.length > this.pageSize && last ? `${epoch(last.startedAt)}-${last.id}` : null;
    const openCalls = this.calls.filter((call) => this.open(call));
    return Response.json({
      calls: page.map((call) => this.item(call)),
      next,
      counts: { storeFlaggedOpen: openCalls.filter((call) => call.storeFlag).length, autoFlaggedOpen: openCalls.filter((call) => call.autoFlags.length).length },
      limits: { callsPageSize: this.pageSize, reviewNoteChars: 500, reviewLabelsMax: 6, listeningMax: 500 },
    });
  }

  /** A11 after call_not_found: fields (400), then the upsert; nothing changed is changed: false. */
  private review(call: MockCall, body: Record<string, unknown>): Response {
    const { score, labels = [], note = "", status } = body;
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) return fail(400, "invalid_input", "Choose a score from 1 to 5.");
    if (!Array.isArray(labels) || labels.length > 6 || new Set(labels).size !== labels.length || !labels.every((label) => CONTRACT.reviewLabels.includes(label as string)))
      return fail(400, "invalid_input", "Choose up to 6 different labels.");
    if (typeof note !== "string" || [...note.replace(/[\n\r\t]/g, "")].some((char) => UNSAFE.test(char))) return fail(400, "invalid_input", "Enter a valid note.");
    if ([...note.trim()].length > 500) return fail(400, "invalid_input", "The note can be up to 500 characters.");
    if (hasPhoneNumber(note)) return fail(400, "note_contains_number", "Do not put phone numbers in the note.");
    if (status !== "open" && status !== "done") return fail(400, "invalid_input", "Choose the status: open or done.");
    const ordered = CONTRACT.reviewLabels.filter((label) => (labels as string[]).includes(label));
    const next = { score, labels: ordered, note: note.trim(), status };
    const current = call.review;
    const changed = !current || current.score !== next.score || current.labels.join() !== next.labels.join() || current.note !== next.note || current.status !== next.status;
    if (changed) call.review = { ...next, reviewer: { id: ADMIN.id, email: ADMIN.email }, updatedAt: "2026-10-22T05:00:00Z" };
    return Response.json({ changed, review: call.review });
  }

  /** A12 after call_not_found: 503 (as the BFF shows it) -> 410 deleted -> 404 unavailable -> 410 expired -> 429 -> sign. */
  private contentLink(call: MockCall): Response {
    if (!this.mediaAvailable) return fail(503, "service_unavailable", "This service is unavailable or has not been configured yet. Please try again later.");
    if (call.storeDeletedAt) return fail(410, "call_content_deleted", "The store deleted this call's recording and text.");
    if (!call.content.expected) return fail(404, "call_content_unavailable", "No content was kept for this call.");
    if (call.content.state === "expired") return fail(410, "call_content_expired", "The content is past its retention period and can no longer be viewed.");
    if (this.linksUsed >= this.linkLimit) return fail(429, "voice_content_link_limit", "Too many views. Try again in an hour.");
    this.linksUsed += 1;
    const token = `eyJtest.sig${this.linksUsed}`;
    this.tokens.push(token);
    const kinds = [...(call.media.recording && call.content.hasRecording ? ["recording"] : []), "summary", "transcript"];
    const signed = Object.fromEntries(kinds.map((kind) => [kind, `${MEDIA}/v1/calls/${encodeURIComponent(call.callId)}/${kind}`]));
    const urls = this.linkUrls ? this.linkUrls(signed) : signed;
    return Response.json({ media: { token, expiresAt: new Date(Date.now() + 300_000).toISOString(), kinds, urls } });
  }

  private mediaRoute(url: string, init?: RequestInit): Response {
    const auth = new Headers(init?.headers).get("Authorization");
    this.mediaRequests.push({ url, auth, credentials: init?.credentials, redirect: init?.redirect });
    if (this.media === "network") throw new TypeError("Failed to fetch");
    const token = auth?.replace(/^Bearer /, "") ?? "";
    if (!this.tokens.includes(token)) return Response.json({ error: "media_token_invalid" }, { status: 401 });
    if (this.media === "not_ready") return Response.json({ error: "media_not_ready" }, { status: 404 });
    if (this.media === "expire_always" || (this.media === "expire_once" && !this.expiredOnce.has(url))) {
      this.expiredOnce.add(url);
      return Response.json({ error: "media_token_expired" }, { status: 401 });
    }
    const [, callId, kind] = url.match(/\/v1\/calls\/([^/]+)\/(\w+)$/) ?? [];
    const call = this.calls.find((item) => encodeURIComponent(item.callId) === callId);
    if (!call) return Response.json({ error: "media_not_found" }, { status: 404 });
    // "wrong_shape": an HTML page instead of audio, and JSON that is not the §8.3 transcript or summary.
    if (kind === "recording")
      return new Response("RIFF-test-audio", { headers: { "Content-Type": this.media === "wrong_shape" ? "text/html" : "audio/wav" } });
    if (this.media === "wrong_shape") return Response.json({ call_id: call.callId, html: "<b>x</b>" });
    return Response.json(kind === "transcript" ? call.media.transcript : call.media.summary);
  }

  private listeningFields(body: Record<string, unknown>) {
    const { title, kind, heldOn, sampleCount, raterCount, passed, summary, reportRef } = body;
    const int = (value: unknown, high: number) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= high;
    if (typeof title !== "string" || UNSAFE_LINE.test(title) || !title.trim() || [...title.trim()].length > 60) return fail(400, "invalid_input", "Enter a title.");
    if (typeof kind !== "string" || !CONTRACT.listeningKinds.includes(kind)) return fail(400, "invalid_input", "Choose the kind.");
    if (typeof heldOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(heldOn) || heldOn < "2000-01-01" || heldOn > "2037-12-31") return fail(400, "invalid_input", "Enter heldOn as a date (YYYY-MM-DD).");
    if (!int(sampleCount, 10000)) return fail(400, "invalid_input", "Enter sampleCount from 1 to 10000.");
    if (!int(raterCount, 50)) return fail(400, "invalid_input", "Enter raterCount from 1 to 50.");
    if (passed !== null && typeof passed !== "boolean") return fail(400, "invalid_input", "Send passed as true, false or null.");
    if (typeof summary !== "string" || [...summary.replace(/[\n\r\t]/g, "")].some((char) => UNSAFE.test(char)) || [...summary.trim()].length > 1000)
      return fail(400, "invalid_input", "Enter a valid summary.");
    if (hasPhoneNumber(summary)) return fail(400, "note_contains_number", "Do not put phone numbers in the note.");
    if (typeof reportRef !== "string" || UNSAFE_LINE.test(reportRef) || [...reportRef.trim()].length > 200) return fail(400, "invalid_input", "Enter a valid report reference.");
    return { title: title.trim(), kind, heldOn, sampleCount: sampleCount as number, raterCount: raterCount as number, passed: passed as boolean | null, summary: summary.trim(), reportRef: reportRef.trim() };
  }
}

async function openQuality(backend: QualityBackend, user = userEvent.setup()) {
  backend.install();
  wrap(<AdminPortal section="voice" />);
  const tablist = await screen.findByRole("tablist");
  await user.click(within(tablist).getByRole("tab", { name: localStorage.getItem("pc-locale") === "zh" ? "品質" : "Quality" }));
  return user;
}
const callsTable = () => screen.findByRole("table", { name: localStorage.getItem("pc-locale") === "zh" ? "品質" : "Quality" });
const bodyRows = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
const cellTexts = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent);
const a9 = (backend: QualityBackend) => backend.requests.filter((request) => request.method === "GET" && request.path.startsWith("/admin/voice/quality/calls?")).map((request) => request.path);
const drawer = () => document.getElementById("voice-quality-drawer") as HTMLElement;
const countsText = () => document.querySelector("[data-voice-quality-counts]")?.textContent;

describe("admin phone agent: quality list (A9)", () => {
  it("lists flagged calls waiting for review with the §11.3 columns, counts and card labels", async () => {
    const backend = new QualityBackend();
    await openQuality(backend);
    const table = await callsTable();
    expect(a9(backend)).toEqual(["/admin/voice/quality/calls?flag=any&reviewed=0"]);
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Time", "Call ID", "Store", "Entry", "Result", "Flags", "Score", "Status", "Actions",
    ]);
    const rows = bodyRows(table);
    // Newest first; c4 (reviewed, unflagged) is not in the default view.
    expect(rows).toHaveLength(4);
    expect(T1).toBe("Oct 21, 2026, 09:15"); // 01:15 UTC is 09:15 in Taipei, 24-hour like the store pages
    expect(within(rows[1]).getByRole("rowheader").textContent).toBe(T1);
    // The call ID a store quotes (the id's first 8) is its own column (fix round).
    expect(cellTexts(rows[1])[0]).toBe(hex(1001).slice(0, 8));
    expect(cellTexts(rows[1]).slice(1)).toEqual(["晴光牙醫診所", "Phone line", "Answered", "Store: wrong answer", "—", "To review", "Open"]);
    expect(cellTexts(rows[2]).slice(1)).toEqual(['=HYPERLINK("http://x")', "Phone line", "Message", "Low confidence, Talked over", "2", "To review", "Open"]);
    expect(cellTexts(rows[3]).slice(1, 5)).toEqual(["(number not in table)", "Phone line", "Answered", "Unknown number"]);
    expect(cellTexts(rows[0]).slice(2, 5)).toEqual(["Test call", "Fallback", "Fallback"]);
    expect(countsText()).toBe("Store flags to review: 1 · Auto flags to review: 3");
    // 375 px: the card layout labels every cell but the button.
    expect(table).toHaveClass("voice-stack");
    expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.getAttribute("data-label"))).toEqual([
      "Call ID", "Store", "Entry", "Result", "Flags", "Score", "Status", null,
    ]);
    // Each row button names its call, so a screen reader's list of buttons tells them apart.
    const names = rows.map((row) => within(row).getByRole("button").getAttribute("aria-label"));
    expect(new Set(names).size).toBe(4);
    expect(names[1]).toBe(`Open call: 晴光牙醫診所 · ${T1}`);
  });

  it("sends each filter the BFF accepts and shows what the backend answers", async () => {
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    await callsTable();
    await user.selectOptions(screen.getByLabelText("Flags"), "all");
    await user.selectOptions(screen.getByLabelText("Review"), "1");
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Quality" })).map((row) => cellTexts(row)[5])).toEqual(["5"]));
    await user.selectOptions(screen.getByLabelText("Review"), "all");
    await user.selectOptions(screen.getByLabelText("Store"), ID.formula);
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Quality" }))).toHaveLength(1));
    await user.selectOptions(screen.getByLabelText("Store"), "");
    await user.selectOptions(screen.getByLabelText("Entry"), "try");
    await user.selectOptions(screen.getByLabelText("Result"), "degraded");
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Quality" }))).toHaveLength(1));
    // Months: all, then this Taipei month and the 12 before it.
    const month = screen.getByLabelText("Month") as HTMLSelectElement;
    expect(month.options).toHaveLength(14);
    const current = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
    expect(month.options[1].value).toBe(current);
    await user.selectOptions(month, current);
    await waitFor(() => expect(a9(backend).at(-1)).toBe(`/admin/voice/quality/calls?flag=all&reviewed=all&month=${current}&outcome=degraded&entry=try`));
    // The test call c5 started a minute ago, so it is in this month whatever the date.
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Quality" })).map((row) => cellTexts(row)[2])).toEqual(["Test call"]));
    await user.selectOptions(screen.getByLabelText("Result"), "no_speech");
    expect(await screen.findByText("No calls match these filters. Calls flagged by stores or by the system appear here.")).toBeVisible();
    const sent = a9(backend);
    expect(sent).toContain("/admin/voice/quality/calls?flag=all&reviewed=1");
    expect(sent).toContain(`/admin/voice/quality/calls?store=${ID.formula}&flag=all&reviewed=all`);
    expect(sent).toContain("/admin/voice/quality/calls?flag=all&reviewed=all&outcome=degraded&entry=try");
    expect(sent.at(-1)).toBe(`/admin/voice/quality/calls?flag=all&reviewed=all&month=${current}&outcome=no_speech&entry=try`);
    // Every request passed the BFF's checks (a value it refuses would have been a 400 on screen).
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("finds the call a store quotes by its call ID, whatever its flags and review (A9 ref)", async () => {
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    const table = await callsTable();
    // c4 (reviewed, not flagged) is hidden by the default filters; the store gives its call ID.
    const hidden = backend.calls[3];
    expect(bodyRows(table).map((row) => row.querySelector("button")?.id)).not.toContain(`voice-quality-open-${hidden.id}`);
    const box = screen.getByLabelText("Call ID");
    await user.type(box, "77A7");
    expect(screen.getByText("A call ID is 8 characters (0–9, a–f).")).toBeVisible();
    expect(a9(backend)).toHaveLength(1); // nothing sent for a partial ID
    await user.clear(box);
    await user.type(box, ` ${hidden.id.slice(0, 8).toUpperCase()} `);
    await waitFor(() => expect(a9(backend).at(-1)).toBe(`/admin/voice/quality/calls?ref=${hidden.id.slice(0, 8)}&flag=all&reviewed=all`));
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Quality" })).map((row) => row.querySelector("button")?.id)).toContain(`voice-quality-open-${hidden.id}`));
    expect((screen.getByLabelText("Flags") as HTMLSelectElement).value).toBe("all");
    expect((screen.getByLabelText("Review") as HTMLSelectElement).value).toBe("all");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Clearing it goes back to the default queue.
    await user.clear(box);
    await waitFor(() => expect(a9(backend).at(-1)).toBe("/admin/voice/quality/calls?flag=any&reviewed=0"));
  });

  it("loads the next page with the cursor and moves focus to the first new row", async () => {
    const backend = new QualityBackend();
    backend.pageSize = 3;
    const user = await openQuality(backend);
    const table = await callsTable();
    expect(bodyRows(table)).toHaveLength(3);
    const third = backend.calls.find((call) => call.id === hex(1002))!;
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Quality" }))).toHaveLength(4));
    expect(a9(backend).at(-1)).toBe(`/admin/voice/quality/calls?flag=any&reviewed=0&before=${epoch(third.startedAt)}-${third.id}`);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(`voice-quality-open-${hex(1003)}`)));
  });

  it("says the feature is off when A9 answers 404 not_found, and that the list failed on a 5xx", async () => {
    const backend = new QualityBackend().install();
    const inner = fetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    let answered = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("/admin/voice/quality/calls?")) return inner(input, init);
      answered += 1;
      return answered === 1 ? fail(404, "not_found", "Not Found") : fail(502, "service_unavailable", "down");
    }));
    void backend;
    const user = userEvent.setup();
    wrap(<AdminPortal section="voice" />);
    await user.click(within(await screen.findByRole("tablist")).getByRole("tab", { name: "Quality" }));
    expect(await screen.findByText("The phone agent feature is off (PC_VOICE_ENABLED is not 1).")).toBeVisible();
    const quality = screen.getByRole("region", { name: "Quality" });
    await user.click(within(quality).getAllByRole("button", { name: "Refresh" })[0]);
    expect(await within(quality).findByText("Calls could not be loaded. Reload the page.")).toBeVisible();
    expect(answered).toBe(2);
  });
});

describe("admin phone agent: quality export", () => {
  it("writes the loaded rows as CSV with a BOM, codes, Taipei times, no notes, and formula cells neutralised", async () => {
    const blobs: Blob[] = [];
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    await callsTable();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:x"; });
      static revokeObjectURL = vi.fn();
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(screen.getByText(/Exports the 4 calls loaded now/)).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Export CSV" })[0]);
    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("text/csv;charset=utf-8");
    // Blob.text() drops a leading BOM when it decodes, so the bytes are checked.
    expect([...new Uint8Array(await blobs[0].arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await blobs[0].text();
    const lines = text.trimEnd().split("\r\n");
    expect(lines).toHaveLength(5); // header + the 4 loaded rows, nothing that was not loaded
    expect(lines[0].split(",").slice(0, 5)).toEqual(["Time (Taipei)", "Record id", "Call ID", "Line call ID", "Store"]);
    expect(lines[2].split(",").slice(1, 4)).toEqual([hex(1001), hex(1001).slice(0, 8), "1797815702.101"]);
    expect(lines[2]).toContain("2026-10-21 09:15:02");
    expect(lines[2]).toContain(",'+886227001001,customer,pstn,159,answered,");
    // A store name and a raw dialed number that a spreadsheet would run as formulas are shown as text.
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).toContain(",'-5551234,");
    expect(lines[3]).toContain(",low_confidence|talk_over,");
    // Notes stay out of the file (they are purged after 90 days on the portal; a file would keep them).
    expect(text).not.toContain("價格答錯");
    expect(text).not.toContain("再聽一次");
  });

  it("neutralises formula cells like the A6 statements and quotes only when needed", () => {
    expect(["=1+1", "+886", "-2", "@SUM(A1)", "\tx", "0227001001", "a,b", 'say "hi"', "line\nbreak"].map(csvCell)).toEqual([
      "'=1+1", "'+886", "'-2", "'@SUM(A1)", "'\tx", "0227001001", '"a,b"', '"say ""hi"""', '"line\nbreak"',
    ]);
    expect([5, -1, 0, null, undefined, true].map(csvCell)).toEqual(["5", "-1", "0", "", "", "true"]);
    expect(toCsv(["a", "b"], [["=x", 1]])).toBe("\ufeffa,b\r\n'=x,1\r\n");
  });
});

describe("admin phone agent: call drawer and review (A10, A11)", () => {
  it("opens a drawer with the §11.3 lines and gives focus back to the row button when it closes", async () => {
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    await callsTable();
    const opener = screen.getByRole("button", { name: `Open call: 晴光牙醫診所 · ${T1}` });
    await user.click(opener);
    const heading = await screen.findByRole("heading", { level: 2, name: `晴光牙醫診所 · ${T1}` });
    expect(document.activeElement).toBe(heading);
    expect(opener).toHaveAttribute("aria-expanded", "true");
    // The store reads out "Call ID {ref}"; the drawer leads with the same label, then the line's own id (fix round).
    const facts = await within(drawer()).findByText(/^Call ID /);
    expect(facts.textContent).toBe(`Call ID ${hex(1001).slice(0, 8)} · Line call ID 1797815702.101 · Number +886227001001 (Customer line) · Entry Phone line`);
    const text = drawer().textContent ?? "";
    // 24-hour Taipei times like the store pages, with seconds where calls can share a minute.
    expect(text).toContain("Started Oct 21, 2026, 09:15:02 · Answered Oct 21, 2026, 09:15:02 · Ended Oct 21, 2026, 09:17:41");
    expect(text).toContain("Transcript until Jan 19, 2027 · Recording until Nov 20, 2026 · Record until Nov 25, 2027");
    expect(text).toContain("Settings v3 (sha 0123abcd) · Notice d1");
    expect(text).toContain("Caller spoke: 12.3 s with the AI, 12.3 s in total · 6 turns · reply p50 820 ms / p95 1430 ms · barge-ins 1 · fillers 2 · talk-overs 0 · no responses —");
    expect(text).toContain(`Orchestrator ${taipei("2026-10-21T01:17:45Z")} · Records not received`);
    // Fix round (phase2-contract §3.5): a store does not see a call before the records sender has reported it.
    expect(text).toContain("The records sender has not reported this call, so the store cannot see it yet.");
    expect(text).toContain("Estimated 1 (AI answered and the caller spoke for 3 seconds or more, rule q5-draft-1)");
    expect(text).toContain("Recording days: store 30, reported —");
    expect(text).toContain(`The store flagged this as a wrong answer on ${taipei("2026-10-21T02:00:00Z")}: 價格答錯`);
    expect(text).not.toContain("The message result has not arrived yet.");
    await user.click(within(drawer()).getByRole("button", { name: "Close" }));
    expect(document.getElementById("voice-quality-drawer")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: `Open call: 晴光牙醫診所 · ${T1}` })));
  });

  it("says the store cannot see a call the records sender has not reported, and says nothing once it has or for a test call", async () => {
    const backend = new QualityBackend();
    const [edge, reported] = [backend.calls[0], backend.calls[1]];
    reported.sources = { ...reported.sources, records: { receivedAt: "2026-10-21T01:18:00Z", sha256: "e".repeat(64) } };
    const tryCall = backend.calls.find((call) => call.entry === "try")!;
    expect([edge.sources.records, reported.sources.records === null, tryCall.sources.records]).toEqual([null, false, null]);
    const user = await openQuality(backend);
    await callsTable();
    const note = "The records sender has not reported this call, so the store cannot see it yet.";
    for (const [call, shown] of [[edge, true], [reported, false], [tryCall, false]] as const) {
      await user.click(document.getElementById(`voice-quality-open-${call.id}`)!);
      await within(drawer()).findByText(/^Call ID /);
      expect((drawer().textContent ?? "").includes(note), `${call.id} ${call.entry}`).toBe(shown);
      await user.click(within(drawer()).getByRole("button", { name: "Close" }));
    }
  });

  it("shows a pending message result, a mismatch and the fallback reason", async () => {
    const backend = new QualityBackend();
    const c5 = backend.calls[4];
    // A pending records report is all zero (§3.4), so nothing was recorded yet either.
    c5.message = { ...c5.message, final: false, recordingSaved: false };
    c5.mismatch = ["ended_at"];
    c5.configVersion = null;
    const user = await openQuality(backend);
    await callsTable();
    await user.click(document.getElementById(`voice-quality-open-${c5.id}`)!);
    await within(drawer()).findByText(/Fallback: TTS/);
    const text = drawer().textContent ?? "";
    expect(text).toContain("The message result has not arrived yet.");
    expect(text).toContain("Fields that disagree: ended_at");
    expect(text).toContain("No AI settings used · Notice d1");
    // Fix round: the result is said once, and a pending message shows no zero counts beside "not arrived yet".
    expect(text).toContain("ResultFallback: TTS");
    expect(text).not.toContain("Fallback · Fallback");
    expect(text).toContain("MessageThe message result has not arrived yet.");
    expect(text).not.toMatch(/No message \(0 s of speech/);
    // No recording kept: no "Recording until" date beside "There is no recording".
    expect(text).toContain("Transcript until Jan 19, 2027 · Recording: none · Record until");
  });

  it("names a handoff once and gives the recording date only when one was kept", async () => {
    const backend = new QualityBackend();
    const c1 = backend.calls[0];
    Object.assign(c1, { outcome: "handoff", handoff: true, handoffReason: "requested" });
    c1.message = { ...c1.message, recordingSaved: true };
    const user = await openQuality(backend);
    await callsTable();
    await user.click(document.getElementById(`voice-quality-open-${c1.id}`)!);
    await within(drawer()).findByText(/^Call ID /);
    const text = drawer().textContent ?? "";
    expect(text).toContain("ResultHanded off: The caller asked");
    expect(text).not.toContain("Handed off · Handed off");
    expect(text).toMatch(/Transcript until [A-Z][a-z]{2} \d+, \d{4} · Recording until [A-Z][a-z]{2} \d+, \d{4} · Record until/);
  });

  it("checks the review like the backend before sending and sends nothing it would refuse", async () => {
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    await callsTable();
    await user.click(document.getElementById(`voice-quality-open-${hex(1001)}`)!);
    const form = await within(drawer()).findByRole("form", { name: "Review" });
    const posts = () => backend.requests.filter((request) => request.method === "POST" && request.path.endsWith("/review"));
    await user.click(within(form).getByRole("button", { name: "Save review" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Choose a score from 1 to 5.");
    await user.click(within(form).getByRole("radio", { name: "2" }));
    await user.type(within(form).getByLabelText("Note (up to 500 characters)"), "客人號碼 0912 345 678");
    await user.click(within(form).getByRole("button", { name: "Save review" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Do not put phone numbers in the note.");
    expect(posts()).toHaveLength(0);
    // At most 6 labels: the other boxes are disabled once 6 are ticked.
    const boxes = within(form).getAllByRole("checkbox");
    expect(boxes.map((box) => box.closest("label")?.textContent)).toEqual([
      "Wrong answer", "Made up", "Missed handoff", "Refused when it could answer", "Number read back wrong", "Talked over", "Too slow", "Unnatural voice", "Missing notice", "Other",
    ]);
    for (const box of boxes.slice(0, 6)) await user.click(box);
    expect(boxes.slice(6).every((box) => (box as HTMLInputElement).disabled)).toBe(true);
    // 375 px (phase 1 fix): choices sit in .portal-choice labels, never stretched inside .portal-field.
    for (const input of within(form).getAllByRole("radio").concat(boxes)) {
      expect(input.closest(".portal-field")).toBeNull();
      expect(input.closest("label")).toHaveClass("portal-choice");
    }
  });

  it("saves a review, updates the row and the open counts, and says when nothing changed", async () => {
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    await callsTable();
    expect(countsText()).toBe("Store flags to review: 1 · Auto flags to review: 3");
    await user.click(document.getElementById(`voice-quality-open-${hex(1001)}`)!);
    const form = await within(drawer()).findByRole("form", { name: "Review" });
    await user.click(within(form).getByRole("radio", { name: "2" }));
    await user.click(within(form).getByRole("checkbox", { name: "Too slow" }));
    await user.click(within(form).getByRole("checkbox", { name: "Wrong answer" }));
    await user.type(within(form).getByLabelText("Note (up to 500 characters)"), "  價格題答錯  ");
    expect(within(form).getByRole("radio", { name: "Done" })).toBeChecked();
    await user.click(within(form).getByRole("button", { name: "Save review" }));
    expect(await within(form).findByText("The review is saved.")).toBeVisible();
    const posts = backend.requests.filter((request) => request.path.endsWith("/review"));
    // Labels in the contract's order, the note trimmed.
    expect(posts.map((request) => request.body)).toEqual([{ score: 2, labels: ["wrong_answer", "slow"], note: "價格題答錯", status: "done" }]);
    expect(backend.calls[0].review?.status).toBe("done");
    const row = document.getElementById(`voice-quality-open-${hex(1001)}`)!.closest("tr")!;
    expect(cellTexts(row).slice(5, 7)).toEqual(["2", "Reviewed"]);
    // Fix round: focus does not fall to <body> while the button is disabled; it is back on "Save review".
    await waitFor(() => expect(document.activeElement).toBe(within(form).getByRole("button", { name: "Save review" })));
    expect(countsText()).toBe("Store flags to review: 0 · Auto flags to review: 3");
    expect(within(form).getByText(/^Saved \(ops@powerchampion\.example, /)).toBeVisible();
    await user.click(within(form).getByRole("button", { name: "Save review" }));
    expect(await within(form).findByText("The review did not change.")).toBeVisible();
    expect(countsText()).toBe("Store flags to review: 0 · Auto flags to review: 3");
    // Opening it again: an open review counts again.
    await user.click(within(form).getByRole("radio", { name: "Open" }));
    await user.click(within(form).getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(countsText()).toBe("Store flags to review: 1 · Auto flags to review: 3"));
  });

  it("sends one review while one is in flight, and shows the backend's refusal", async () => {
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    await callsTable();
    await user.click(document.getElementById(`voice-quality-open-${hex(1002)}`)!);
    const form = await within(drawer()).findByRole("form", { name: "Review" });
    // The existing review is loaded into the form.
    expect(within(form).getByRole("radio", { name: "2" })).toBeChecked();
    expect(within(form).getByRole("checkbox", { name: "Too slow" })).toBeChecked();
    expect(within(form).getByRole("radio", { name: "Open" })).toBeChecked();
    expect(within(form).getByLabelText("Note (up to 500 characters)")).toHaveValue("再聽一次");
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await within(form).findByText(/The review (is saved|did not change)\./);
    expect(backend.requests.filter((request) => request.path.endsWith("/review"))).toHaveLength(1);
    // The call disappears behind the operator's back: the backend's 404 shows in the form.
    backend.calls = backend.calls.filter((call) => call.id !== hex(1002));
    await user.click(within(form).getByRole("radio", { name: "3" }));
    await user.click(within(form).getByRole("button", { name: "Save review" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("This call does not exist. Reload the page.");
  });
});

describe("admin phone agent: call content (A12 and the Taiwan host)", () => {
  async function openContent(backend: QualityBackend, id = hex(1001)) {
    const user = await openQuality(backend);
    await callsTable();
    await user.click(document.getElementById(`voice-quality-open-${id}`)!);
    await within(drawer()).findByRole("heading", { level: 3, name: "Content" });
    return user;
  }
  const links = (backend: QualityBackend) => backend.requests.filter((request) => request.path.endsWith("/content-link"));

  it("reads the transcript and summary with the token only in the Authorization header", async () => {
    const backend = new QualityBackend();
    const user = await openContent(backend);
    expect(within(drawer()).getByText("Viewing content is recorded in the audit log.")).toBeVisible();
    expect(within(drawer()).queryByRole("button", { name: "Play recording" })).not.toBeInTheDocument();
    await user.click(within(drawer()).getByRole("button", { name: "Show content" }));
    expect(await within(drawer()).findByText("問洗牙價格")).toBeVisible();
    expect(links(backend).map((request) => request.body)).toEqual([{}]);
    expect(backend.mediaRequests.map((request) => request.url).sort()).toEqual([
      `${MEDIA}/v1/calls/1797815702.101/summary`, `${MEDIA}/v1/calls/1797815702.101/transcript`,
    ]);
    for (const request of backend.mediaRequests) {
      expect(request.auth).toBe(`Bearer ${backend.tokens[0]}`);
      expect(request.credentials).toBe("omit");
      expect(request.url).not.toContain(backend.tokens[0]);
    }
    // The token is never on the page.
    expect(document.body.innerHTML).not.toContain(backend.tokens[0]);
    const transcript = within(drawer()).getByRole("list");
    expect(within(transcript).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Caller 0:00: 洗牙多少錢？", "AI 0:02: 洗牙是 800 元。"]);
  });

  it("plays the recording from a blob and revokes it when the drawer closes", async () => {
    const created: Blob[] = [];
    const revoke = vi.fn();
    const backend = new QualityBackend();
    const user = await openContent(backend);
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn((blob: Blob) => { created.push(blob); return "blob:recording"; });
      static revokeObjectURL = revoke;
    });
    await user.click(within(drawer()).getByRole("button", { name: "Show content" }));
    await user.click(await within(drawer()).findByRole("button", { name: "Play recording" }));
    await waitFor(() => expect(drawer().querySelector("audio")).toHaveAttribute("src", "blob:recording"));
    expect(created).toHaveLength(1);
    expect(backend.mediaRequests.at(-1)?.url).toBe(`${MEDIA}/v1/calls/1797815702.101/recording`);
    expect(revoke).not.toHaveBeenCalled();
    await user.click(within(drawer()).getByRole("button", { name: "Close" }));
    expect(revoke).toHaveBeenCalledWith("blob:recording");
  });

  it("reads like the store page: no redirects, audio only for the recording, the §8.3 shapes only, https links only", async () => {
    const backend = new QualityBackend();
    backend.media = "wrong_shape";
    const user = await openContent(backend);
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:never");
      static revokeObjectURL = vi.fn();
    });
    await user.click(within(drawer()).getByRole("button", { name: "Show content" }));
    // Neither JSON body is a transcript or a summary: shown as unreadable, nothing of it on the page.
    await waitFor(() => expect(within(drawer()).getAllByText("The content cannot be loaded right now. Try again later.")).toHaveLength(2));
    expect(drawer().innerHTML).not.toContain("&lt;b&gt;");
    await user.click(await within(drawer()).findByRole("button", { name: "Play recording" }));
    // An HTML answer where audio was expected is not played.
    await waitFor(() => expect(within(drawer()).getAllByText("The content cannot be loaded right now. Try again later.")).toHaveLength(3));
    expect(drawer().querySelector("audio")).toBeNull();
    expect(backend.mediaRequests.length).toBe(3);
    for (const request of backend.mediaRequests) expect(request.redirect).toBe("error");
    await user.click(within(drawer()).getByRole("button", { name: "Close" }));

    // An A12 answer pointing at plain http: the token is sent nowhere.
    const before = backend.mediaRequests.length;
    backend.media = "ok";
    backend.linkUrls = (urls) => Object.fromEntries(Object.entries(urls).map(([kind, url]) => [kind, url.replace("https://", "http://")]));
    await user.click(document.getElementById(`voice-quality-open-${hex(1001)}`)!);
    await within(drawer()).findByRole("heading", { level: 3, name: "Content" });
    await user.click(within(drawer()).getByRole("button", { name: "Show content" }));
    expect(await within(drawer()).findByRole("alert")).toHaveTextContent(/./);
    expect(backend.mediaRequests.length).toBe(before);
  });

  it("renews an expired token once, and only once", async () => {
    const backend = new QualityBackend();
    backend.media = "expire_once";
    const user = await openContent(backend);
    await user.click(within(drawer()).getByRole("button", { name: "Show content" }));
    expect(await within(drawer()).findByText("問洗牙價格")).toBeVisible();
    expect(within(drawer()).getAllByRole("listitem")).toHaveLength(2);
    // Transcript and summary both expired; they shared one renewal.
    expect(links(backend)).toHaveLength(2);

    backend.media = "expire_always";
    await user.click(within(drawer()).getByRole("button", { name: "Show content" }));
    await waitFor(() => expect(within(drawer()).getAllByText('The viewing link expired. Choose "Show content" again.')).toHaveLength(2));
    expect(links(backend)).toHaveLength(4);
  });

  it.each([
    ["not_ready" as const, "The content is still being processed, usually within a few minutes after the call. Try again later."],
    ["network" as const, "The content cannot be loaded right now. Try again later."],
  ])("explains a Taiwan host answer of %s", async (behaviour, copy) => {
    const backend = new QualityBackend();
    backend.media = behaviour;
    const user = await openContent(backend);
    await user.click(within(drawer()).getByRole("button", { name: "Show content" }));
    await waitFor(() => expect(within(drawer()).getAllByText(copy)).toHaveLength(2));
  });

  it("explains A12 refusals and a call without content", async () => {
    const backend = new QualityBackend();
    backend.linkLimit = 0;
    const user = await openContent(backend);
    await user.click(within(drawer()).getByRole("button", { name: "Show content" }));
    expect(await within(drawer()).findByText("Too many views. Try again in an hour.")).toBeVisible();
    expect(backend.mediaRequests).toHaveLength(0);
    await user.click(within(drawer()).getByRole("button", { name: "Close" }));

    backend.linkLimit = 60;
    backend.mediaAvailable = false;
    await user.click(document.getElementById(`voice-quality-open-${hex(1001)}`)!);
    await within(drawer()).findByRole("heading", { level: 3, name: "Content" });
    await user.click(within(drawer()).getByRole("button", { name: "Show content" }));
    expect(await within(drawer()).findByText("Viewing call content is not available yet.")).toBeVisible();
    await user.click(within(drawer()).getByRole("button", { name: "Close" }));

    await user.click(document.getElementById(`voice-quality-open-${hex(1003)}`)!);
    expect(await within(drawer()).findByText("No content was kept for this call.")).toBeVisible();
    expect(within(drawer()).queryByRole("button", { name: "Show content" })).not.toBeInTheDocument();
  });

  it("says the store deleted a call's content in the list and the drawer, with the Taiwan host's confirmation (§16)", async () => {
    const backend = new QualityBackend();
    const deleted = backend.calls[0];
    Object.assign(deleted, {
      storeDeletedAt: "2026-10-21T03:00:00Z",
      content: { ...deleted.content, state: "deleted" },
      deletions: [{ id: hex(77), reason: "store_deleted", kinds: ["recording", "summary", "transcript"], status: "pending", requestedAt: "2026-10-21T03:00:00Z",
        doneAt: null, filesDeleted: null, rowsDeleted: null }],
    });
    const user = await openQuality(backend);
    const table = await callsTable();
    const row = bodyRows(table).find((tr) => within(tr).queryByRole("button", { name: `Open call: 晴光牙醫診所 · ${T1}` }))!;
    expect(row.textContent).toContain("Store deleted the content");
    expect(bodyRows(table).filter((tr) => (tr.textContent ?? "").includes("Store deleted the content"))).toHaveLength(1);
    await user.click(document.getElementById(`voice-quality-open-${deleted.id}`)!);
    await within(drawer()).findByText(/^Call ID /);
    let text = drawer().textContent ?? "";
    expect(text).toContain(`The store deleted the content: on ${taipei("2026-10-21T03:00:00Z")} the store deleted this call's recording and text; billing is kept and the store no longer sees the call.`);
    expect(text).toContain(`Deleted by the store · Waiting for the records host (requested ${taipei("2026-10-21T03:00:00Z")})`);
    expect(within(drawer()).getByText("The store deleted this call's recording and text; it can no longer be viewed.")).toBeVisible();
    expect(within(drawer()).queryByRole("button", { name: "Show content" })).not.toBeInTheDocument();
    await user.click(within(drawer()).getByRole("button", { name: "Close" }));
    deleted.deletions = [{ ...deleted.deletions[0], status: "done", doneAt: "2026-10-21T03:05:00Z", filesDeleted: 4, rowsDeleted: 3 },
      { id: hex(78), reason: "content_expired", kinds: ["recording", "summary", "transcript"], status: "pending", requestedAt: "2027-01-19T01:15:02Z",
        doneAt: null, filesDeleted: null, rowsDeleted: null }];
    await user.click(document.getElementById(`voice-quality-open-${deleted.id}`)!);
    await within(drawer()).findByText(/^Call ID /);
    text = drawer().textContent ?? "";
    expect(text).toContain(`Deleted by the store · Deleted by the records host (${taipei("2026-10-21T03:05:00Z")}, 4 files, 3 rows)`);
    expect(text).toContain(`Content past its date (90 days) · Waiting for the records host (requested ${taipei("2027-01-19T01:15:02Z")})`);
    // A call nobody deleted has no deletion line.
    await user.click(within(drawer()).getByRole("button", { name: "Close" }));
    await user.click(document.getElementById(`voice-quality-open-${hex(1002)}`)!);
    await within(drawer()).findByText(/^Call ID /);
    expect(drawer().textContent ?? "").not.toContain("Deletion");
    expect(qualityErrorText(new PortalError(410, "call_content_deleted", "x"), "zh")).toBe("店家已刪除這通的錄音與文字，不能再查看。");
    expect(qualityErrorText(new PortalError(410, "call_content_deleted", "x"), "en")).toBe("The store deleted this call's recording and text; it can no longer be viewed.");
  });

  it("keeps Show content disabled while the media host is not configured", async () => {
    const backend = new QualityBackend();
    backend.calls[0].content = { ...backend.calls[0].content, linkAvailable: false, hasRecording: false };
    await openContent(backend);
    expect(within(drawer()).getByRole("button", { name: "Show content" })).toBeDisabled();
    expect(within(drawer()).getByText("Viewing call content is not available yet.")).toBeVisible();
    expect(within(drawer()).getByText("There is no recording for this call (because of the store's recording setting or the caller's request).")).toBeVisible();
  });
});

describe("admin phone agent: blind listening log (A13-A16)", () => {
  const listeningSection = () => screen.getByRole("region", { name: "Blind listening log" });
  const listeningTable = () => within(listeningSection()).findByRole("table", { name: "Blind listening log" });

  it("shows entries newest first and the report location as plain text, never a link", async () => {
    const backend = new QualityBackend();
    await openQuality(backend);
    const table = await listeningTable();
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Date", "Title", "Type", "Samples", "Raters", "Result", "Report", "Actions",
    ]);
    const rows = bodyRows(table);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["盲聽 2", "盲聽 1MOS 4.1第二行"]);
    expect(cellTexts(rows[0]).slice(0, 6)).toEqual(["2026-10-12", "Call sample", "40", "5", "Recorded only", "—"]);
    expect(cellTexts(rows[1])[5]).toBe("javascript:alert(1)");
    expect(within(listeningSection()).queryByRole("link")).not.toBeInTheDocument();
    expect(table).toHaveClass("voice-stack");
    expect(within(rows[0]).getAllByRole("cell").map((cell) => cell.getAttribute("data-label"))).toEqual([
      "Date", "Type", "Samples", "Raters", "Result", "Report", null,
    ]);
    expect(within(rows[1]).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Edit: 盲聽 1", "Delete: 盲聽 1"]);
  });

  it("adds an entry after the same checks as the backend and focuses its row", async () => {
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    await listeningTable();
    await user.click(within(listeningSection()).getByRole("button", { name: "Add an entry" }));
    const dialog = screen.getByRole("dialog", { name: "Add a blind listening entry" });
    const posts = () => backend.requests.filter((request) => request.method === "POST" && request.path === "/admin/voice/quality/listening");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter a title of 1 to 60 characters.");
    await user.type(within(dialog).getByLabelText("Title"), "  G0 聲音盲聽  ");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "call_sample");
    await user.type(within(dialog).getByLabelText("Samples"), "200");
    await user.type(within(dialog).getByLabelText("Raters"), "51");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter the raters as a whole number from 1 to 50.");
    await user.clear(within(dialog).getByLabelText("Raters"));
    await user.type(within(dialog).getByLabelText("Raters"), "8");
    await user.click(within(dialog).getByRole("radio", { name: "Passed" }));
    await user.type(within(dialog).getByLabelText("Summary (up to 1,000 characters)"), "回電 02-2700-1001");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Do not put phone numbers in the summary.");
    expect(posts()).toHaveLength(0);
    await user.clear(within(dialog).getByLabelText("Summary (up to 1,000 characters)"));
    await user.type(within(dialog).getByLabelText("Summary (up to 1,000 characters)"), "MOS 4.2");
    await user.type(within(dialog).getByLabelText("Report location (up to 200 characters)"), "docs/g0.md");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts().map((request) => request.body)).toEqual([{
      title: "G0 聲音盲聽", kind: "call_sample", heldOn: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10),
      sampleCount: 200, raterCount: 8, passed: true, summary: "MOS 4.2", reportRef: "docs/g0.md",
    }]);
    expect(within(listeningSection()).getByRole("status")).toHaveTextContent('Added "G0 聲音盲聽".');
    expect(backend.logs).toHaveLength(3);
    const created = backend.logs[2];
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById(`voice-listening-edit-${created.id}`)));
    expect(within(listeningSection()).getByText("3 of up to 500 entries")).toBeVisible();
  });

  it("shows the backend's 500-entry limit and leaves the log as it was", async () => {
    const backend = new QualityBackend();
    backend.logs = Array.from({ length: 500 }, (_, index) => mockLog(index + 1, { heldOn: "2026-10-01" }));
    const user = await openQuality(backend);
    await listeningTable();
    await user.click(within(listeningSection()).getByRole("button", { name: "Add an entry" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "第 501 筆");
    await user.type(within(dialog).getByLabelText("Samples"), "1");
    await user.type(within(dialog).getByLabelText("Raters"), "1");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Up to 500 entries. Delete old ones first.");
    expect(backend.logs).toHaveLength(500);
  });

  it("edits and deletes with focus kept on a row", async () => {
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    await listeningTable();
    await user.click(within(listeningSection()).getByRole("button", { name: "Edit: 盲聽 2" }));
    let dialog = screen.getByRole("dialog", { name: "Edit the blind listening entry" });
    expect(within(dialog).getByRole("radio", { name: "Recorded only" })).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(listeningSection()).getByRole("status")).toHaveTextContent('"盲聽 2" did not change.'));
    await user.click(within(listeningSection()).getByRole("button", { name: "Edit: 盲聽 2" }));
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Failed" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(listeningSection()).getByRole("status")).toHaveTextContent('Saved "盲聽 2".'));
    expect(backend.logs.find((log) => log.title === "盲聽 2")?.passed).toBe(false);
    expect(cellTexts(bodyRows(await listeningTable())[0])[4]).toBe("Failed");

    await user.click(within(listeningSection()).getByRole("button", { name: "Delete: 盲聽 2" }));
    dialog = screen.getByRole("dialog", { name: 'Delete the blind listening entry "盲聽 2"?' });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(listeningSection()).getByRole("status")).toHaveTextContent('Deleted "盲聽 2".'));
    expect(backend.logs.map((log) => log.title)).toEqual(["盲聽 1"]);
    await waitFor(() => expect(document.activeElement).toBe(within(listeningSection()).getByRole("button", { name: "Edit: 盲聽 1" })));
  });

  it("reloads when the entry was deleted elsewhere", async () => {
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    await listeningTable();
    await user.click(within(listeningSection()).getByRole("button", { name: "Delete: 盲聽 1" }));
    backend.logs = backend.logs.filter((log) => log.title !== "盲聽 1");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This entry no longer exists. Reload the page.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(bodyRows(screen.getByRole("table", { name: "Blind listening log" })).map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["盲聽 2"]));
  });
});

describe("admin phone agent: quality copy and limits stay in step with the backend", () => {
  it("has copy for every enum value", () => {
    const keys = (table: object) => Object.keys(table);
    expect(keys(OUTCOME_LABEL)).toEqual([...OUTCOMES]);
    expect(keys(ENTRY_LABEL)).toEqual([...ENTRIES]);
    expect(keys(METER_REASON_LABEL)).toEqual([...METER_REASONS]);
    expect(keys(HANDOFF_LABEL)).toEqual([...HANDOFF_REASONS]);
    expect(keys(AUTO_FLAG_LABEL)).toEqual([...AUTO_FLAGS]);
    expect(keys(DEGRADE_LABEL)).toEqual([...DEGRADE_REASONS]);
    expect(keys(REVIEW_LABEL_COPY)).toEqual([...REVIEW_LABELS]);
    expect(keys(LISTENING_KIND_LABEL)).toEqual([...LISTENING_KINDS]);
    expect(keys(MESSAGE_OUTCOME_LABEL)).toEqual([...MESSAGE_OUTCOMES]);
    expect(keys(DELETION_REASON_LABEL)).toEqual([...DELETION_REASONS]);
    expect(keys(DELETION_STATUS_LABEL)).toEqual([...DELETION_STATUSES]);
    // The contract lists (written out above) are the ones the page offers.
    expect([...REVIEW_LABELS]).toEqual(CONTRACT.reviewLabels);
    expect([...LISTENING_KINDS]).toEqual(CONTRACT.listeningKinds);
    expect([...OUTCOMES]).toEqual(CONTRACT.outcomes);
    expect([...ENTRIES]).toEqual(CONTRACT.entries);
  });

  it("checks the listening fields with the backend's limits and the A9 fallback limits with §1.5", () => {
    const source = readFileSync(join(process.cwd(), "server/voice_calls.py"), "utf8");
    const constant = (name: string) => {
      const match = source.match(new RegExp(`^${name} = (\\d+)$`, "m"));
      if (!match) throw new Error(`${name} is not a plain integer in server/voice_calls.py`);
      return Number(match[1]);
    };
    expect(LISTENING_FIELD_LIMITS).toEqual({
      titleChars: constant("LISTENING_TITLE_CHARS"),
      summaryChars: constant("LISTENING_SUMMARY_CHARS"),
      reportRefChars: constant("LISTENING_REF_CHARS"),
      samplesMax: constant("LISTENING_SAMPLES_MAX"),
      ratersMax: constant("LISTENING_RATERS_MAX"),
    });
    const drawerSource = readFileSync(join(process.cwd(), "components/admin-voice-quality-drawer.tsx"), "utf8");
    expect(drawerSource).toContain(
      `{ callsPageSize: ${constant("QUALITY_PAGE_SIZE")}, reviewNoteChars: ${constant("REVIEW_NOTE_CHARS")}, reviewLabelsMax: ${constant("REVIEW_LABELS_MAX")}, listeningMax: ${constant("LISTENING_MAX")} }`,
    );
  });
});

describe("admin phone agent: quality tab in Chinese", () => {
  it("uses the §11.3 wording", async () => {
    localStorage.setItem("pc-locale", "zh");
    window.history.replaceState({}, "", "/admin/voice");
    const backend = new QualityBackend();
    const user = await openQuality(backend);
    const table = await callsTable();
    expect(countsText()).toBe("店家標記待審 1・自動標記待審 3");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["時間", "通話編號", "店家", "入口", "結果", "標記", "分數", "狀態", "動作"]);
    expect(cellTexts(bodyRows(table)[3]).slice(1, 5)).toEqual(["（號碼不在表上）", "市話", "已回答", "號碼不在表上"]);
    // The store pages' 24-hour Taipei time, with the year (fix round; was 「2026年10月21日 上午9:15」).
    expect(within(bodyRows(table)[1]).getByRole("rowheader").textContent).toBe("2026 年 10 月 21 日 09:15");
    expect([...(screen.getByLabelText("標記") as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      "有標記（店家或自動）", "店家標記", "自動標記", "沒有標記", "全部",
    ]);
    expect([...(screen.getByLabelText("審查") as HTMLSelectElement).options].map((option) => option.text)).toEqual(["待審", "已審", "全部"]);
    await user.click(document.getElementById(`voice-quality-open-${hex(1001)}`)!);
    const form = await within(drawer()).findByRole("form", { name: "審查" });
    expect(within(form).getByRole("group", { name: "分數（1 很差～5 很好）" })).toBeVisible();
    expect(within(form).getByText("只寫判斷與處理，不要貼逐字稿、客人電話或姓名。")).toBeVisible();
    expect(drawer().textContent).toContain(`通話編號 ${hex(1001).slice(0, 8)}・線路通話 ID 1797815702.101・號碼 +886227001001（客戶線）・入口 市話`);
    expect(drawer().textContent).toContain("開始 2026 年 10 月 21 日 09:15:02・接起 2026 年 10 月 21 日 09:15:02・結束 2026 年 10 月 21 日 09:17:41");
    expect(drawer().textContent).toContain("店家在");
    expect(screen.getByRole("heading", { level: 2, name: "盲聽紀錄" })).toBeVisible();
  });
});
