/**
 * A contract-faithful stand-in for the BFF, the store call routes M13-M17 (server/voice_call_routes.py,
 * server/voice_calls.py) and the Taiwan host's media endpoint (phase2-contract §6, §8.3, §9, §10.1).
 * The checks run in the backend's order and answer the backend's codes; the content-link count is checked and taken in
 * one step like the backend's writer lock. It is a test fixture: "secrets" here are fake and not secrets.
 */
import { vi } from "vitest";
import type { VoiceSummary } from "../../components/account-voice";
import type { CallEntry, CallOutcome, CallerKind, HandoffReason, MediaKind, MeterReason } from "../../lib/voice-calls";
import { hasPhoneNumber } from "../../lib/voice-calls";

export const STORE_ID = "a".repeat(32);
export const OTHER_STORE_ID = "b".repeat(32);
export const MEDIA_ORIGIN = "https://media.example.test";
const DAY = 86400;
const TAIPEI = 8 * 3600;
const TRANSCRIPT_DAYS = 90;

export type Row = {
  id: string;
  storeId: string;
  callId: string;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  entry: CallEntry;
  caller: { tail: string | null; kind: CallerKind };
  outcome: CallOutcome;
  hasMessage: boolean;
  handoff: boolean;
  handoffReason: HandoffReason | null;
  urgent: boolean;
  degraded: boolean;
  meterUnits: 0 | 1;
  meterReason: MeterReason;
  configVersion: number | null;
  callbackConfirmed: boolean;
  messageMs: number;
  recordingMs: number;
  contentExpected: boolean;
  recordingSaved: boolean;
  retentionSnapshot: number;
  flag: { kind: "wrong_answer"; note: string; flaggedAt: number } | null;
  reviewStatus: "open" | "done" | null;
  /** The records sender has reported the call (an edge call without it gets 409 call_content_pending from M17). */
  recordsReported: boolean;
  /** The two sources name different dialed numbers (M17 answers 404 call_content_unavailable). */
  dialedMismatch: boolean;
};

/** What the Taiwan host answers for one read: the normal content, or one of its §8.3 errors. */
export type MediaAnswer = "ok" | "token_expired" | "invalid" | "forbidden" | "not_ready" | "not_found" | "expired" | "down" | "network";

export type Backend = {
  rows: Row[];
  storeStatus: string;
  storeMissing: boolean;
  passwordChangeRequired: boolean;
  storeRetentionDays: number;
  mediaAvailable: boolean;
  linksUsed: number;
  pageSize: number;
  flagNoteChars: number;
  tokens: Map<string, { exp: number; kinds: MediaKind[]; callId: string }>;
  /** Per kind, the answers the Taiwan host gives in order; once used up it answers "ok". */
  media: Partial<Record<MediaKind, MediaAnswer[]>>;
  /** Holds M13 until the test releases it (one gate per read, in order). */
  gates: Promise<void>[];
  /** Replaces an M17 answer after every check passed (e.g. a malformed one). */
  linkOverride?: (media: Record<string, unknown>) => unknown;
};

export type Request = { method: string; url: string; path: string; headers: Headers; body: string | null; init: RequestInit | undefined };

