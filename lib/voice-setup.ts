/**
 * Phone agent setup page (/account/voice/setup, phase1 T7): the M2/M3/M10/M11 shapes, the client-side checks
 * that mirror the backend (phase1-contract §1.4, §1.5, §3.3 and amendment A1), the opening estimate and the
 * business-hours helpers. The backend stays the authority; these checks only stop requests it would refuse.
 */
import type { VoiceLimits } from "../components/account-voice";
import { codePoints, lineProblem, type TextProblem } from "./admin-text";
import { PortalError, portalErrorText } from "./portal-client";

/** Values the backend accepts (server/voice_store.py mirrors migration 0007's CHECK constraints). */
export const INDUSTRIES = ["clinic", "cram", "other"] as const;
export const AFTER_HOURS_MODES = ["answer_and_message", "message_only"] as const;
export const ASK_CALLBACK = ["auto", "always", "never"] as const;
export const RECORDING_MODES = ["off", "message_only", "full"] as const;

export type VoiceSegment = { weekday: number; openMin: number; closeMin: number };
export type VoiceClosure = { date: string; note: string };

/** M2 `setup` (contract §3.2). */
export type VoiceSetup = {
  name: string;
  industry: string;
  templateId: string | null;
  status: string;
  greeting: string;
  introText: string;
  hours: VoiceSegment[];
  closures: VoiceClosure[];
  afterHoursMode: string;
  askCallback: string;
  maxMessageSeconds: number;
  handoffMode: string;
  recordingMode: string;
  retentionDays: number;
  aiAnswerEnabled: boolean;
  updatedAt: string;
};

export type VoiceTemplateInfo =
  | { available: false }
  | {
      available: true;
      templateId: string;
      title: { zh: string; en: string };
      greetingExample: string;
      hoursExample: VoiceSegment[];
    };

/** GET /me/voice/setup (M2); POST /me/voice/setup (M3) answers the same shape plus `changed`. */
export type VoiceSetupResponse = {
  setup: VoiceSetup;
  opening: { text: string; nonSpace: number; estSeconds: number; ok: boolean };
  disclosure: { template: string; version: string };
  template: VoiceTemplateInfo;
  limits: VoiceLimits;
  changed?: string[];
};

export type VoiceWarning = { code: string; field: string | null; faq_id: string | null };

/** POST /me/voice/publish (M11). */
export type VoicePublishResult = {
  changed: boolean;
  version: number;
  configSha256?: string;
  publishedAt?: string;
  warnings?: VoiceWarning[];
};

