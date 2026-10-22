import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPortal } from "../components/account-portal";
import { AccountVoiceSetup } from "../components/account-voice-setup";
import { LocaleProvider } from "../components/locale-provider";
import { PortalError } from "../lib/portal-client";
import {
  AFTER_HOURS_MODES,
  ASK_CALLBACK,
  INDUSTRIES,
  RECORDING_MODES,
  draftFromSetup,
  estimateSeconds,
  isDate,
  minuteText,
  nonSpace,
  openingInfo,
  openingText,
  setupChanges,
  setupProblems,
  timeChoices,
  voiceErrorText,
  type VoiceSetup,
} from "../lib/voice-setup";

// ---------------------------------------------------------------------------------------------------------------
// A stand-in for the T4 backend, written from phase1-contract §1, §3.1-§3.3, §3.10, §3.11 and amendment A1
// (store name up to 20 characters, not counting spaces). It does not use lib/voice-setup.ts, so a page that sends
// something the backend would refuse gets the backend's answer here too.
// ---------------------------------------------------------------------------------------------------------------

const LIMITS = {
  storeNameChars: 20, greetingChars: 40, openingNonSpaceMax: 67, openingSecondsMax: 15, charsPerSecond: 4.5,
  questionChars: 100, variantChars: 50, variantsMax: 10, faqChars: 400, kbCharsMax: 6000, faqMax: 120,
  csvBodyBytes: 196608, hoursSegmentsPerDay: 4, closuresMax: 60, closureNoteChars: 40, maxMessageSecondsMin: 60,
  maxMessageSecondsMax: 180, retentionDaysMax: 90, retentionDaysMaxFull: 30, tryLimit: 20, tryWindowHours: 24,
  ticketTtlSeconds: 900,
};
/** server/voice_templates/disclosure_draft0.txt without its draft-marker line (30 characters without spaces). */
const DISCLOSURE = "您好，這裡是{{SHOP_NAME}}，由 AI 語音助理接聽，通話可能錄音，以便回覆您。";
const STORE_ID = "a".repeat(32);
const customer = { id: "cust-1", email: "clinic@example.test", name: "Clinic", role: "customer" };

type Segment = { weekday: number; openMin: number; closeMin: number };
type Closure = { date: string; note: string };
type MockSetup = {
  name: string; industry: string; templateId: string | null; status: string; greeting: string; introText: string;
  hours: Segment[]; closures: Closure[]; afterHoursMode: string; askCallback: string; maxMessageSeconds: number;
  handoffMode: string; recordingMode: string; retentionDays: number; aiAnswerEnabled: boolean; updatedAt: string;
};

const baseSetup = (): MockSetup => ({
  name: "晴光牙醫診所", industry: "clinic", templateId: "clinic", status: "draft",
  greeting: "請問有什麼可以幫您？", introText: "診所在台北市大安區。",
  hours: [{ weekday: 0, openMin: 540, closeMin: 720 }, { weekday: 0, openMin: 840, closeMin: 1080 }],
  closures: [{ date: "2026-12-25", note: "院內訓練" }],
  afterHoursMode: "answer_and_message", askCallback: "auto", maxMessageSeconds: 120, handoffMode: "callback",
  recordingMode: "message_only", retentionDays: 90, aiAnswerEnabled: false, updatedAt: "2026-11-01T01:58:00Z",
});

const TEMPLATE = {
  available: true, templateId: "clinic", title: { zh: "診所", en: "Clinic" },
  greetingExample: "請問要掛號，還是有其他問題呢？",
  hoursExample: [
    { weekday: 1, openMin: 540, closeMin: 720 },
    { weekday: 3, openMin: 540, closeMin: 720 },
    { weekday: 5, openMin: 540, closeMin: 750 },
  ],
};

// Contract §1.4: not \s, because Python and JavaScript disagree on it. Same set as server/voice_compile.py.
const countNonSpace = (text: string) => [...text.replace(/[ \t\n\r\u00a0\u3000]/g, "")].length;
const PLACEHOLDER = /（請填入(?:：[^）\n]{1,20})?）/;
// server/support.py text_value: controls, bidi, invisible characters; single-line fields also refuse \t\r\n.
// eslint-disable-next-line no-control-regex
const UNSAFE_LINE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\u061c]/;

type BackendOptions = {
  setup?: Partial<MockSetup>;
  template?: unknown;
  currentVersion?: number | null;
  passwordChangeRequired?: boolean;
  faqCount?: number;
  faqPlaceholders?: number;
  /** Answer "METHOD /path" with this instead of the stand-in (undefined falls through to the stand-in). */
  override?: Record<string, () => Response | Promise<Response> | undefined>;
};

type Call = { method: string; path: string; body: unknown; contentType: string | null };

class Refusal extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function voiceBackend(options: BackendOptions = {}) {
  const state = {
    setup: { ...baseSetup(), ...options.setup },
    template: options.template ?? TEMPLATE,
    currentVersion: options.currentVersion === undefined ? 2 : options.currentVersion,
    maxVersion: options.currentVersion === undefined ? 2 : (options.currentVersion ?? 0),
    published: "",
    passwordChangeRequired: options.passwordChangeRequired ?? false,
    faqCount: options.faqCount ?? 12,
    faqPlaceholders: options.faqPlaceholders ?? 0,
  };
  const snapshot = () => JSON.stringify({ ...state.setup, updatedAt: "" });
  if (state.currentVersion !== null) state.published = snapshot();
  const calls: Call[] = [];

  const opening = (name: string, greeting: string) => {
    const text = DISCLOSURE.split("{{SHOP_NAME}}").join(name) + greeting;
    const count = countNonSpace(text);
    return { text, nonSpace: count, estSeconds: Math.round((count / 4.5) * 10) / 10, ok: count <= 67 };
  };
  const m2 = () => ({
    setup: structuredClone(state.setup),
    opening: opening(state.setup.name, state.setup.greeting),
    disclosure: { template: DISCLOSURE, version: "draft-0" },
    template: state.template,
    limits: LIMITS,
  });
  const m1 = () => ({
    store: {
      id: STORE_ID, name: state.setup.name, industry: state.setup.industry, templateId: state.setup.templateId,
      status: state.setup.status, currentVersion: state.currentVersion,
      publishedAt: state.currentVersion === null ? null : "2026-11-01T02:00:00Z",
      hasUnpublishedChanges: state.currentVersion === null || snapshot() !== state.published,
      faqCount: state.faqCount, kbChars: 2875, aiAnswerEnabled: state.setup.aiAnswerEnabled, updatedAt: state.setup.updatedAt,
    },
    account: { passwordChangeRequired: state.passwordChangeRequired },
    try: { available: true, limit: 20, windowHours: 24, used: 3, remaining: 17, lastIssuedAt: null },
    limits: LIMITS,
  });