const iso = (epoch: number | null) => (epoch === null ? null : new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"));
const now = () => Math.floor(Date.now() / 1000);
const hex = (n: number) => n.toString(16).padStart(32, "0");

export function row(n: number, values: Partial<Row> = {}): Row {
  const startedAt = values.startedAt ?? Math.floor(Date.parse("2026-12-21T01:15:02Z") / 1000) - n * 600;
  return {
    id: hex(n + 1),
    storeId: STORE_ID,
    callId: `1797815702.${100 + n}`,
    startedAt,
    answeredAt: startedAt + 1,
    endedAt: startedAt + 159,
    entry: "pstn",
    caller: { tail: "678", kind: "mobile" },
    outcome: "answered",
    hasMessage: false,
    handoff: false,
    handoffReason: null,
    urgent: false,
    degraded: false,
    meterUnits: 1,
    meterReason: "ai_speech",
    configVersion: 1,
    callbackConfirmed: false,
    messageMs: 0,
    recordingMs: 0,
    contentExpected: true,
    recordingSaved: false,
    retentionSnapshot: 30,
    flag: null,
    reviewStatus: null,
    recordsReported: true,
    dialedMismatch: false,
    ...values,
  };
}

export function backend(values: Partial<Backend> = {}): Backend {
  return {
    rows: [],
    storeStatus: "live",
    storeMissing: false,
    passwordChangeRequired: false,
    storeRetentionDays: 30,
    mediaAvailable: true,
    linksUsed: 0,
    pageSize: 50,
    flagNoteChars: 100,
    tokens: new Map(),
    media: {},
    gates: [],
    ...values,
  };
}

export function summaryOf(state: Backend): VoiceSummary {
  return {
    store: {
      id: STORE_ID, name: "晴光牙醫診所", industry: "clinic", templateId: "clinic", status: state.storeStatus, currentVersion: 2,
      publishedAt: "2026-11-01T02:00:00Z", hasUnpublishedChanges: false, faqCount: 12, kbChars: 2875, aiAnswerEnabled: true,
      updatedAt: "2026-11-01T01:58:00Z",
    },
    account: { passwordChangeRequired: state.passwordChangeRequired },
    try: { available: true, limit: 20, windowHours: 24, used: 3, remaining: 17, lastIssuedAt: null },
    limits: {
      storeNameChars: 40, greetingChars: 40, openingNonSpaceMax: 67, openingSecondsMax: 15, charsPerSecond: 4.5,
      questionChars: 100, variantChars: 50, variantsMax: 10, faqChars: 400, kbCharsMax: 6000, faqMax: 120,
      csvBodyBytes: 196608, hoursSegmentsPerDay: 4, closuresMax: 60, closureNoteChars: 40, maxMessageSecondsMin: 60,
      maxMessageSecondsMax: 180, retentionDaysMax: 90, retentionDaysMaxFull: 30, tryLimit: 20, tryWindowHours: 24,
      ticketTtlSeconds: 900,
    },
  };
}

export const failure = (status: number, error: string, detail = "Rejected.") => Response.json({ error, detail }, { status });

/** [start, end) epochs of a Taipei month (voice_calls.month_bounds). */
function monthBounds(month: string): [number, number] {
  const [year, number] = month.split("-").map(Number);
  return [Date.UTC(year, number - 1, 1) / 1000 - TAIPEI, Date.UTC(year, number, 1) / 1000 - TAIPEI];
}
const taipeiMonth = (epoch: number) => new Date((epoch + TAIPEI) * 1000).toISOString().slice(0, 7);

const callItem = (r: Row) => ({
  id: r.id, ref: r.id.slice(0, 8), startedAt: iso(r.startedAt), durationSeconds: r.endedAt === null ? null : r.endedAt - r.startedAt,
  entry: r.entry, caller: r.caller, outcome: r.outcome, hasMessage: r.hasMessage, handoff: r.handoff, urgent: r.urgent,
  degraded: r.degraded, flagged: r.flag !== null, meterUnits: r.meterUnits, meterReason: r.meterReason,
});

const recordingDays = (state: Backend, r: Row) => Math.min(r.retentionSnapshot, state.storeRetentionDays);

/** voice_calls.content_kinds: what can still be viewed now (sorted). */
function contentKinds(state: Backend, r: Row): MediaKind[] {
  if (!r.contentExpected) return [];
  const kinds: MediaKind[] = [];
  if (r.recordingSaved && now() < r.startedAt + recordingDays(state, r) * DAY) kinds.push("recording");
  if (now() < r.startedAt + TRANSCRIPT_DAYS * DAY) kinds.push("summary", "transcript");
  return kinds.sort();
}

const flagJson = (r: Row) =>
  r.flag === null ? null : { kind: r.flag.kind, note: r.flag.note, flaggedAt: iso(r.flag.flaggedAt), reviewed: r.reviewStatus === "done" };

function detailOf(state: Backend, r: Row) {
  const kinds = contentKinds(state, r);
  return {
    call: {
      ...callItem(r), answeredAt: iso(r.answeredAt), endedAt: iso(r.endedAt), configVersion: r.configVersion,
      handoffReason: r.handoffReason, callbackConfirmed: r.callbackConfirmed, messageSeconds: Math.round(r.messageMs / 100) / 10,
      recordingSeconds: Math.round(r.recordingMs / 100) / 10,
    },
    content: {
      expected: r.contentExpected, hasRecording: r.recordingSaved,
      transcriptUntil: r.contentExpected ? iso(r.startedAt + TRANSCRIPT_DAYS * DAY) : null,
      recordingUntil: r.recordingSaved ? iso(r.startedAt + recordingDays(state, r) * DAY) : null,
      state: !r.contentExpected ? "none" : kinds.length ? "available" : "expired",
      linkAvailable: state.mediaAvailable,
    },
    flag: flagJson(r),
  };
}

// The backend's single-line rule (support.UNSAFE_TEXT, INVISIBLE_TEXT, voice_merchant._single_line); the phone
// check is lib/voice-calls.ts hasPhoneNumber, which tests/support/phone-like-vectors.json keeps equal to the backend's.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200b-\u200f\u2060\u061c]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

const BFF_FILTERS: [string, RegExp][] = [
  ["month", /^\d{4}-(0[1-9]|1[0-2])$/],
  ["outcome", /^(answered|message|handoff|degraded|not_answered|hangup_early|no_speech|error|unknown)$/],
  ["before", /^\d{10}-[a-f0-9]{32}$/],
  ["flagged", /^1$/],
];

async function list(state: Backend, url: URL): Promise<Response> {
  for (const [name, pattern] of BFF_FILTERS) {
    const value = url.searchParams.get(name);
    if (value !== null && !pattern.test(value)) return failure(400, "invalid_input", `Choose a valid ${name} filter.`);
  }
  const gate = state.gates.shift();
  if (gate) await gate;
  if (state.storeMissing) return failure(404, "voice_store_not_found");
  const month = url.searchParams.get("month") ?? taipeiMonth(now());
  const [start, end] = monthBounds(month);
  const outcome = url.searchParams.get("outcome");
  const flagged = url.searchParams.get("flagged");
  const before = url.searchParams.get("before");
  const inMonth = state.rows.filter((r) => r.storeId === STORE_ID && r.startedAt >= start && r.startedAt < end);
  let rows = inMonth.filter((r) => (!outcome || r.outcome === outcome) && (!flagged || r.flag !== null));
  if (before) {
    const [at, id] = [Number(before.slice(0, 10)), before.slice(11)];
    rows = rows.filter((r) => r.startedAt < at || (r.startedAt === at && r.id < id));
  }
  rows.sort((a, b) => b.startedAt - a.startedAt || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));
  const page = rows.slice(0, state.pageSize);
  const next = rows.length > state.pageSize ? `${String(page[page.length - 1].startedAt).padStart(10, "0")}-${page[page.length - 1].id}` : null;
  const byOutcome = Object.fromEntries(
    ["answered", "message", "handoff", "degraded", "not_answered", "hangup_early", "no_speech", "error", "unknown"].map((key) => [
      key,
      inMonth.filter((r) => r.outcome === key).length,
    ]),
  );
  return Response.json({
    calls: page.map(callItem),
    next,
    summary: {
      month, total: inMonth.length, byOutcome, meterUnits: inMonth.reduce((sum, r) => sum + r.meterUnits, 0),
      flagged: inMonth.filter((r) => r.flag !== null).length,
    },
    limits: { callsPageSize: state.pageSize, flagNoteChars: state.flagNoteChars },
  });
}