/** GET /me/voice/preview (M10): the saved draft compiled as the next version. */
export type VoicePreview = {
  basedOnVersion: number | null;
  nextVersion: number;
  config: { prompt?: { prefix?: string; mode_separator?: string; modes?: Record<string, string> } } | null;
  configSha256: string | null;
  hasUnpublishedChanges: boolean;
  problems: { code: string; detail?: string }[];
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only a real M2/M3 body is shown; anything else is treated as a failed load. */
export function isSetupResponse(value: unknown): value is VoiceSetupResponse {
  if (!record(value) || !record(value.setup) || !record(value.disclosure) || !record(value.limits)) return false;
  const { setup, disclosure } = value;
  return (
    typeof setup.name === "string" &&
    typeof setup.greeting === "string" &&
    Array.isArray(setup.hours) &&
    Array.isArray(setup.closures) &&
    typeof setup.recordingMode === "string" &&
    typeof setup.retentionDays === "number" &&
    typeof disclosure.template === "string"
  );
}

// Same set as the backend's NON_SPACE_IGNORED (server/voice_compile.py): space, tab, CR, LF, NBSP and the
// ideographic space. Not `\s`, whose range differs between Python and JavaScript (contract §1.4).
const NON_SPACE_IGNORED = /[ \t\n\r\u00a0\u3000]/g;

/** Characters that count towards the opening length and the store name limit (A1). */
export const nonSpace = (text: string) => codePoints(text.replace(NON_SPACE_IGNORED, ""));

/** round(nonSpace / charsPerSecond, 1) like the backend; n / 4.5 never lands on a .x5 tie. */
export const estimateSeconds = (count: number, charsPerSecond: number) => Math.round((count / charsPerSecond) * 10) / 10;

/** The whole opening: the fixed notice with the store name filled in, then the greeting (contract §1.4). */
export const openingText = (template: string, name: string, greeting: string) =>
  template.split("{{SHOP_NAME}}").join(name.trim()) + greeting.trim();

export type OpeningInfo = {
  text: string;
  nonSpace: number;
  seconds: number;
  ok: boolean;
  /** A1: characters still free for the greeting; negative when the opening is too long. */
  remaining: number;
  /** Which field to shorten when the opening is too long: the name only if it is too long on its own. */
  shorten: "name" | "greeting" | null;
};

export function openingInfo(template: string, name: string, greeting: string, limits: VoiceLimits): OpeningInfo {
  const text = openingText(template, name, greeting);
  const count = nonSpace(text);
  const max = limits.openingNonSpaceMax;
  const ok = count <= max;
  const withoutGreeting = nonSpace(openingText(template, name, ""));
  return {
    text,
    nonSpace: count,
    seconds: estimateSeconds(count, limits.charsPerSecond),
    ok,
    remaining: max - count,
    shorten: ok ? null : withoutGreeting > max ? "name" : "greeting",
  };
}

/** Minutes since midnight as HH:MM; 1440 is shown as 24:00 (contract §1.4). */
export function minuteText(minute: number) {
  const hours = Math.floor(minute / 60);
  return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Choices for a start (00:00-23:45) or end (00:15-24:00) select, every 15 minutes, plus any stored value. */
export function timeChoices(kind: "open" | "close", current: number) {
  const values: number[] = [];
  for (let minute = kind === "open" ? 0 : 15; minute <= (kind === "open" ? 1425 : 1440); minute += 15) values.push(minute);
  if (!values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b);
}

/** Weekday labels; weekday 0 is Monday (Python date.weekday(), contract §1.4). */
export const WEEKDAYS: { en: string; zh: string }[] = [
  { en: "Mon", zh: "週一" },
  { en: "Tue", zh: "週二" },
  { en: "Wed", zh: "週三" },
  { en: "Thu", zh: "週四" },
  { en: "Fri", zh: "週五" },
  { en: "Sat", zh: "週六" },
  { en: "Sun", zh: "週日" },
];

/** Editable copy of the setup. Rows carry a local key; numbers stay text so a field can be cleared while typing. */
export type DraftSegment = VoiceSegment & { key: number };
export type DraftClosure = VoiceClosure & { key: number };
export type SetupDraft = {
  name: string;
  greeting: string;
  hours: DraftSegment[];
  closures: DraftClosure[];
  afterHoursMode: string;
  askCallback: string;
  maxMessageSeconds: string;
  recordingMode: string;
  retentionDays: string;
};

let nextKey = 1;
export const rowKey = () => nextKey++;

export const draftSegments = (hours: VoiceSegment[]): DraftSegment[] =>
  hours.map((segment) => ({ weekday: segment.weekday, openMin: segment.openMin, closeMin: segment.closeMin, key: rowKey() }));

export function draftFromSetup(setup: VoiceSetup): SetupDraft {
  return {
    name: setup.name,
    greeting: setup.greeting,
    hours: draftSegments(setup.hours),
    closures: setup.closures.map((closure) => ({ date: closure.date, note: closure.note, key: rowKey() })),
    afterHoursMode: setup.afterHoursMode,
    askCallback: setup.askCallback,
    maxMessageSeconds: String(setup.maxMessageSeconds),
    recordingMode: setup.recordingMode,
    retentionDays: String(setup.retentionDays),
  };
}

/** A new range for a day: 09:00-18:00 on an empty day, otherwise the hour after the day's last range. */
export function newSegment(hours: VoiceSegment[], weekday: number): DraftSegment {
  const day = hours.filter((segment) => segment.weekday === weekday);
  if (!day.length) return { weekday, openMin: 540, closeMin: 1080, key: rowKey() };
  const last = Math.max(...day.map((segment) => segment.closeMin));
  const openMin = Math.min(last, 1380);
  return { weekday, openMin, closeMin: Math.min(openMin + 60, 1440), key: rowKey() };
}

const sortedHours = (hours: VoiceSegment[]) =>
  hours
    .map(({ weekday, openMin, closeMin }) => ({ weekday, openMin, closeMin }))
    .sort((a, b) => a.weekday - b.weekday || a.openMin - b.openMin || a.closeMin - b.closeMin);

const sortedClosures = (closures: VoiceClosure[]) =>
  closures.map(({ date, note }) => ({ date, note: note.trim() })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const integer = (text: string) => (/^[0-9]{1,6}$/.test(text.trim()) ? Number(text.trim()) : null);

export const retentionMax = (recordingMode: string, limits: VoiceLimits) =>
  recordingMode === "full" ? limits.retentionDaysMaxFull : limits.retentionDaysMax;

/**
 * The M3 body: only the fields that differ from the saved setup (contract §3.3: a missing field stays as it
 * is; hours and closures, when sent, replace the whole list).
 */
export function setupChanges(setup: VoiceSetup, draft: SetupDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (draft.name.trim() !== setup.name) body.name = draft.name.trim();
  if (draft.greeting.trim() !== setup.greeting) body.greeting = draft.greeting.trim();
  const hours = sortedHours(draft.hours);
  if (JSON.stringify(hours) !== JSON.stringify(sortedHours(setup.hours))) body.hours = hours;
  const closures = sortedClosures(draft.closures);
  if (JSON.stringify(closures) !== JSON.stringify(sortedClosures(setup.closures))) body.closures = closures;
  if (draft.afterHoursMode !== setup.afterHoursMode) body.afterHoursMode = draft.afterHoursMode;
  if (draft.askCallback !== setup.askCallback) body.askCallback = draft.askCallback;
  const seconds = integer(draft.maxMessageSeconds);
  if (seconds !== setup.maxMessageSeconds) body.maxMessageSeconds = seconds ?? draft.maxMessageSeconds;
  if (draft.recordingMode !== setup.recordingMode) body.recordingMode = draft.recordingMode;
  const days = integer(draft.retentionDays);
  if (days !== setup.retentionDays) body.retentionDays = days ?? draft.retentionDays;
  return body;
}

export type SegmentProblem = "order" | "overlap";
export type ClosureProblem = "date" | "duplicate" | "note_long" | "note_unsafe";

export type SetupProblems = {
  name: TextProblem;
  greeting: TextProblem;
  /** The opening (notice + name + greeting) is over the 15-second limit. */
  opening: boolean;
  segments: Map<number, SegmentProblem>;
  /** Weekdays with more ranges than limits.hoursSegmentsPerDay. */
  crowdedDays: Set<number>;
  closures: Map<number, ClosureProblem>;
  tooManyClosures: boolean;
  maxMessageSeconds: boolean;
  recordingMode: boolean;
  retentionDays: "invalid" | "over" | null;
  any: boolean;
};

const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** A real calendar date in YYYY-MM-DD (2026-02-30 is not). */
export function isDate(value: string) {
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/**
 * The checks of contract §3.3 (name per amendment A1: required, up to limits.storeNameChars characters not
 * counting spaces). `savedRecordingMode` is what the store has now: "full" can only be kept, never chosen.
 */
export function setupProblems(
  draft: SetupDraft,
  disclosure: string,
  limits: VoiceLimits,
  savedRecordingMode: string,
): SetupProblems {
  const unsafeName = lineProblem(draft.name, Number.MAX_SAFE_INTEGER, true);
  const name: TextProblem = unsafeName ?? (nonSpace(draft.name.trim()) > limits.storeNameChars ? "long" : null);
  const greeting = lineProblem(draft.greeting, limits.greetingChars, false);
  const opening = !openingInfo(disclosure, draft.name, draft.greeting, limits).ok;

  const segments = new Map<number, SegmentProblem>();
  const crowdedDays = new Set<number>();
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const day = draft.hours.filter((segment) => segment.weekday === weekday);
    if (day.length > limits.hoursSegmentsPerDay) crowdedDays.add(weekday);
    for (const segment of day) if (segment.openMin >= segment.closeMin) segments.set(segment.key, "order");
    const ordered = day.filter((segment) => !segments.has(segment.key));
    for (const a of ordered)
      for (const b of ordered)
        if (a.key !== b.key && a.openMin < b.closeMin && b.openMin < a.closeMin) segments.set(a.key, "overlap");
  }

  const closures = new Map<number, ClosureProblem>();
  const seen = new Set<string>();
  for (const closure of draft.closures) {
    const note = lineProblem(closure.note, limits.closureNoteChars, false);
    if (!isDate(closure.date)) closures.set(closure.key, "date");
    else if (seen.has(closure.date)) closures.set(closure.key, "duplicate");
    else if (note === "unsafe") closures.set(closure.key, "note_unsafe");
    else if (note === "long") closures.set(closure.key, "note_long");
    seen.add(closure.date);
  }
  const tooManyClosures = draft.closures.length > limits.closuresMax;

  const seconds = integer(draft.maxMessageSeconds);
  const maxMessageSeconds =
    seconds === null || seconds < limits.maxMessageSecondsMin || seconds > limits.maxMessageSecondsMax;
  const recordingMode =
    !(RECORDING_MODES as readonly string[]).includes(draft.recordingMode) ||
    (draft.recordingMode === "full" && savedRecordingMode !== "full");
  const days = integer(draft.retentionDays);
  const retentionDays =
    days === null || days < 1 ? "invalid" : days > retentionMax(draft.recordingMode, limits) ? "over" : null;

  const any =
    name !== null ||
    greeting !== null ||
    opening ||
    segments.size > 0 ||
    crowdedDays.size > 0 ||
    closures.size > 0 ||
    tooManyClosures ||
    maxMessageSeconds ||
    recordingMode ||
    retentionDays !== null ||
    !(AFTER_HOURS_MODES as readonly string[]).includes(draft.afterHoursMode) ||
    !(ASK_CALLBACK as readonly string[]).includes(draft.askCallback);
  return {
    name,
    greeting,
    opening,
    segments,
    crowdedDays,
    closures,
    tooManyClosures,
    maxMessageSeconds,
    recordingMode,
    retentionDays,
    any,
  };
}

/** The error codes a merchant page can get (contract §9); the {n} values come from `limits` when known. */
export function voiceErrorText(error: unknown, locale: "en" | "zh", limits?: VoiceLimits): string {
  const zh = locale === "zh";
  const code = error instanceof PortalError ? error.code : "";
  const status = error instanceof PortalError ? error.status : 0;
  const greetingChars = limits?.greetingChars ?? 40;
  const seconds = limits?.openingSecondsMax ?? 15;
  const kbChars = (limits?.kbCharsMax ?? 6000).toLocaleString("en-US");
  const text: Record<string, [string, string]> = {
    voice_store_not_found: ["Phone agent is not set up for this account.", "這個帳號沒有開通電話客服。"],
    password_change_required: [
      "Change the temporary password we gave you under Security before editing or trying a call.",
      "請先到「安全性」變更我們發給你的臨時密碼，再修改設定或試打。",
    ],
    recording_mode_forbidden: ["Whole-call recording must be enabled by us.", "全程錄音需要由我們開通。"],
    store_suspended: [
      "Phone agent is suspended for this store; it is read-only.",
      "這家店的電話客服已暫停，目前只能查看。",
    ],
    greeting_too_long: [`The greeting can be up to ${greetingChars} characters.`, `開場白最多 ${greetingChars} 字。`],
    opening_too_long: [
      `The opening is longer than ${seconds} seconds. Shorten the greeting.`,
      `開場超過 ${seconds} 秒，請縮短開場白。`,
    ],
    kb_too_large: [
      `The store description and all questions together can be up to ${kbChars} characters.`,
      `店家介紹加上所有問答最多 ${kbChars} 字。`,
    ],
    kb_empty: [
      "There is nothing to apply yet. Add a store description or a question first.",
      "還沒有任何內容。請先填店家介紹或新增問答。",
    ],
    hours_invalid: ["Check the business hours.", "營業時間有誤，請檢查時段。"],
    closures_invalid: ["Check the special closures.", "特殊休假日有誤，請檢查日期。"],
    retention_exceeds_limit: ["The retention period is over the limit.", "保存天數超過上限。"],
    not_published: [
      'Nothing is applied yet. Use "Save and apply" on Setup first.',
      "還沒有套用任何版本。請先到「設定」按「儲存並套用」。",
    ],
    voice_publish_limit: [
      "You have applied many new versions in the last 24 hours. Try again later.",
      "最近 24 小時套用太多次了，請稍後再試。",
    ],
  };
  if (text[code]) return text[code][zh ? 1 : 0];
  if (code === "invalid_input" && status === 413) return zh ? "內容太大。" : "The content is too large.";
  return portalErrorText(error, locale);
}

/** Counts of the M11 warnings the setup page explains (contract §8.2). */
export function warningCounts(warnings: VoiceWarning[] | undefined) {
  const list = Array.isArray(warnings) ? warnings : [];
  return {
    placeholders: list.filter((warning) => warning.code === "placeholder_unfilled").length,
    hoursEmpty: list.some((warning) => warning.code === "hours_empty"),
  };
}