  const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
  const line = (value: unknown, max: number, required: boolean, tooLong = "invalid_input") => {
    if (typeof value !== "string" || UNSAFE_LINE.test(value)) throw new Refusal(400, "invalid_input");
    const text = value.trim();
    if (required && !text) throw new Refusal(400, "invalid_input");
    if ([...text].length > max) throw new Refusal(400, tooLong);
    return text;
  };

  /** M3 checks in the contract's order (§3.3); the first failure wins. Unknown keys are ignored. */
  function writeSetup(body: Record<string, unknown>) {
    const next = { ...state.setup };
    if ("name" in body) {
      const name = line(body.name, Number.MAX_SAFE_INTEGER, true);
      if (countNonSpace(name) > LIMITS.storeNameChars) throw new Refusal(400, "invalid_input");
      next.name = name;
    }
    if ("greeting" in body) next.greeting = line(body.greeting, LIMITS.greetingChars, false, "greeting_too_long");
    if ("hours" in body) {
      const hours = body.hours;
      if (!Array.isArray(hours) || hours.length > 28) throw new Refusal(400, "hours_invalid");
      for (const item of hours) {
        const ok =
          item && typeof item === "object" && isInt(item.weekday) && item.weekday >= 0 && item.weekday <= 6 &&
          isInt(item.openMin) && item.openMin >= 0 && item.openMin <= 1439 && isInt(item.closeMin) &&
          item.closeMin >= 1 && item.closeMin <= 1440 && item.openMin < item.closeMin;
        if (!ok) throw new Refusal(400, "hours_invalid");
      }
      for (let day = 0; day < 7; day += 1) {
        const list = (hours as Segment[]).filter((item) => item.weekday === day);
        if (list.length > 4) throw new Refusal(400, "hours_invalid");
        for (const a of list)
          for (const b of list) if (a !== b && a.openMin < b.closeMin && b.openMin < a.closeMin) throw new Refusal(400, "hours_invalid");
      }
      next.hours = (hours as Segment[]).map(({ weekday, openMin, closeMin }) => ({ weekday, openMin, closeMin }))
        .sort((a, b) => a.weekday - b.weekday || a.openMin - b.openMin);
    }
    if ("closures" in body) {
      const closures = body.closures;
      if (!Array.isArray(closures) || closures.length > 60) throw new Refusal(400, "closures_invalid");
      const dates = new Set<string>();
      for (const item of closures) {
        if (!item || typeof item.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || dates.has(item.date))
          throw new Refusal(400, "closures_invalid");
        const parsed = new Date(`${item.date}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== item.date) throw new Refusal(400, "closures_invalid");
        try {
          line(item.note, 40, false);
        } catch {
          throw new Refusal(400, "closures_invalid");
        }
        dates.add(item.date);
      }
      next.closures = (closures as Closure[]).map(({ date, note }) => ({ date, note: note.trim() })).sort((a, b) => a.date.localeCompare(b.date));
    }
    if ("afterHoursMode" in body) {
      if (!["answer_and_message", "message_only"].includes(body.afterHoursMode as string)) throw new Refusal(400, "invalid_input");
      next.afterHoursMode = body.afterHoursMode as string;
    }
    if ("askCallback" in body) {
      if (!["auto", "always", "never"].includes(body.askCallback as string)) throw new Refusal(400, "invalid_input");
      next.askCallback = body.askCallback as string;
    }
    if ("maxMessageSeconds" in body) {
      const value = body.maxMessageSeconds;
      if (!isInt(value) || value < 60 || value > 180) throw new Refusal(400, "invalid_input");
      next.maxMessageSeconds = value;
    }
    if ("recordingMode" in body) {
      const value = body.recordingMode;
      if (value === "full" && state.setup.recordingMode !== "full") throw new Refusal(403, "recording_mode_forbidden");
      if (!["off", "message_only", "full"].includes(value as string)) throw new Refusal(400, "invalid_input");
      next.recordingMode = value as string;
    }
    if ("retentionDays" in body) {
      const value = body.retentionDays;
      if (!isInt(value) || value < 1) throw new Refusal(400, "invalid_input");
      if (value > (next.recordingMode === "full" ? 30 : 90)) throw new Refusal(400, "retention_exceeds_limit");
      next.retentionDays = value;
    }
    if (!opening(next.name, next.greeting).ok) throw new Refusal(400, "opening_too_long");
    const changed = (Object.keys(next) as (keyof MockSetup)[]).filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(state.setup[key]),
    );
    state.setup = { ...next, updatedAt: changed.length ? "2026-11-01T03:00:00Z" : state.setup.updatedAt };
    return { ...m2(), changed };
  }

  function publish() {
    if (!state.setup.introText.trim() && state.faqCount === 0) throw new Refusal(409, "kb_empty");
    if (!opening(state.setup.name, state.setup.greeting).ok) throw new Refusal(409, "opening_too_long");
    if (state.currentVersion !== null && snapshot() === state.published)
      return { changed: false, version: state.currentVersion, configSha256: "0".repeat(64), publishedAt: "2026-11-01T02:00:00Z", warnings: [] };
    state.maxVersion += 1;
    state.currentVersion = state.maxVersion;
    state.published = snapshot();
    const warnings = [
      ...(PLACEHOLDER.test(state.setup.introText) ? [{ code: "placeholder_unfilled", field: "intro", faq_id: null }] : []),
      ...Array.from({ length: state.faqPlaceholders }, (_, index) => ({
        code: "placeholder_unfilled", field: "faq", faq_id: String(index).padStart(32, "f"),
      })),
      ...(state.setup.hours.length ? [] : [{ code: "hours_empty", field: null, faq_id: null }]),
    ];
    return { changed: true, version: state.currentVersion, configSha256: "1".repeat(64), publishedAt: "2026-11-01T03:00:00Z", warnings };
  }

  /** §3.10: the saved draft compiled as the next version; store text loses its 【】 brackets (amendment A2). */
  function preview() {
    if (!state.setup.introText.trim() && state.faqCount === 0)
      return { basedOnVersion: state.currentVersion, nextVersion: state.maxVersion + 1, config: null, configSha256: null, hasUnpublishedChanges: true, problems: [{ code: "kb_empty", detail: "Nothing to compile." }] };
    const quoted = state.setup.name.replace(/[【〖「]/g, "『").replace(/[】〗」]/g, "』");
    const intro = state.setup.introText.replace(/[【〖]/g, "「").replace(/[】〗]/g, "」");
    return {
      basedOnVersion: state.currentVersion, nextVersion: state.maxVersion + 1,
      config: { schema: "voice.store-config/v1", version: state.maxVersion + 1, prompt: { prefix: `你是「${quoted}」的電話客服。\n\n【店家資料】\n${intro}` } },
      configSha256: "2".repeat(64), hasUnpublishedChanges: true, problems: [],
    };
  }

  const json = (value: unknown, status = 200) => Response.json(value, { status });
  const refuse = (status: number, error: string) => json({ error, detail: "Refused by the stand-in backend." }, status);
  /** §1.1 for every write: JSON body (415/413/400), then the temporary password, then suspension, then the route. */
  function write(init: RequestInit | undefined, limit: number, handler: (body: Record<string, unknown>) => unknown) {
    const headers = new Headers(init?.headers);
    if (headers.get("Content-Type") !== "application/json" || typeof init?.body !== "string") return refuse(415, "invalid_input");
    if (new TextEncoder().encode(init.body).length > limit) return refuse(413, "invalid_input");
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return refuse(400, "invalid_input");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "invalid_input");
    if (state.passwordChangeRequired) return refuse(403, "password_change_required");
    if (state.setup.status === "suspended") return refuse(409, "store_suspended");
    try {
      return json(handler(body as Record<string, unknown>));
    } catch (cause) {
      if (cause instanceof Refusal) return refuse(cause.status, cause.code);
      throw cause;
    }
  }

  const routes: Record<string, (init?: RequestInit) => Response> = {
    "GET /session": () => json({ user: customer }),
    "GET /me/voice": () => json(m1()),
    "GET /me/voice/setup": () => json(m2()),
    "POST /me/voice/setup": (init) => write(init, 65536, writeSetup),
    "POST /me/voice/publish": (init) => write(init, 65536, publish),
    "GET /me/voice/preview": () => json(preview()),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("/api/portal", "");
      const method = init?.method ?? "GET";
      let body: unknown;
      try {
        body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      } catch {
        body = init?.body;
      }
      calls.push({ method, path, body, contentType: new Headers(init?.headers).get("Content-Type") });
      const key = `${method} ${path}`;
      const answer = options.override?.[key]?.();
      if (answer) return answer;
      return routes[key]?.(init) ?? refuse(404, "not_found");
    }),
  );
  return { state, calls, m1 };
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");
const wrap = (node: React.ReactNode) => render(<LocaleProvider>{node}</LocaleProvider>);

/** Renders the setup page alone with an M1 summary from the same stand-in backend. */
async function renderSetup(options: BackendOptions = {}) {
  const backend = voiceBackend(options);
  const onChanged = vi.fn();
  wrap(<AccountVoiceSetup summary={backend.m1() as never} onChanged={onChanged} />);
  await screen.findByRole("textbox", { name: /Store name|店名/ });
  return { ...backend, onChanged, user: userEvent.setup() };
}

const nameBox = () => screen.getByRole("textbox", { name: "Store name" });
const greetingBox = () => screen.getByRole("textbox", { name: "Greeting" });
const saveButton = () => screen.getByRole("button", { name: "Save" });
const applyButton = () => screen.getByRole("button", { name: "Save and apply" });
const openingPreview = () => document.querySelector("[data-voice-opening]");
const setValue = (element: Element, value: string) => fireEvent.change(element, { target: { value } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("setup page: loading", () => {
  it("shows the saved setup, the full opening and its length", async () => {
    await renderSetup();
    expect(screen.getByRole("heading", { level: 2, name: "Setup" })).toBeVisible();
    expect(nameBox()).toHaveValue("晴光牙醫診所");
    expect(greetingBox()).toHaveValue("請問有什麼可以幫您？");
    expect(screen.getByText("Industry: Clinic")).toBeVisible();
    // 30 (notice) + 6 (name) + 10 (greeting) = 46 characters = 10.2 s (amendment A3).
    expect(openingPreview()).toHaveTextContent("您好，這裡是晴光牙醫診所，由 AI 語音助理接聽，通話可能錄音，以便回覆您。請問有什麼可以幫您？");
    expect(screen.getByText("About 10.2 s (limit 15 s)")).toBeVisible();
    expect(screen.getByText(/^Greeting characters left: 21 /)).toBeVisible();
    expect(screen.getByText("10 / 40 characters")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Mon range 1 from" })).toHaveValue("540");
    expect(screen.getByRole("combobox", { name: "Mon range 2 to" })).toHaveValue("1080");
    expect(screen.getAllByText("Closed")).toHaveLength(6);
    expect(screen.getByLabelText("Date of closure 1")).toHaveValue("2026-12-25");
    expect(screen.getByLabelText("Note for closure 1 (optional)")).toHaveValue("院內訓練");
    expect(screen.getByRole("radio", { name: /^Answer questions/ })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Ask for a callback number" })).toHaveValue("auto");
    expect(screen.getByRole("spinbutton", { name: "Maximum message length in seconds" })).toHaveValue(120);
    expect(screen.getByRole("radio", { name: "Record messages only (recommended)" })).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Days to keep recordings" })).toHaveValue(90);
    expect(screen.getByText("Up to 90 days; you can only shorten it.")).toBeVisible();
    expect(screen.getByText(/^AI answers: not turned on yet/)).toBeVisible();
    // Nothing is edited yet: Save has nothing to send, Save and apply can still apply the saved draft.
    expect(saveButton()).toBeDisabled();
    expect(applyButton()).toBeEnabled();
  });

  it("explains an account without a store", async () => {
    const backend = voiceBackend({
      override: { "GET /me/voice/setup": () => Response.json({ error: "voice_store_not_found", detail: "x" }, { status: 404 }) },
    });
    wrap(<AccountVoiceSetup summary={backend.m1() as never} onChanged={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Phone agent is not set up for this account.");
    expect(screen.getByRole("heading", { level: 2, name: "Setup" })).toBeVisible();
  });

  it("retries a failed load", async () => {
    let failures = 1;
    const backend = voiceBackend({
      override: {
        "GET /me/voice/setup": () =>
          failures-- > 0 ? Response.json({ error: "service_unavailable", detail: "x" }, { status: 503 }) : undefined,
      },
    });
    const user = userEvent.setup();
    wrap(<AccountVoiceSetup summary={backend.m1() as never} onChanged={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/);
    expect(screen.queryByRole("textbox", { name: "Store name" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("textbox", { name: "Store name" })).toHaveValue("晴光牙醫診所");
    expect(backend.calls.filter((call) => call.path === "/me/voice/setup")).toHaveLength(2);
  });

  it("treats a body that is not M2 as a failure", async () => {
    const backend = voiceBackend({ override: { "GET /me/voice/setup": () => Response.json({ keys: [] }) } });
    wrap(<AccountVoiceSetup summary={backend.m1() as never} onChanged={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});

describe("setup page: opening", () => {
  it("updates the preview, the counts and the seconds while typing", async () => {
    const { user } = await renderSetup();
    await user.clear(greetingBox());
    await user.type(greetingBox(), "您好");
    expect(openingPreview()).toHaveTextContent(/以便回覆您。您好$/);
    expect(screen.getByText("2 / 40 characters")).toBeVisible();
    // 30 + 6 + 2 = 38 characters = 8.4 s; 67 - 38 = 29 left.
    expect(screen.getByText("About 8.4 s (limit 15 s)")).toBeVisible();
    expect(screen.getByText(/^Greeting characters left: 29 /)).toBeVisible();
    await user.clear(nameBox());
    await user.type(nameBox(), "晴光 牙醫");
    // Spaces do not count (contract §1.4): 30 + 4 + 2 = 36.
    expect(openingPreview()).toHaveTextContent(/^您好，這裡是晴光 牙醫，/);
    expect(screen.getByText(/^Greeting characters left: 31 /)).toBeVisible();
    expect(saveButton()).toBeEnabled();
  });

  it("blocks saving past 15 seconds and says which field to shorten (A1)", async () => {
    const { user, calls } = await renderSetup();
    // 30 + 6 + 31 = 67 characters: exactly the limit, still allowed.
    setValue(greetingBox(), "一".repeat(31));
    expect(screen.getByText(/^Greeting characters left: 0 /)).toBeVisible();
    expect(screen.getByText("About 14.9 s (limit 15 s)")).toBeVisible();
    expect(screen.queryByText(/The opening is too long/)).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    // One more character is over.
    setValue(greetingBox(), "一".repeat(32));
    expect(screen.getByText("About 15.1 s (limit 15 s)")).toBeVisible();
    // Verifier finding 2026-10-22: say how many characters to remove; the greeting counter alone reads 32 / 40.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The opening is too long (about 15.1 s). Remove 1 more character from the greeting or store name to save.",
    );
    expect(screen.getByText("The opening is longer than 15 seconds: remove 1 more character from the greeting or store name (spaces not counted).")).toBeVisible();
    setValue(greetingBox(), "一".repeat(35));
    expect(screen.getByRole("alert")).toHaveTextContent("Remove 4 more characters from the greeting or store name to save.");
    // A name that is over on its own: only the name can fix it.
    setValue(greetingBox(), "");
    setValue(nameBox(), "一".repeat(20) + " " + "一".repeat(18));
    expect(screen.getByText(/^The opening is longer than 15 seconds: remove 1 more character from the store name/)).toBeVisible();
    setValue(nameBox(), "晴光牙醫診所");
    setValue(greetingBox(), "一".repeat(32));
    expect(saveButton()).toBeDisabled();
    expect(applyButton()).toBeDisabled();
    await user.click(applyButton());
    expect(writes(calls)).toEqual([]);
  });

  it("checks the store name: required, and up to 20 characters without spaces (A1)", async () => {
    await renderSetup();
    setValue(nameBox(), "  ");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a store name.");
    expect(saveButton()).toBeDisabled();
    // 20 characters plus spaces is fine; 21 is not.
    setValue(nameBox(), "一二三四五 六七八九十 一二三四五 六七八九十");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    setValue(nameBox(), "一".repeat(21));
    expect(screen.getByRole("alert")).toHaveTextContent("The store name can be up to 20 characters, not counting spaces.");
    expect(saveButton()).toBeDisabled();
    setValue(nameBox(), "晴光\u200b牙醫");
    expect(screen.getByRole("alert")).toHaveTextContent(/store name contains a control or hidden character/);
  });

  it("refuses a greeting over 40 characters with the greeting_too_long copy", async () => {
    await renderSetup();
    setValue(greetingBox(), "a ".repeat(20) + "b");
    expect(screen.getByText("41 / 40 characters")).toBeVisible();
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("The greeting can be up to 40 characters.");
    expect(saveButton()).toBeDisabled();
  });

  it("fills in the template greeting, and hides the template buttons when there is no template", async () => {
    const { user } = await renderSetup();
    await user.click(screen.getByRole("button", { name: "Use the template greeting" }));
    expect(greetingBox()).toHaveValue("請問要掛號，還是有其他問題呢？");
    expect(openingPreview()).toHaveTextContent(/以便回覆您。請問要掛號，還是有其他問題呢？$/);
  });

  it("has no template buttons for an industry without a template", async () => {
    await renderSetup({ setup: { industry: "other", templateId: null }, template: { available: false } });
    expect(screen.getByText("Industry: Other")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Use the template greeting" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use the template hours" })).not.toBeInTheDocument();
  });
});

describe("setup page: business hours and closures", () => {
  it("adds several ranges a day and saves them as one sorted list", async () => {
    const { user, calls, onChanged } = await renderSetup({ setup: { hours: [] } });
    expect(screen.getAllByText("Closed")).toHaveLength(7);
    await user.click(screen.getByRole("button", { name: "+ Add hours (Tue)" }));
    await user.click(screen.getByRole("button", { name: "+ Add hours (Tue)" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Tue range 1 to" }), "720");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tue range 2 from" }), "840");
    await user.selectOptions(screen.getByRole("combobox", { name: "Tue range 2 to" }), "1440");
    expect(screen.getByRole("combobox", { name: "Tue range 2 to" })).toHaveDisplayValue("24:00");
    await user.click(screen.getByRole("button", { name: "+ Add hours (Mon)" }));
    await user.click(saveButton());
    expect(await screen.findByText('Saved. Use "Save and apply" so test calls use it.')).toBeVisible();
    expect(writes(calls)).toEqual([
      {
        method: "POST",
        path: "/me/voice/setup",
        contentType: "application/json",
        body: {
          hours: [
            { weekday: 0, openMin: 540, closeMin: 1080 },
            { weekday: 1, openMin: 540, closeMin: 720 },
            { weekday: 1, openMin: 840, closeMin: 1440 },
          ],
        },
      },
    ]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Closed")).toHaveLength(5);
    expect(saveButton()).toBeDisabled();
  });

  it("blocks an end before the start, overlapping ranges, and a fifth range", async () => {
    const { user, calls } = await renderSetup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Mon range 1 to" }), "480");
    expect(screen.getByRole("alert")).toHaveTextContent("The end time must be later than the start time.");
    expect(saveButton()).toBeDisabled();
    expect(applyButton()).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Mon range 1 to" }), "900");
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      "Hours on the same day cannot overlap.",
      "Hours on the same day cannot overlap.",
    ]);
    expect(saveButton()).toBeDisabled();
    // Touching ranges are fine (contract §3.3).
    await user.selectOptions(screen.getByRole("combobox", { name: "Mon range 1 to" }), "840");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "+ Add hours (Mon)" }));
    await user.click(screen.getByRole("button", { name: "+ Add hours (Mon)" }));
    expect(screen.getByRole("button", { name: "+ Add hours (Mon)" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove Mon range 4" }));
    expect(screen.getByRole("button", { name: "+ Add hours (Mon)" })).toBeEnabled();
    expect(writes(calls)).toEqual([]);
  });

  it("explains a day that arrives with too many ranges", async () => {
    await renderSetup({
      template: {
        ...TEMPLATE,
        hoursExample: [0, 1, 2, 3, 4].map((index) => ({ weekday: 2, openMin: index * 120, closeMin: index * 120 + 60 })),
      },
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "Use the template hours" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Up to 4 time ranges per day.");
    expect(saveButton()).toBeDisabled();
  });

  it("uses the template hours", async () => {
    const { user, calls } = await renderSetup();
    await user.click(screen.getByRole("button", { name: "Use the template hours" }));
    expect(screen.queryByRole("combobox", { name: "Mon range 1 from" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sat range 1 to" })).toHaveDisplayValue("12:30");
    await user.click(saveButton());
    await screen.findByText(/^Saved\./);
    expect(writes(calls)[0].body).toEqual({ hours: TEMPLATE.hoursExample });
  });

  it("adds, checks and removes special closures", async () => {
    const { user, calls } = await renderSetup();
    await user.click(screen.getByRole("button", { name: "+ Add a closure" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Check the special closures.");
    setValue(screen.getByLabelText("Date of closure 2"), "2026-12-25");
    expect(screen.getByRole("alert")).toHaveTextContent("This date is already listed.");
    setValue(screen.getByLabelText("Date of closure 2"), "2027-01-01");
    setValue(screen.getByLabelText("Note for closure 2 (optional)"), "元".repeat(41));
    expect(screen.getByRole("alert")).toHaveTextContent("Notes can be up to 40 characters.");
    expect(saveButton()).toBeDisabled();
    setValue(screen.getByLabelText("Note for closure 2 (optional)"), " 元旦 ");
    await user.click(screen.getByRole("button", { name: "Remove closure 1" }));
    await user.click(saveButton());
    await screen.findByText(/^Saved\./);
    expect(writes(calls)[0].body).toEqual({ closures: [{ date: "2027-01-01", note: "元旦" }] });
  });

  it("stops adding closures at the limit", async () => {
    const closures = Array.from({ length: 60 }, (_, index) => ({
      date: new Date(Date.UTC(2027, 0, 1 + index)).toISOString().slice(0, 10),
      note: "",
    }));
    await renderSetup({ setup: { closures } });
    expect(screen.getByRole("button", { name: "+ Add a closure" })).toBeDisabled();
  });
});

describe("setup page: radio layout", () => {
  // Verifier finding 2026-10-22: radios inside .portal-field got the text-field rule (width 100%, 43 px tall), so
  // each radio was a full-width row with its text on the next line and the selected dot sat between two options.
  it("keeps every radio out of .portal-field and on one line with its text", async () => {
    await renderSetup();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    for (const radio of radios) {
      expect(radio.closest(".portal-field")).toBeNull();
      expect(radio.closest("label")).toHaveClass("portal-choice");
      expect(radio.closest("fieldset")).toHaveClass("portal-choices");
    }
  });

  it("has CSS that keeps radios and checkboxes at their own size, even inside .portal-field", () => {
    const css = readFileSync(resolve(process.cwd(), "app/portal.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (selector: string) => {
      const found = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((match) =>
        match[1].split(",").map((part) => part.trim()).includes(selector),
      );
      return found ? found[2].replace(/\s+/g, " ") : "";
    };
    for (const selector of ['.portal-field input[type="radio"]', '.portal-field input[type="checkbox"]', ".portal-choice input"]) {
      expect(rule(selector)).toMatch(/width: auto;/);
      expect(rule(selector)).toMatch(/min-height: 0;/);
    }
    expect(rule(".portal-choice")).toMatch(/display: flex;/);
  });
});

describe("setup page: messages, recording and retention", () => {
  it("offers exactly the backend's choices", async () => {
    await renderSetup();
    const radios = (name: string) =>
      screen.getAllByRole("radio").filter((radio) => radio.getAttribute("name") === name).map((radio) => radio.getAttribute("value"));
    expect(radios("voice-after-hours")).toEqual([...AFTER_HOURS_MODES]);
    expect(radios("voice-recording")).toEqual([...RECORDING_MODES]);
    const ask = screen.getByRole("combobox", { name: "Ask for a callback number" });
    expect(within(ask).getAllByRole("option").map((option) => [option.getAttribute("value"), option.textContent])).toEqual([
      ["auto", "When needed"],
      ["always", "Always"],
      ["never", "Never"],
    ]);
    expect(ASK_CALLBACK).toEqual(["auto", "always", "never"]);
  });

  it("lets a store choose not to record or to record messages, but never whole calls", async () => {
    const { user, calls } = await renderSetup();
    const full = screen.getByRole("radio", { name: "Record whole calls (we must enable this)" });
    expect(full).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Do not record" }));
    await user.click(screen.getByRole("radio", { name: "Only take a message; do not answer questions" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Ask for a callback number" }), "always");
    setValue(screen.getByRole("spinbutton", { name: "Maximum message length in seconds" }), "180");
    setValue(screen.getByRole("spinbutton", { name: "Days to keep recordings" }), "30");
    await user.click(saveButton());
    await screen.findByText(/^Saved\./);
    expect(writes(calls)[0].body).toEqual({
      afterHoursMode: "message_only",
      askCallback: "always",
      maxMessageSeconds: 180,
      recordingMode: "off",
      retentionDays: 30,
    });
  });

  it("allows only a retention period up to the limit", async () => {
    await renderSetup();
    const days = screen.getByRole("spinbutton", { name: "Days to keep recordings" });
    expect(days).toHaveAttribute("max", "90");
    setValue(days, "91");
    expect(screen.getByRole("alert")).toHaveTextContent("The retention period is over the limit. (up to 90 days)");
    expect(saveButton()).toBeDisabled();
    setValue(days, "0");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a whole number of days, 1 or more.");
    setValue(days, "89");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("keeps whole-call recording a store already has, with its 30-day limit", async () => {
    await renderSetup({ setup: { recordingMode: "full", retentionDays: 30 } });
    expect(screen.getByRole("radio", { name: "Record whole calls (we must enable this)" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Record whole calls (we must enable this)" })).toBeChecked();
    expect(screen.getByText("Up to 30 days; you can only shorten it.")).toBeVisible();
    setValue(screen.getByRole("spinbutton", { name: "Days to keep recordings" }), "31");
    expect(screen.getByRole("alert")).toHaveTextContent("(up to 30 days)");
    // Recording only messages allows up to 90 days again.
    await userEvent.setup().click(screen.getByRole("radio", { name: "Record messages only (recommended)" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Up to 90 days; you can only shorten it.")).toBeVisible();
  });

  it("checks the message length range", async () => {
    await renderSetup();
    const seconds = screen.getByRole("spinbutton", { name: "Maximum message length in seconds" });
    setValue(seconds, "59");
    expect(screen.getByRole("alert")).toHaveTextContent("Messages must be 60–180 s (whole seconds).");
    setValue(seconds, "181");
    expect(screen.getByRole("alert")).toHaveTextContent("Messages must be 60–180 s");
    setValue(seconds, "60");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows AI answers as on when the store has them", async () => {
    await renderSetup({ setup: { aiAnswerEnabled: true } });
    expect(screen.getByText("AI answers: on.")).toBeVisible();
  });
});

describe("setup page: save and apply", () => {
  // Verifier finding 2026-10-22: the form is disabled while saving, so focus fell to <body>.
  it("moves focus to the result after Save and after Save and apply", async () => {
    const { user } = await renderSetup();
    setValue(greetingBox(), "請問要掛號嗎？");
    await user.click(saveButton());
    const result = await screen.findByRole("region", { name: "Result" });
    await waitFor(() => expect(document.activeElement).toBe(result));
    expect(result).toHaveTextContent('Saved. Use "Save and apply" so test calls use it.');
    await user.click(applyButton());
    expect(await screen.findByText(/^Version 3 is applied\./)).toBeVisible();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("region", { name: "Result" })));
  });

  it("saves only the changed fields, then applies, and reports the warnings", async () => {
    const { user, calls, onChanged } = await renderSetup({
      setup: { introText: "診所電話（請填入：電話）。", hours: [] },
      faqPlaceholders: 2,
    });
    await user.clear(greetingBox());
    await user.type(greetingBox(), "請問要掛號嗎？");
    await user.click(applyButton());
    expect(await screen.findByText(/^Version 3 is applied\./)).toBeVisible();
    expect(screen.getByRole("link", { name: "Try a call" })).toHaveAttribute("href", "/account/voice/try");
    expect(writes(calls)).toEqual([
      { method: "POST", path: "/me/voice/setup", contentType: "application/json", body: { greeting: "請問要掛號嗎？" } },
      { method: "POST", path: "/me/voice/publish", contentType: "application/json", body: {} },
    ]);
    expect(screen.getByText(/^3 places still say "（請填入）"/)).toHaveTextContent(/You can try a call first and fill them in later on FAQ\.$/);
    expect(screen.getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/account/voice/faq");
    expect(screen.getByText("No business hours yet; the AI will treat every call as after hours.")).toBeVisible();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(greetingBox()).toHaveValue("請問要掛號嗎？");
    expect(saveButton()).toBeDisabled();
  });

  it("applies without saving when nothing was edited, and says when nothing changed", async () => {
    const { user, calls } = await renderSetup();
    await user.click(applyButton());
    expect(await screen.findByText("Nothing changed; still version 2.")).toBeVisible();
    expect(writes(calls).map((call) => call.path)).toEqual(["/me/voice/publish"]);
    expect(screen.queryByText(/places still say/)).not.toBeInTheDocument();
  });

  it("applies a first version", async () => {
    const { user } = await renderSetup({ currentVersion: null });
    await user.click(applyButton());
    expect(await screen.findByText(/^Version 1 is applied\./)).toBeVisible();
  });

  it("shows Working… while a request is in flight", async () => {
    let release: (value: Response) => void = () => {};
    const { user } = await renderSetup({
      override: { "POST /me/voice/publish": () => new Promise<Response>((resolve) => (release = resolve)) },
    });
    await user.click(applyButton());
    expect(await screen.findByRole("button", { name: "Working…" })).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(nameBox()).toBeDisabled();
    release(Response.json({ changed: false, version: 2, warnings: [] }));
    expect(await screen.findByText("Nothing changed; still version 2.")).toBeVisible();
    expect(nameBox()).toBeEnabled();
  });

  it("locks the form while the temporary password is unchanged, and says where to change it", async () => {
    // Verifier finding 2026-10-22: the store could type everything, get 403 on save, and lose it on the way to Security.
    const { calls } = await renderSetup({ passwordChangeRequired: true });
    expect(nameBox()).toBeDisabled();
    expect(greetingBox()).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(applyButton()).toBeDisabled();
    const note = document.querySelector("[data-voice-locked]") as HTMLElement;
    expect(note).toHaveTextContent("Change the temporary password we gave you under Security first; then you can edit the setup.");
    expect(within(note).getByRole("link", { name: "Security" })).toHaveAttribute("href", "/account/security");
    expect(writes(calls)).toEqual([]);
  });

  it("says why the form is locked in Chinese", async () => {
    localStorage.setItem("pc-locale", "zh");
    window.history.replaceState({}, "", "/account/voice/setup");
    await renderSetup({ passwordChangeRequired: true });
    expect(document.querySelector("[data-voice-locked]")).toHaveTextContent("請先到「安全性」把我們給你的臨時密碼換掉，才能修改設定。");
  });

  it("links to Security when the backend asks for a password change", async () => {
    // M1 was read before an operator reset the password: the backend still refuses, and says why.
    const refused = () => Response.json({ error: "password_change_required", detail: "x" }, { status: 403 });
    const { user, onChanged } = await renderSetup({ override: { "POST /me/voice/setup": refused } });
    setValue(greetingBox(), "請問要掛號嗎？");
    await user.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Change the temporary password we gave you under Security before editing or trying a call.");
    expect(within(alert).getByRole("link", { name: "Security" })).toHaveAttribute("href", "/account/security");
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Saved\./)).not.toBeInTheDocument();
  });

  it("explains kb_empty from apply, and keeps the save that came before it", async () => {
    const { user, calls, onChanged } = await renderSetup({ setup: { introText: "" }, faqCount: 0 });
    setValue(greetingBox(), "請問要掛號嗎？");
    await user.click(applyButton());
    // One message, not "nothing to apply" next to "Saved. Use Save and apply" (verifier finding 2026-10-22).
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Your settings are saved, but they cannot be applied yet: There is nothing to apply yet. Add a store description or a question on FAQ first.",
    );
    expect(within(alert).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/account/voice/faq");
    expect(screen.queryByText(/^Saved\./)).not.toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(writes(calls).map((call) => call.path)).toEqual(["/me/voice/setup", "/me/voice/publish"]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "hours_invalid", "Check the business hours."],
    [400, "closures_invalid", "Check the special closures."],
    [400, "opening_too_long", "The opening is longer than 15 seconds. Shorten the greeting."],
    [400, "retention_exceeds_limit", "The retention period is over the limit."],
    [403, "recording_mode_forbidden", "Whole-call recording must be enabled by us."],
    [409, "store_suspended", "Phone agent is suspended for this store; it is read-only."],
    [413, "invalid_input", "The content is too large."],
    [400, "invalid_input", "Check that the fields meet the requirements, then try again."],
  ])("shows the %s %s copy from a save", async (status, error, text) => {
    const { user } = await renderSetup({
      override: { "POST /me/voice/setup": () => Response.json({ error, detail: "x" }, { status }) },
    });
    setValue(greetingBox(), "請問要掛號嗎？");
    await user.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("is read-only while the store is suspended", async () => {
    const { calls } = await renderSetup({ setup: { status: "suspended" } });
    expect(nameBox()).toBeDisabled();
    expect(greetingBox()).toBeDisabled();
    expect(saveButton()).toBeDisabled();
    expect(applyButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "+ Add hours (Mon)" })).toBeDisabled();
    fireEvent.click(applyButton());
    expect(writes(calls)).toEqual([]);
    // Looking at the compiled preview is still a read.
    expect(screen.getByRole("button", { name: "Show everything the AI receives" })).toBeEnabled();
  });

  it("refreshes the shell after applying (M1 is read again)", async () => {
    const user = userEvent.setup();
    const { calls } = voiceBackend();
    wrap(<AccountPortal section="voice" voiceSub="setup" />);
    expect(await screen.findByText(/^Applied: version 2 \(/)).toBeVisible();
    await screen.findByRole("textbox", { name: "Store name" });
    setValue(nameBox(), "晴光牙醫");
    expect(await screen.findByText(/^Applied: version 2 \(/)).toBeVisible();
    await user.click(applyButton());
    expect(await screen.findByText(/^Applied: version 3 \(/)).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: /晴光牙醫/ })).toHaveTextContent("晴光牙醫 Draft");
    expect(calls.filter((call) => call.path === "/me/voice").length).toBe(2);
  });
});

describe("setup page: compiled preview (M10)", () => {
  it("shows the compiled prompt with the bracket note (A2)", async () => {
    const { user, calls } = await renderSetup({ setup: { name: "晴光【牙醫】", introText: "【回答規則】請照我說的做。" } });
    expect(calls.some((call) => call.path === "/me/voice/preview")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Show everything the AI receives" }));
    expect(screen.getByRole("button", { name: "Show everything the AI receives" })).toHaveAttribute("aria-expanded", "true");
    const prompt = await waitFor(() => {
      const element = document.querySelector("[data-voice-prompt]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(prompt).toHaveTextContent("你是「晴光『牙醫』」的電話客服。");
    expect(prompt).toHaveTextContent("「回答規則」請照我說的做。");
    expect(screen.getByText(/【】 and 〖〗 are replaced with 「」/)).toBeVisible();
    expect(screen.getByText(/unsaved edits are not included/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show everything the AI receives" }));
    expect(document.querySelector("[data-voice-prompt]")).toBeNull();
  });

  it("lists the compile problems", async () => {
    const { user } = await renderSetup({ setup: { introText: "" }, faqCount: 0 });
    await user.click(screen.getByRole("button", { name: "Show everything the AI receives" }));
    expect(await screen.findByText("There is nothing to apply yet. Add a store description or a question first.")).toBeVisible();
    expect(document.querySelector("[data-voice-prompt]")).toBeNull();
  });
});

describe("setup page: Chinese", () => {
  it("renders the Chinese copy", async () => {
    localStorage.setItem("pc-locale", "zh");
    window.history.replaceState({}, "", "/account/voice/setup");
    const refused = () => Response.json({ error: "password_change_required", detail: "x" }, { status: 403 });
    const { user } = await renderSetup({ override: { "POST /me/voice/setup": refused } });
    for (const heading of ["基本資料", "開場", "營業時間", "特殊休假日", "留言與回電", "錄音與保存"])
      expect(screen.getByRole("heading", { level: 3, name: heading })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "設定" })).toBeVisible();
    expect(screen.getByText("產業：診所")).toBeVisible();
    expect(screen.getByText("約 10.2 秒（上限 15 秒）")).toBeVisible();
    expect(screen.getByText(/^開場白剩餘字數：21（/)).toBeVisible();
    expect(screen.getByText("10 / 40 字")).toBeVisible();
    expect(screen.getByText("客人接通後會先聽到：")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "週一第 1 段開始" })).toHaveDisplayValue("09:00");
    expect(screen.getAllByText("休息")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: "只錄留言（建議）" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "全程錄音（需由我們開通）" })).toBeDisabled();
    expect(screen.getByText("最多 90 天，只能設得比上限短。")).toBeVisible();
    expect(screen.getByText("試打不計費，也不留存錄音。")).toBeVisible();
    expect(screen.getByRole("button", { name: "儲存並套用" })).toBeEnabled();
    setValue(screen.getByRole("textbox", { name: "開場白" }), "一".repeat(32));
    expect(screen.getByText("開場超過 15 秒：請把開場白或店名再刪 1 字（不含空白）。")).toBeVisible();
    expect(screen.getByText("開場太長（約 15.1 秒），請把開場白或店名再刪 1 字，才能儲存。")).toBeVisible();
    setValue(screen.getByRole("textbox", { name: "開場白" }), "請問要掛號嗎？");
    await user.click(screen.getByRole("button", { name: "儲存" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("請先到「安全性」變更我們發給你的臨時密碼，再修改設定或試打。");
    expect(within(alert).getByRole("link", { name: "安全性" })).toHaveAttribute("href", "/account/security");
  });

  it("reports an applied version in Chinese", async () => {
    localStorage.setItem("pc-locale", "zh");
    window.history.replaceState({}, "", "/account/voice/setup");
    const { user } = await renderSetup({ setup: { hours: [] } });
    setValue(screen.getByRole("textbox", { name: "開場白" }), "請問要掛號嗎？");
    await user.click(screen.getByRole("button", { name: "儲存並套用" }));
    expect(await screen.findByText(/^已套用第 3 版，可以到「/)).toBeVisible();
    expect(screen.getByRole("link", { name: "試打一通" })).toHaveAttribute("href", "/account/voice/try");
    expect(screen.getByText("還沒設定營業時間，AI 會一直當作下班時間。")).toBeVisible();
  });
});

describe("lib/voice-setup", () => {
  const limits = LIMITS;
  const setup = (patch: Partial<VoiceSetup> = {}): VoiceSetup => ({ ...baseSetup(), ...patch });

  it("counts like the backend: no spaces, tabs, newlines, NBSP or ideographic spaces; code points", () => {
    expect(nonSpace(openingText(DISCLOSURE, "", ""))).toBe(30);
    expect(nonSpace(" a\tb\nc\rd\u00a0e\u3000f ")).toBe(6);
    // Not \s: these are characters, as in Python's NON_SPACE_IGNORED.
    expect(nonSpace("\u2003\u000b\ufeff")).toBe(3);
    expect(nonSpace("𠮷😀")).toBe(2);
    expect(estimateSeconds(46, 4.5)).toBe(10.2);
    expect(estimateSeconds(67, 4.5)).toBe(14.9);
    expect(estimateSeconds(68, 4.5)).toBe(15.1);
  });

  it("builds the opening from the notice, the trimmed name and the trimmed greeting", () => {
    expect(openingText("A{{SHOP_NAME}}B{{SHOP_NAME}}", " 店 ", " 嗨 ")).toBe("A店B店嗨");
    const info = openingInfo(DISCLOSURE, "晴光牙醫診所", "請問有什麼可以幫您？", limits);
    expect(info).toMatchObject({ nonSpace: 46, seconds: 10.2, ok: true, remaining: 21, shorten: null });
    expect(openingInfo(DISCLOSURE, "晴光牙醫診所", "一".repeat(32), limits)).toMatchObject({ ok: false, remaining: -1, shorten: "greeting" });
    // If a longer notice ever leaves no room, the name is what has to go.
    const longNotice = `${"告".repeat(60)}{{SHOP_NAME}}`;
    expect(openingInfo(longNotice, "晴光牙醫診所診所", "", limits)).toMatchObject({ ok: false, shorten: "name" });
  });

  it("formats and offers times, keeping a stored value that is not on the 15-minute grid", () => {
    expect(minuteText(0)).toBe("00:00");
    expect(minuteText(545)).toBe("09:05");
    expect(minuteText(1440)).toBe("24:00");
    expect(timeChoices("open", 540)).toHaveLength(96);
    expect(timeChoices("open", 540)[0]).toBe(0);
    expect(timeChoices("open", 540).at(-1)).toBe(1425);
    expect(timeChoices("close", 1440).at(-1)).toBe(1440);
    expect(timeChoices("close", 1440)[0]).toBe(15);
    expect(timeChoices("open", 545)).toContain(545);
  });

  it("knows real dates", () => {
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2026-13-01")).toBe(false);
    expect(isDate("2026-1-01")).toBe(false);
    expect(isDate("")).toBe(false);
  });

  it("sends only what changed, with hours and closures sorted and notes trimmed", () => {
    const saved = setup();
    expect(setupChanges(saved, draftFromSetup(saved))).toEqual({});
    const draft = draftFromSetup(saved);
    draft.hours = [...draft.hours].reverse();
    draft.name = ` ${saved.name} `;
    expect(setupChanges(saved, draft)).toEqual({});
    draft.closures = [{ date: "2027-01-01", note: " 元旦 ", key: 1 }, ...draft.closures];
    draft.retentionDays = "30";
    expect(setupChanges(saved, draft)).toEqual({
      closures: [{ date: "2026-12-25", note: "院內訓練" }, { date: "2027-01-01", note: "元旦" }],
      retentionDays: 30,
    });
  });

  it("finds the problems the backend would refuse", () => {
    const saved = setup();
    const ok = draftFromSetup(saved);
    expect(setupProblems(ok, DISCLOSURE, limits, "message_only").any).toBe(false);
    const draft = draftFromSetup(saved);
    draft.hours = [
      { weekday: 0, openMin: 540, closeMin: 720, key: 1 },
      { weekday: 0, openMin: 700, closeMin: 800, key: 2 },
      { weekday: 1, openMin: 600, closeMin: 600, key: 3 },
      { weekday: 2, openMin: 600, closeMin: 700, key: 4 },
      { weekday: 2, openMin: 700, closeMin: 800, key: 5 },
    ];
    draft.recordingMode = "full";
    const found = setupProblems(draft, DISCLOSURE, limits, "message_only");
    expect([...found.segments.entries()]).toEqual([[1, "overlap"], [2, "overlap"], [3, "order"]]);
    expect(found.recordingMode).toBe(true);
    // Choosing "full" is refused, and its 30-day limit already applies to the 90 days on file.
    expect(found.retentionDays).toBe("over");
    expect(found.any).toBe(true);
    expect(setupProblems({ ...ok, askCallback: "sometimes" }, DISCLOSURE, limits, "message_only").any).toBe(true);
    expect(setupProblems({ ...ok, afterHoursMode: "closed" }, DISCLOSURE, limits, "message_only").any).toBe(true);
    expect(setupProblems({ ...ok, maxMessageSeconds: "120.5" }, DISCLOSURE, limits, "message_only").maxMessageSeconds).toBe(true);
  });

  it("maps every merchant error code of contract §9 that the setup page can get", () => {
    const text = (status: number, code: string, locale: "en" | "zh" = "en") =>
      voiceErrorText(new PortalError(status, code, "x"), locale, limits);
    expect(text(404, "voice_store_not_found")).toBe("Phone agent is not set up for this account.");
    expect(text(400, "greeting_too_long", "zh")).toBe("開場白最多 40 字。");
    expect(text(400, "kb_too_large")).toBe("The store description and all questions together can be up to 6,000 characters.");
    expect(text(409, "kb_empty", "zh")).toBe("還沒有任何內容。請先填店家介紹或新增問答。");
    expect(text(409, "not_published")).toBe('Nothing is applied yet. Use "Save and apply" on Setup first.');
    expect(text(429, "voice_publish_limit", "zh")).toBe("最近 24 小時套用太多次了，請稍後再試。");
    expect(text(413, "invalid_input", "zh")).toBe("內容太大。");
    // Unknown codes fall back to the portal's status copy.
    expect(text(409, "something_new")).toBe("This record already exists or its status has changed. Refresh to check the latest state.");
  });
});

// The enums and the opening count must match the backend. The voice backend files arrive with the T1/T2 branches
// (feat/voice-p1-backend, feat/voice-p1-prompt); until they are merged into this branch these checks are skipped.
const voiceStore = resolve(process.cwd(), "server/voice_store.py");
const voiceCompile = resolve(process.cwd(), "server/voice_compile.py");
const pythonTuple = (source: string, name: string) => {
  const match = new RegExp(`^${name} = \\(([^)]*)\\)`, "m").exec(source);
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : null;
};

describe.skipIf(!existsSync(voiceStore))("enums shared with server/voice_store.py", () => {
  it("are the same sets, and the stand-in backend uses the same retention limits", () => {
    const source = readFileSync(voiceStore, "utf8");
    expect(pythonTuple(source, "INDUSTRIES")).toEqual([...INDUSTRIES]);
    expect(pythonTuple(source, "AFTER_HOURS_MODES")).toEqual([...AFTER_HOURS_MODES]);
    expect(pythonTuple(source, "ASK_CALLBACK")).toEqual([...ASK_CALLBACK]);
    expect(pythonTuple(source, "RECORDING_MODES")).toEqual([...RECORDING_MODES]);
    expect(Number(/^RETENTION_DAYS_MAX = (\d+)/m.exec(source)?.[1])).toBe(LIMITS.retentionDaysMax);
    expect(Number(/^RETENTION_DAYS_MAX_FULL = (\d+)/m.exec(source)?.[1])).toBe(LIMITS.retentionDaysMaxFull);
  });
});

describe.skipIf(!existsSync(voiceCompile))("opening count shared with server/voice_compile.py", () => {
  it("ignores exactly the backend's characters", () => {
    const source = readFileSync(voiceCompile, "utf8");
    const match = /^NON_SPACE_IGNORED = re\.compile\("\[([^\]]*)\]"\)/m.exec(source);
    expect(match).not.toBeNull();
    // Python string escapes (backslash t, n, r, v, f, xHH, uHHHH) as the characters they stand for.
    const simple: Record<string, string> = { t: "\t", n: "\n", r: "\r", v: "\v", f: "\f" };
    const ignored = [
      ...(match as RegExpExecArray)[1].replace(/\\(?:([tnrvf])|x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4}))/g, (_, letter, hex2, hex4) =>
        letter ? simple[letter] : String.fromCharCode(parseInt(hex2 ?? hex4, 16)),
      ),
    ];
    for (const character of ignored) expect(nonSpace(character), JSON.stringify(character)).toBe(0);
    for (const character of ["\u2003", "\u000b", "\u000c", "\ufeff", "\u2028", "a"])
      expect(nonSpace(character), JSON.stringify(character)).toBe(ignored.includes(character) ? 0 : 1);
    expect(Number(/^CHARS_PER_SECOND = ([\d.]+)/m.exec(source)?.[1])).toBe(LIMITS.charsPerSecond);
  });
});