const ownCall = (state: Backend, id: string) => (/^[a-f0-9]{32}$/.test(id) ? state.rows.find((r) => r.id === id && r.storeId === STORE_ID) : undefined);

function jsonBody(init: RequestInit | undefined): Record<string, unknown> | Response {
  if (!(new Headers(init?.headers).get("Content-Type") ?? "").startsWith("application/json")) return failure(415, "invalid_input");
  try {
    const body: unknown = JSON.parse(String(init?.body ?? ""));
    if (typeof body !== "object" || body === null || Array.isArray(body)) return failure(400, "invalid_input");
    return body as Record<string, unknown>;
  } catch {
    return failure(400, "invalid_input");
  }
}

/** voice_call_routes.owner_lock: temporary password (403), then a suspended store (409) unless refused only for writes. */
function lock(state: Backend, refuseSuspended: boolean): Response | null {
  if (state.storeMissing) return failure(404, "voice_store_not_found");
  if (state.passwordChangeRequired) return failure(403, "password_change_required");
  if (refuseSuspended && state.storeStatus === "suspended") return failure(409, "store_suspended");
  return null;
}

function flag(state: Backend, id: string, init: RequestInit | undefined): Response {
  const body = jsonBody(init);
  if (body instanceof Response) return body;
  const refused = lock(state, true);
  if (refused) return refused;
  const r = ownCall(state, id);
  if (!r) return failure(404, "call_not_found");
  if (body.kind !== "wrong_answer") return failure(400, "invalid_input", "Choose the kind: wrong_answer.");
  const raw = body.note ?? "";
  if (typeof raw !== "string" || UNSAFE.test(raw)) return failure(400, "invalid_input", "Enter a valid note.");
  const note = raw.trim();
  if ([...note].length > state.flagNoteChars) return failure(400, "invalid_input", "The note can be up to 100 characters.");
  if (hasPhoneNumber(note)) return failure(400, "note_contains_number", "Do not put phone numbers in the note.");
  if (r.flag && r.flag.kind === body.kind && r.flag.note === note) return Response.json({ changed: false, flag: flagJson(r) });
  r.flag = { kind: "wrong_answer", note, flaggedAt: now() };
  return Response.json({ changed: true, flag: flagJson(r) });
}

function unflag(state: Backend, id: string): Response {
  const refused = lock(state, true);
  if (refused) return refused;
  const r = ownCall(state, id);
  if (!r) return failure(404, "call_not_found");
  if (r.flag === null) return Response.json({ changed: false });
  r.flag = null;
  return Response.json({ changed: true });
}

const b64u = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function contentLink(state: Backend, id: string, init: RequestInit | undefined): Response {
  const body = jsonBody(init);
  if (body instanceof Response) return body;
  const refused = lock(state, false);
  if (refused) return refused;
  const r = ownCall(state, id);
  if (!r) return failure(404, "call_not_found");
  // The backend says voice_media_unavailable; the BFF rewrites every other 5xx (route.ts).
  if (!state.mediaAvailable) return failure(503, "service_unavailable", "This service is unavailable or has not been configured yet.");
  if (!r.contentExpected || r.dialedMismatch) return failure(404, "call_content_unavailable");
  const kinds = contentKinds(state, r);
  if (!kinds.length) return failure(410, "call_content_expired");
  if (r.entry !== "try" && !r.recordsReported) return failure(409, "call_content_pending");
  if (state.linksUsed >= 60) return failure(429, "voice_content_link_limit");
  state.linksUsed += 1;
  const iat = now();
  const payload = { v: 1, purpose: "media", aud: "voice-media", call_id: r.callId, store_id: r.storeId, kinds, sub: "c".repeat(32), role: "store", iat, exp: iat + 300, nonce: hex(state.linksUsed) };
  const token = `${b64u(JSON.stringify(payload))}.${b64u(`not-a-real-signature-${state.linksUsed}`)}`;
  state.tokens.set(token, { exp: iat + 300, kinds, callId: r.callId });
  const media = {
    token, expiresAt: iso(iat + 300), kinds,
    urls: Object.fromEntries(kinds.map((kind) => [kind, `${MEDIA_ORIGIN}/v1/calls/${encodeURIComponent(r.callId)}/${kind}`])),
  };
  return Response.json(state.linkOverride ? state.linkOverride(media) : { media });
}

export const TRANSCRIPT = {
  segments: [
    { speaker: "ai", start_ms: 0, text: "您好，這裡是晴光牙醫診所。" },
    { speaker: "caller", start_ms: 3200, text: "請問洗牙多少錢？" },
    { speaker: "system", start_ms: 65000, text: "通話結束" },
  ],
};
export const SUMMARY = { summary: "客人詢問洗牙價格。", callback_number: "0912345678", message_text: "請回電確認時間", urgent: false };

/** §8.3 Taiwan host: Bearer token → signature (here: issued) → expiry → call and kind → content. */
async function media(state: Backend, url: URL, init: RequestInit | undefined): Promise<Response> {
  const match = /^\/v1\/calls\/([^/]+)\/(recording|summary|transcript)$/.exec(url.pathname);
  if (!match || (init?.method ?? "GET") !== "GET") return failure(404, "media_not_found");
  const kind = match[2] as MediaKind;
  const planned = state.media[kind]?.shift() ?? "ok";
  if (planned === "network") throw new TypeError("Failed to fetch");
  if (planned === "down") return new Response("<html>bad gateway</html>", { status: 502 });
  const auth = new Headers(init?.headers).get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const issued = state.tokens.get(token);
  if (!issued || planned === "invalid") return Response.json({ error: "media_token_invalid" }, { status: 401 });
  if (now() >= issued.exp || planned === "token_expired") return Response.json({ error: "media_token_expired" }, { status: 401 });
  if (decodeURIComponent(match[1]) !== issued.callId || !issued.kinds.includes(kind) || planned === "forbidden")
    return Response.json({ error: "media_forbidden" }, { status: 403 });
  if (planned === "expired") return Response.json({ error: "media_expired" }, { status: 410 });
  if (planned === "not_ready") return Response.json({ error: "media_not_ready" }, { status: 404 });
  if (planned === "not_found") return Response.json({ error: "media_not_found" }, { status: 404 });
  const callId = issued.callId;
  if (kind === "transcript") return Response.json({ call_id: callId, ...TRANSCRIPT });
  if (kind === "summary") return Response.json({ call_id: callId, ...SUMMARY });
  return new Response(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]), { headers: { "Content-Type": "audio/wav" } });
}

/** Stubs fetch for the BFF (/api/portal/*) and the Taiwan host; every request is recorded. */
export function stubPortal(state: Backend) {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input);
      const url = new URL(href, "http://localhost");
      const method = init?.method ?? "GET";
      const path = href.startsWith("/api/portal") ? href.replace("/api/portal", "") : href;
      requests.push({ method, url: href, path, headers: new Headers(init?.headers), body: init?.body ? String(init.body) : null, init });
      if (url.origin === MEDIA_ORIGIN) return media(state, url, init);
      const route = url.pathname.replace("/api/portal", "");
      if (method === "GET" && route === "/me/voice") return Response.json(summaryOf(state));
      if (method === "GET" && route === "/me/voice/calls") return list(state, url);
      let found = /^\/me\/voice\/calls\/([a-f0-9]{32})$/.exec(route);
      if (method === "GET" && found) {
        if (state.storeMissing) return failure(404, "voice_store_not_found");
        const r = ownCall(state, found[1]);
        return r ? Response.json(detailOf(state, r)) : failure(404, "call_not_found");
      }
      found = /^\/me\/voice\/calls\/([a-f0-9]{32})\/flag$/.exec(route);
      if (found && method === "POST") return flag(state, found[1], init);
      if (found && method === "DELETE") return unflag(state, found[1]);
      found = /^\/me\/voice\/calls\/([a-f0-9]{32})\/content-link$/.exec(route);
      if (found && method === "POST") return contentLink(state, found[1], init);
      // The BFF's own refusal for anything not on its list.
      return failure(404, "not_found", "This portal endpoint is not available for this request.");
    }),
  );
  return requests;
}
