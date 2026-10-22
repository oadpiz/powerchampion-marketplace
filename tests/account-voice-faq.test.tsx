import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPortal } from "../components/account-portal";
import type { VoiceSummary } from "../components/account-voice";
import { AccountVoiceFaq } from "../components/account-voice-faq";
import { LocaleProvider } from "../components/locale-provider";
import { PortalError } from "../lib/portal-client";
import {
  CSV_PROBLEMS,
  IMPORT_MODES,
  PLACEHOLDER,
  csvProblemText,
  faqCharCount,
  faqDraftProblems,
  placeFaq,
  placeholderParts,
  variantsFromText,
  voiceErrorText,
  type VoiceFaq,
} from "../lib/voice-faq";

// ---------------------------------------------------------------------------------------------
// A fake of the T4 store routes, written from the phase 1 contract (§1.1 order of checks, §1.5
// limits, §3.4-§3.11 shapes and error codes, §5.2 sizes, §5.5 CSV rules). It deliberately does not
// reuse lib/voice-faq.ts or lib/admin-text.ts, so a wrong client check cannot agree with itself.
// ---------------------------------------------------------------------------------------------

const LIMITS = {
  storeNameChars: 20, greetingChars: 40, openingNonSpaceMax: 67, openingSecondsMax: 15, charsPerSecond: 4.5,
  questionChars: 100, variantChars: 50, variantsMax: 10, faqChars: 400, kbCharsMax: 6000, faqMax: 120,
  csvBodyBytes: 196608, hoursSegmentsPerDay: 4, closuresMax: 60, closureNoteChars: 40, maxMessageSecondsMin: 60,
  maxMessageSecondsMax: 180, retentionDaysMax: 90, retentionDaysMaxFull: 30, tryLimit: 20, tryWindowHours: 24,
  ticketTtlSeconds: 900,
};
const ID = /^[a-f0-9]{32}$/;
const PLACEHOLDER_SERVER = /（請填入(?:：[^）\n]{1,20})?）/;
// support.py UNSAFE_TEXT: controls (tab/newline allowed in multi-line fields), bidi controls, lone surrogates.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
// Single-line fields (text_value) also refuse tab, newlines and invisible characters.
const UNSAFE_LINE = /[\t\n\r\u200b-\u200f\u2060\u061c]/;
const len = (text: string) => [...text].length;

type StoredFaq = { id: string; question: string; answer: string; variants: string[]; aiAllowed: boolean; updatedAt: string };
type TemplateFaq = { question: string; answer: string; variants: string[]; ai_allowed: boolean };
type Recorded = { method: string; path: string; body: unknown; contentType: string | null };

const CLINIC = {
  templateId: "clinic",
  title: { zh: "診所", en: "Clinic" },
  intro_text: "診所地址：（請填入：地址）。可以刷健保卡。",
  faqs: [
    { question: "洗牙多少錢？", answer: "健保洗牙每半年一次免費；自費（請填入：價格）元。", variants: ["洗牙費用"], ai_allowed: true },
    { question: "可以刷卡嗎？", answer: "可以刷信用卡。", variants: [], ai_allowed: true },
    { question: "附近有停車場嗎？", answer: "附近有（請填入）停車場。", variants: [], ai_allowed: true },
  ] as TemplateFaq[],
};

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

/** excel-dialect CSV like Python csv.reader: commas, double quotes, "" escapes, newlines inside quotes. */
function parseCsv(text: string): { records: string[][]; failedAt: number | null } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let atStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\0") return { records, failedAt: records.length + 1 };
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (char === ",") {
      record.push(field);
      field = "";
      atStart = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      atStart = true;
    } else {
      field += char;
      atStart = false;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return { records, failedAt: null };
}

class FakeVoice {
  status = "draft";
  passwordChangeRequired = false;
  name = "晴光牙醫診所";
  intro = "";
  faqs: StoredFaq[] = [];
  template: typeof CLINIC | null = CLINIC;
  hasHours = false;
  version: number | null = null;
  versionSha: string | null = null;
  maxVersion = 0;
  calls: Recorded[] = [];
  /** Answers GET /me/voice/faqs with this instead, once per entry (e.g. a 503 first). */
  faqListFailures: Response[] = [];
  private seq = 0;

  newId() {
    this.seq += 1;
    return this.seq.toString(16).padStart(32, "0");
  }
  add(question: string, answer: string, variants: string[] = [], aiAllowed = true) {
    const faq = { id: this.newId(), question, answer, variants, aiAllowed, updatedAt: "2026-11-01T02:00:00Z" };
    this.faqs.push(faq);
    return faq;
  }
  chars(faq: Pick<StoredFaq, "question" | "answer" | "variants">) {
    return len(faq.question) + len(faq.answer) + faq.variants.reduce((sum, item) => sum + len(item), 0);
  }
  kbChars(intro = this.intro, faqs: Pick<StoredFaq, "question" | "answer" | "variants">[] = this.faqs) {
    return len(intro) + faqs.reduce((sum, faq) => sum + this.chars(faq), 0);
  }
  capacity() {
    return { kbChars: this.kbChars(), kbCharsMax: 6000, faqCount: this.faqs.length, faqMax: 120, introChars: len(this.intro) };
  }
  view(faq: StoredFaq): VoiceFaq {
    const needsInput = [faq.question, faq.answer, ...faq.variants].some((text) => PLACEHOLDER_SERVER.test(text));
    return { ...faq, position: this.faqs.indexOf(faq), chars: this.chars(faq), needsInput };
  }
  summary(): VoiceSummary {
    return {
      store: {
        id: "f".repeat(32), name: this.name, industry: "clinic", templateId: this.template ? "clinic" : null, status: this.status,
        currentVersion: this.version, publishedAt: this.version ? "2026-11-01T02:10:00Z" : null,
        hasUnpublishedChanges: this.version === null || this.versionSha !== this.draftSha(), faqCount: this.faqs.length,
        kbChars: this.kbChars(), aiAnswerEnabled: false, updatedAt: "2026-11-01T01:58:00Z",
      },
      account: { passwordChangeRequired: this.passwordChangeRequired },
      try: { available: true, limit: 20, windowHours: 24, used: 0, remaining: 20, lastIssuedAt: null },
      limits: { ...LIMITS },
    };
  }
  draftSha() {
    return JSON.stringify([this.name, this.intro, this.faqs.map(({ question, answer, variants, aiAllowed }) => [question, answer, variants, aiAllowed])]);
  }

  // §1.1 step 4: body_json (415 without application/json, 413 over the limit, 400 for bad JSON or a non-object).
  body(init: RequestInit | undefined, maximum = 65536): Record<string, unknown> {
    const type = new Headers(init?.headers).get("Content-Type") ?? "";
    if (!type.startsWith("application/json")) throw new HttpError(415, "invalid_input");
    const raw = typeof init?.body === "string" ? init.body : "";
    if (new TextEncoder().encode(raw).length > maximum) throw new HttpError(413, "invalid_input");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "invalid_input");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "invalid_input");
    return value as Record<string, unknown>;
  }
  // §1.1 step 5.1-5.2.
  writable() {
    if (this.passwordChangeRequired) throw new HttpError(403, "password_change_required");
    if (this.status === "suspended") throw new HttpError(409, "store_suspended");
  }
  line(value: unknown, minimum: number, maximum: number) {
    if (typeof value !== "string" || UNSAFE.test(value) || UNSAFE_LINE.test(value)) throw new HttpError(400, "invalid_input");
    const text = value.trim();
    if (len(text) < minimum || len(text) > maximum) throw new HttpError(400, "invalid_input");
    return text;
  }
  multiline(value: unknown, minimum: number, maximum: number) {
    if (typeof value !== "string" || UNSAFE.test(value)) throw new HttpError(400, "invalid_input");
    const text = value.trim();
    if (len(text) < minimum || len(text) > maximum) throw new HttpError(400, "invalid_input");
    return text;
  }
  variants(value: unknown) {
    if (!Array.isArray(value)) throw new HttpError(400, "invalid_input");
    const items = value.map((item) => {
      if (typeof item !== "string" || UNSAFE.test(item) || UNSAFE_LINE.test(item)) throw new HttpError(400, "invalid_input");
      return item.trim();
    }).filter(Boolean);
    if (items.some((item) => len(item) > 50) || items.length > 10) throw new HttpError(400, "invalid_input");
    return items;
  }
  findFaq(id: string) {
    const faq = ID.test(id) ? this.faqs.find((item) => item.id === id) : undefined;
    if (!faq) throw new HttpError(404, "faq_not_found");
    return faq;
  }
  /** M5 and M6 field checks in contract order, then the capacity checks. */
  faqFields(body: Record<string, unknown>, current: StoredFaq | null) {
    const question = "question" in body || !current ? this.line(body.question, 1, 100) : current.question;
    const answer = "answer" in body || !current ? this.multiline(body.answer, 1, 400) : current.answer;
    const variants = "variants" in body ? this.variants(body.variants) : current?.variants ?? [];
    if ("aiAllowed" in body && typeof body.aiAllowed !== "boolean") throw new HttpError(400, "invalid_input");
    const aiAllowed = "aiAllowed" in body ? (body.aiAllowed as boolean) : current?.aiAllowed ?? true;
    if ("position" in body && (!Number.isInteger(body.position) || (body.position as number) < 0)) throw new HttpError(400, "invalid_input");
    const next = { question, answer, variants, aiAllowed };
    if (this.chars(next) > 400) throw new HttpError(400, "faq_too_long");
    if (!current && this.faqs.length + 1 > 120) throw new HttpError(400, "faq_limit");
    const others = this.faqs.filter((item) => item !== current);
    if (this.kbChars(this.intro, [...others, next]) > 6000) throw new HttpError(400, "kb_too_large");
    return { next, position: body.position as number | undefined };
  }
  place(faq: StoredFaq, position: number | undefined) {
    this.faqs = this.faqs.filter((item) => item !== faq);
    const index = position === undefined ? this.faqs.length : Math.min(position, this.faqs.length);
    this.faqs.splice(index, 0, faq);
  }
  /** §5.5: per-row problems in contract order; at most 50 listed. */
  checkCsv(text: string) {
    const source = text.startsWith("\ufeff") ? text.slice(1) : text;
    const { records, failedAt } = parseCsv(source);
    const errors: { row: number; problem: string }[] = [];
    const rows: StoredFaq[] = [];
    const header = (records[0] ?? []).map((cell) => cell.trim().toLowerCase());
    const column = (...names: string[]) => header.findIndex((cell) => names.includes(cell));
    const q = column("問題", "question");
    const a = column("答案", "answer");
    const v = column("相似問法", "variants");
    if (q < 0 || a < 0) return { errors: [{ row: 1, problem: "header_invalid" }], rows };
    records.slice(1).forEach((record, index) => {
      const row = index + 2;
      if (record.every((cell) => !cell.trim())) return;
      const question = (record[q] ?? "").trim();
      const answer = (record[a] ?? "").trim();
      const variants = v < 0 ? [] : (record[v] ?? "").split(/[|｜;；\n]/).map((item) => item.trim()).filter(Boolean);
      const faq = { id: "", question, answer, variants, aiAllowed: true, updatedAt: "2026-11-01T02:00:00Z" };
      const problem = !question
        ? "question_required"
        : !answer
          ? "answer_required"
          : len(question) > 100
            ? "question_too_long"
            : variants.some((item) => len(item) > 50)
              ? "variant_too_long"
              : variants.length > 10
                ? "too_many_variants"
                : this.chars(faq) > 400
                  ? "faq_too_long"
                  : [question, ...variants].some((item) => UNSAFE.test(item) || UNSAFE_LINE.test(item)) || UNSAFE.test(answer)
                    ? "unsafe_text"
                    : null;
      if (problem) errors.push({ row, problem });
      else rows.push(faq);
    });
    if (failedAt !== null) errors.push({ row: failedAt, problem: "csv_unparseable" });
    return { errors, rows };
  }
  compile() {
    if (!this.intro && this.faqs.length === 0) return null;
    const safe = (text: string) => text.replace(/[【〖]/g, "「").replace(/[】〗]/g, "」");
    const answered = this.faqs.filter((faq) => faq.aiAllowed);
    const prefix = [
      "【規則】照店家資料回答。",
      `【店家資料】\n店名：${safe(this.name)}\n${safe(this.intro)}`,
      `【常見問答】\n${answered.map((faq) => `問：${safe(faq.question)}\n答：${safe(faq.answer)}`).join("\n")}`,
    ].join("\n\n");
    const warnings = [
      ...(PLACEHOLDER_SERVER.test(this.intro) ? [{ code: "placeholder_unfilled", field: "intro", faq_id: null }] : []),
      ...this.faqs.filter((faq) => this.view(faq).needsInput).map((faq) => ({ code: "placeholder_unfilled", field: "faq", faq_id: faq.id })),
      ...(this.hasHours ? [] : [{ code: "hours_empty", field: null, faq_id: null }]),
    ];
    return {
      schema: "voice.store-config/v1",
      version: this.maxVersion + 1,
      shop_name: this.name,
      opening: { text: `您好，這裡是${this.name}，我是 AI 語音助理。`, est_seconds: 4.4 },
      prompt: { prefix },
      rules: { no_ai_questions: this.faqs.filter((faq) => !faq.aiAllowed).map((faq) => faq.question) },
      kb_chars: this.kbChars(),
      warnings,
    };
  }

  handle(method: string, path: string, init: RequestInit | undefined): unknown {
    const faqPath = path.match(/^\/me\/voice\/faqs\/([^/]+)$/);
    if (method === "GET" && path === "/session") return { user: { id: "cust-1", email: "clinic@example.test", name: "Clinic", role: "customer" } };
    if (method === "GET" && path === "/me/voice") return this.summary();
    if (method === "GET" && path === "/me/voice/faqs") {
      const failure = this.faqListFailures.shift();
      if (failure) return failure;
      return {
        introText: this.intro,
        faqs: this.faqs.map((faq) => this.view(faq)),
        capacity: this.capacity(),
        template: this.template
          ? { available: true, templateId: this.template.templateId, title: this.template.title, faqCount: this.template.faqs.length }
          : { available: false },
      };
    }
    if (method === "POST" && path === "/me/voice/setup") {
      const body = this.body(init);
      this.writable();
      if (!("introText" in body)) return { setup: { introText: this.intro }, changed: [], limits: LIMITS };
      const introText = this.multiline(body.introText, 0, 6000);
      if (this.kbChars(introText) > 6000) throw new HttpError(400, "kb_too_large");
      const changed = introText === this.intro ? [] : ["introText"];
      this.intro = introText;
      return { setup: { name: this.name, introText }, changed, limits: LIMITS };
    }
    if (method === "POST" && path === "/me/voice/faqs/import") {
      const body = this.body(init, 196608);
      this.writable();
      if (typeof body.csv !== "string" || !IMPORT_MODES_SERVER.includes(body.mode as string)) throw new HttpError(400, "invalid_input");
      if ("dryRun" in body && typeof body.dryRun !== "boolean") throw new HttpError(400, "invalid_input");
      const { errors, rows } = this.checkCsv(body.csv);
      const kept = body.mode === "replace" ? [] : this.faqs;
      const result = { faqCount: kept.length + rows.length, kbChars: this.kbChars(this.intro, [...kept, ...rows]) };
      const capacityProblem = result.faqCount > 120 ? "faq_limit" : result.kbChars > 6000 ? "kb_too_large" : null;
      if (body.dryRun === true) {
        const count = rows.length + errors.filter((item) => item.problem !== "header_invalid" && item.problem !== "csv_unparseable").length;
        return {
          dryRun: true,
          ok: errors.length === 0 && count > 0 && capacityProblem === null,
          rows: count,
          errors: errors.slice(0, 50),
          errorsTruncated: errors.length > 50,
          result,
          capacityProblem,
        };
      }
      if (errors.length > 0 || rows.length === 0) throw new HttpError(400, "csv_invalid");
      if (capacityProblem) throw new HttpError(400, capacityProblem);
      this.faqs = [...kept, ...rows.map((faq) => ({ ...faq, id: this.newId() }))];
      return { imported: rows.length, mode: body.mode, faqs: this.faqs.map((faq) => this.view(faq)), capacity: this.capacity() };
    }
    if (method === "POST" && path === "/me/voice/faqs/from-template") {
      const body = this.body(init);
      this.writable();
      if (!IMPORT_MODES_SERVER.includes(body.mode as string)) throw new HttpError(400, "invalid_input");
      if ("includeIntro" in body && typeof body.includeIntro !== "boolean") throw new HttpError(400, "invalid_input");
      if (!this.template) throw new HttpError(404, "template_not_found");
      const added = this.template.faqs.map((faq) => ({
        id: "", question: faq.question, answer: faq.answer, variants: faq.variants, aiAllowed: faq.ai_allowed, updatedAt: "2026-11-01T02:00:00Z",
      }));
      const kept = body.mode === "replace" ? [] : this.faqs;
      const intro = body.includeIntro === true ? this.template.intro_text : this.intro;
      if (kept.length + added.length > 120) throw new HttpError(400, "faq_limit");
      if (this.kbChars(intro, [...kept, ...added]) > 6000) throw new HttpError(400, "kb_too_large");
      this.intro = intro;
      this.faqs = [...kept, ...added.map((faq) => ({ ...faq, id: this.newId() }))];
      const views = this.faqs.map((faq) => this.view(faq));
      return {
        added: added.length,
        needsInput: views.slice(kept.length).filter((faq) => faq.needsInput).length,
        introReplaced: body.includeIntro === true,
        faqs: views,
        capacity: this.capacity(),
      };
    }
    if (method === "POST" && path === "/me/voice/faqs") {
      const body = this.body(init);
      this.writable();
      const { next, position } = this.faqFields(body, null);
      const faq = { ...next, id: this.newId(), updatedAt: "2026-11-01T02:00:00Z" };
      this.faqs.push(faq);
      this.place(faq, position);
      return Response.json({ faq: this.view(faq), capacity: this.capacity() }, { status: 201 });
    }
    if (method === "POST" && faqPath) {
      const faq = this.findFaq(faqPath[1]);
      const body = this.body(init);
      this.writable();
      const { next, position } = this.faqFields(body, faq);
      Object.assign(faq, next);
      if (position !== undefined) this.place(faq, position);
      return { faq: this.view(faq), capacity: this.capacity() };
    }
    if (method === "DELETE" && faqPath) {
      const faq = this.findFaq(faqPath[1]);
      this.writable();
      this.faqs = this.faqs.filter((item) => item !== faq);
      return { ok: true, capacity: this.capacity() };
    }
    if (method === "GET" && path === "/me/voice/preview") {
      const config = this.compile();
      return {
        basedOnVersion: this.version,
        nextVersion: this.maxVersion + 1,
        config,
        configSha256: config ? "a".repeat(64) : null,
        hasUnpublishedChanges: this.version === null || this.versionSha !== this.draftSha(),
        problems: config ? [] : [{ code: "kb_empty", detail: "Nothing to apply." }],
      };
    }
    if (method === "POST" && path === "/me/voice/publish") {
      this.body(init);
      this.writable();
      const config = this.compile();
      if (!config) throw new HttpError(409, "kb_empty");
      if (this.version !== null && this.versionSha === this.draftSha())
        return { changed: false, version: this.version, configSha256: "a".repeat(64), publishedAt: "2026-11-01T02:10:00Z", warnings: config.warnings };
      this.maxVersion += 1;
      this.version = this.maxVersion;
      this.versionSha = this.draftSha();
      return { changed: true, version: this.version, configSha256: "b".repeat(64), publishedAt: "2026-11-01T02:10:00Z", warnings: config.warnings };
    }
    // Anything else is outside the BFF allowlist or not a route: the generic 404.
    throw new HttpError(404, "not_found");
  }

  /** Installs the fake as fetch (what the BFF passes through). */
  install() {
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("/api/portal", "");
      const method = init?.method ?? "GET";
      this.calls.push({
        method,
        path,
        body: typeof init?.body === "string" ? safeJson(init.body) : undefined,
        contentType: new Headers(init?.headers).get("Content-Type"),
      });
      try {
        const value = this.handle(method, path, init);
        return value instanceof Response ? value : Response.json(value);
      } catch (cause) {
        if (cause instanceof HttpError) return Response.json({ error: cause.code, detail: "Refused by the fake backend." }, { status: cause.status });
        throw cause;
      }
    });
    vi.stubGlobal("fetch", mock);
    return this;
  }
  writes() {
    return this.calls.filter((call) => call.method !== "GET");
  }
}
const IMPORT_MODES_SERVER = ["append", "replace"];
const safeJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const renderFaq = (fake: FakeVoice, onChanged = vi.fn(), summary: VoiceSummary = fake.summary()) => {
  render(
    <LocaleProvider>
      <AccountVoiceFaq summary={summary} onChanged={onChanged} />
    </LocaleProvider>,
  );
  return onChanged;
};
const csvFile = (text: string, name = "faq.csv") => new File([text], name, { type: "text/csv" });
const questionCells = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => (within(row).getAllByRole("cell")[1]?.textContent ?? "").split(/ ?(?:Needs input|No AI answer|Other ways to ask)/)[0]);
const rowOf = (question: string) => screen.getAllByRole("row").find((row) => within(row).queryAllByRole("cell")[1]?.textContent?.startsWith(question));
const capacityText = () => screen.getByText(/characters · \d+ \/ 120 questions$/);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("phone agent FAQ page", () => {
  it("shows the empty state, the capacity and the template button only when the industry has a template", async () => {
    const fake = new FakeVoice().install();
    renderFaq(fake);
    expect(await screen.findByText("No questions yet. Start from the template or add them one by one.")).toBeVisible();
    expect(capacityText()).toHaveTextContent("0 / 6,000 characters · 0 / 120 questions");
    expect(capacityText()).not.toHaveClass("portal-note");
    expect(screen.getByRole("button", { name: "Use the template" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeEnabled();
    expect(fake.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /me/voice/faqs"]);
  });

  it("keeps the radios and checkboxes of the form and both dialogs on one line with their text", async () => {
    // Verifier finding 2026-10-22: the template and CSV dialogs put their radios inside .portal-field.
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    renderFaq(fake);
    const inputs = () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]')];
    const check = (expected: number) => {
      expect(inputs()).toHaveLength(expected);
      for (const input of inputs()) {
        expect(input.closest(".portal-field")).toBeNull();
        expect(input.closest("label")).toHaveClass("portal-choice");
      }
    };
    await user.click(await screen.findByRole("button", { name: "Add a question" }));
    check(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Use the template" }));
    check(3);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Import CSV" }));
    check(2);
  });

  it("hides the template button for an industry without one", async () => {
    const fake = new FakeVoice();
    fake.template = null;
    fake.install();
    renderFaq(fake);
    await screen.findByText(/No questions yet/);
    expect(screen.queryByRole("button", { name: "Use the template" })).not.toBeInTheDocument();
  });

  it("turns the capacity line yellow above 90 percent", async () => {
    const fake = new FakeVoice();
    fake.intro = "店".repeat(5401);
    fake.install();
    renderFaq(fake);
    await waitFor(() => expect(capacityText()).toHaveTextContent("5,401 / 6,000 characters · 0 / 120 questions"));
    expect(capacityText()).toHaveClass("portal-note");
  });

  it("adds a question with other ways to ask and the no-AI flag, exactly as the server stores it", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    const onChanged = renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Add a question" }));
    const form = screen.getByRole("form", { name: "New question" });
    await user.type(within(form).getByLabelText("Question"), "洗牙多少錢？");
    await user.type(within(form).getByLabelText("Answer"), "健保洗牙每半年一次免費。");
    await user.type(within(form).getByLabelText("Other ways to ask (one per line, optional)"), "洗牙費用{enter}{enter}  洗牙要錢嗎  ");
    expect(within(form).getByText("27 / 400 characters for this question")).toBeVisible();
    await user.click(within(form).getByLabelText(/Do not let the AI answer this/));
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fake.faqs).toHaveLength(1));
    expect(fake.writes()).toEqual([
      {
        method: "POST",
        path: "/me/voice/faqs",
        body: { question: "洗牙多少錢？", answer: "健保洗牙每半年一次免費。", variants: ["洗牙費用", "洗牙要錢嗎"], aiAllowed: false },
        contentType: "application/json",
      },
    ]);
    const row = await waitFor(() => rowOf("洗牙多少錢？")!);
    expect(within(row).getByText("No AI answer")).toBeVisible();
    expect(within(row).getByText(/Other ways to ask:/)).toHaveTextContent("洗牙費用, 洗牙要錢嗎");
    expect(capacityText()).toHaveTextContent("27 / 6,000 characters · 1 / 120 questions");
    expect(screen.queryByRole("form", { name: "New question" })).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("edits a question and switches the no-AI flag off again", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    const faq = fake.add("可以刷卡嗎？", "可以。", [], false);
    fake.install();
    renderFaq(fake);
    const row = await waitFor(() => rowOf("可以刷卡嗎？")!);
    expect(within(row).getByText("No AI answer")).toBeVisible();
    await user.click(within(row).getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit question" });
    expect(within(form).getByLabelText(/Do not let the AI answer this/)).toBeChecked();
    await user.clear(within(form).getByLabelText("Answer"));
    await user.type(within(form).getByLabelText("Answer"), "可以刷信用卡，不收手續費。");
    await user.click(within(form).getByLabelText(/Do not let the AI answer this/));
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.faqs[0].aiAllowed).toBe(true));
    expect(fake.faqs[0]).toMatchObject({ id: faq.id, answer: "可以刷信用卡，不收手續費。" });
    expect(fake.writes().map((call) => call.path)).toEqual([`/me/voice/faqs/${faq.id}`]);
    const updated = await waitFor(() => rowOf("可以刷卡嗎？")!);
    expect(within(updated).queryByText("No AI answer")).not.toBeInTheDocument();
    expect(updated).toHaveTextContent("可以刷信用卡，不收手續費。");
  });

  it("moves questions up and down, in the same order as the server", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    const [a, b, c] = [fake.add("甲？", "一。"), fake.add("乙？", "二。"), fake.add("丙？", "三。")];
    fake.install();
    renderFaq(fake);
    await waitFor(() => expect(questionCells()).toEqual(["甲？", "乙？", "丙？"]));
    expect(within(rowOf("甲？")!).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(rowOf("丙？")!).getByRole("button", { name: "Move down" })).toBeDisabled();

    await user.click(within(rowOf("甲？")!).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(questionCells()).toEqual(["乙？", "甲？", "丙？"]));
    expect(fake.faqs.map((faq) => faq.id)).toEqual([b.id, a.id, c.id]);

    await user.click(within(rowOf("丙？")!).getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(questionCells()).toEqual(["乙？", "丙？", "甲？"]));
    expect(fake.faqs.map((faq) => faq.id)).toEqual([b.id, c.id, a.id]);
    expect(fake.writes().map((call) => [call.path, call.body])).toEqual([
      [`/me/voice/faqs/${a.id}`, { position: 1 }],
      [`/me/voice/faqs/${c.id}`, { position: 1 }],
    ]);
  });

  it("asks before deleting, and deletes only after the confirmation", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    fake.add("甲？", "一。");
    const doomed = fake.add("可以刷卡嗎？", "可以。");
    fake.install();
    renderFaq(fake);
    await user.click(within(await waitFor(() => rowOf("可以刷卡嗎？")!)).getByRole("button", { name: "Delete" }));
    let dialog = screen.getByRole("dialog", { name: "Delete this question?" });
    expect(dialog).toHaveTextContent('"可以刷卡嗎？" cannot be restored. The applied version is unaffected until you apply again.');
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fake.faqs).toHaveLength(2);
    expect(fake.writes()).toEqual([]);

    await user.click(within(rowOf("可以刷卡嗎？")!).getByRole("button", { name: "Delete" }));
    dialog = screen.getByRole("dialog", { name: "Delete this question?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fake.faqs.map((faq) => faq.question)).toEqual(["甲？"]);
    expect(fake.writes().map((call) => `${call.method} ${call.path}`)).toEqual([`DELETE /me/voice/faqs/${doomed.id}`]);
    expect(questionCells()).toEqual(["甲？"]);
    expect(capacityText()).toHaveTextContent("4 / 6,000 characters · 1 / 120 questions");
  });

  it("blocks, before sending, the same questions the server refuses", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Add a question" }));
    const form = screen.getByRole("form", { name: "New question" });

    // Empty fields: shown only after a save attempt.
    expect(within(form).queryByText("Enter the question.")).not.toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(within(form).getByText("Enter the question.")).toBeVisible();
    expect(within(form).getByText("Enter the answer.")).toBeVisible();

    // 101 characters: over questionChars.
    const longQuestion = "問".repeat(101);
    fireEvent.change(within(form).getByLabelText("Question"), { target: { value: longQuestion } });
    fireEvent.change(within(form).getByLabelText("Answer"), { target: { value: "答" } });
    expect(within(form).getByText("The question can be up to 100 characters.")).toBeVisible();
    await user.click(within(form).getByRole("button", { name: "Save" }));

    // Over 400 in total, and 11 alternatives.
    fireEvent.change(within(form).getByLabelText("Question"), { target: { value: "問" } });
    fireEvent.change(within(form).getByLabelText("Answer"), { target: { value: "答".repeat(390) } });
    fireEvent.change(within(form).getByLabelText("Other ways to ask (one per line, optional)"), {
      target: { value: Array.from({ length: 11 }, (_, index) => `說法${index}`).join("\n") },
    });
    expect(within(form).getByText("425 / 400 characters for this question")).toHaveClass("portal-error");
    expect(within(form).getByText("Up to 10 alternatives.")).toBeVisible();
    await user.click(within(form).getByRole("button", { name: "Save" }));

    // A tab inside a question is a hidden character for the server's single-line check.
    fireEvent.change(within(form).getByLabelText("Question"), { target: { value: "洗牙\t多少" } });
    expect(within(form).getByText(/The question contains a control or hidden character/)).toBeVisible();
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(fake.writes()).toEqual([]);
    // The fake backend refuses the same bodies (so the client is not stricter or looser than the contract).
    const post = (body: unknown) =>
      fetch("/api/portal/me/voice/faqs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ question: longQuestion, answer: "答" })).status).toBe(400);
    expect(await (await post({ question: "問", answer: "答".repeat(390), variants: ["說法一二三四五六七八九十"] })).json()).toMatchObject({
      error: "faq_too_long",
    });
    expect((await post({ question: "洗牙\t多少", answer: "答" })).status).toBe(400);
    expect(fake.faqs).toEqual([]);
  });

  it("warns when a question would push the store over 6,000 characters or 120 questions", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    fake.intro = "店".repeat(5990);
    fake.install();
    renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Add a question" }));
    const form = screen.getByRole("form", { name: "New question" });
    fireEvent.change(within(form).getByLabelText("Question"), { target: { value: "營業到幾點？" } });
    fireEvent.change(within(form).getByLabelText("Answer"), { target: { value: "晚上九點。" } });
    expect(within(form).getByText("The store description and all questions together can be up to 6,000 characters.")).toBeVisible();
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(fake.writes()).toEqual([]);
  });

  it("shows the server's error by code when the page's numbers are stale", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Add a question" }));
    // Another tab filled the store after this page loaded.
    fake.intro = "店".repeat(5995);
    const form = screen.getByRole("form", { name: "New question" });
    await user.type(within(form).getByLabelText("Question"), "營業到幾點？");
    await user.type(within(form).getByLabelText("Answer"), "晚上九點。");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "The store description and all questions together can be up to 6,000 characters.",
    );
    expect(fake.faqs).toEqual([]);
  });

  it("re-reads the list when a question is already gone", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    fake.add("甲？", "一。");
    fake.add("乙？", "二。");
    fake.install();
    renderFaq(fake);
    await waitFor(() => expect(questionCells()).toEqual(["甲？", "乙？"]));
    fake.faqs = fake.faqs.slice(1); // deleted in another tab
    await user.click(within(rowOf("甲？")!).getByRole("button", { name: "Move down" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This question no longer exists. Reload the page.");
    await waitFor(() => expect(questionCells()).toEqual(["乙？"]));
  });

  it("sends a single request when Save is clicked twice", async () => {
    const fake = new FakeVoice().install();
    renderFaq(fake);
    fireEvent.click(await screen.findByRole("button", { name: "Add a question" }));
    const form = screen.getByRole("form", { name: "New question" });
    fireEvent.change(within(form).getByLabelText("Question"), { target: { value: "營業到幾點？" } });
    fireEvent.change(within(form).getByLabelText("Answer"), { target: { value: "晚上九點。" } });
    const save = within(form).getByRole("button", { name: "Save" });
    // Both clicks land before React re-renders the button as disabled, so only the in-flight guard stops the second.
    act(() => {
      save.click();
      save.click();
    });
    await waitFor(() => expect(fake.faqs).toHaveLength(1));
    expect(fake.writes()).toHaveLength(1);
  });

  it("uses the template, then marks every placeholder that still needs input", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    fake.add("舊的問題？", "舊的答案。");
    fake.install();
    const onChanged = renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Use the template" }));
    const dialog = screen.getByRole("dialog", { name: 'Use the "Clinic" template' });
    expect(within(dialog).getByText(/Replace every "（請填入）" with your store's details/)).toBeVisible();
    expect(within(dialog).getByLabelText("Add after existing questions")).toBeChecked();
    await user.click(within(dialog).getByLabelText("Replace all questions"));
    await user.click(within(dialog).getByLabelText(/Also use the template's store description/));
    await user.click(within(dialog).getByRole("button", { name: "Use template" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Added 3 questions; 2 need your input.");
    expect(fake.writes().map((call) => [call.path, call.body])).toEqual([["/me/voice/faqs/from-template", { mode: "replace", includeIntro: true }]]);
    expect(questionCells()).toEqual(["洗牙多少錢？", "可以刷卡嗎？", "附近有停車場嗎？"]);
    expect(screen.getAllByRole("row").filter((row) => within(row).queryByText("Needs input"))).toHaveLength(2);
    const marks = [...document.querySelectorAll("tbody mark")].map((mark) => mark.textContent);
    expect(marks).toEqual(["（請填入：價格）", "（請填入）"]);
    // The template's description replaced the editor, and it is marked too.
    await waitFor(() => expect(screen.getByLabelText("About the store", { selector: "textarea" })).toHaveValue(CLINIC.intro_text));
    expect(screen.getByText('This still says "（請填入：地址）"; replace it with your store\'s details.')).toBeVisible();

    await user.click(within(rowOf("洗牙多少錢？")!).getByRole("button", { name: "Edit" }));
    const form = screen.getByRole("form", { name: "Edit question" });
    expect(within(form).getByText('This still says "（請填入：價格）"; replace it with your store\'s details.')).toBeVisible();
    await user.clear(within(form).getByLabelText("Answer"));
    await user.type(within(form).getByLabelText("Answer"), "健保洗牙每半年一次免費；自費 800 元。");
    expect(within(form).queryByText(/This still says/)).not.toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getAllByRole("row").filter((row) => within(row).queryByText("Needs input"))).toHaveLength(1));
    expect(fake.faqs.map((faq) => fake.view(faq).needsInput)).toEqual([false, false, true]);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("shows template_not_found from the server", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Use the template" }));
    fake.template = null; // the template file went away after the page loaded
    const dialog = screen.getByRole("dialog", { name: 'Use the "Clinic" template' });
    await user.click(within(dialog).getByRole("button", { name: "Use template" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("There is no template for this industry yet.");
  });

  it("imports a CSV in two steps and lists every row problem the server reports", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    fake.add("甲？", "一。");
    fake.install();
    const onChanged = renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = screen.getByRole("dialog", { name: "Import CSV" });
    expect(within(dialog).getByText(/Row 1 is the header: 問題 \(question\), 答案 \(answer\)/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Import" })).toBeDisabled();

    const bad = `問題,答案,相似問法\n洗牙多少錢？,免費,洗牙費用｜洗牙要錢嗎\n可以刷卡嗎？,,\n\n${"長".repeat(101)},太長了,\n`;
    await user.upload(within(dialog).getByLabelText("CSV file"), csvFile(bad));
    await user.click(within(dialog).getByRole("button", { name: "Check" }));
    const problems = await within(dialog).findByRole("list", { name: "CSV problems" });
    expect(within(problems).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Row 3: Missing answer",
      "Row 5: Question over 100 characters",
    ]);
    expect(within(dialog).getByRole("button", { name: "Import" })).toBeDisabled();
    expect(fake.faqs).toHaveLength(1);

    const good = '\ufeffquestion,Answer,variants\n洗牙多少錢？,"健保洗牙免費，\n自費另計。",洗牙費用｜洗牙要錢嗎\n可以刷卡嗎？,可以。,\n';
    await user.upload(within(dialog).getByLabelText("CSV file"), csvFile(good));
    await user.click(within(dialog).getByLabelText("Replace all questions"));
    await user.click(within(dialog).getByRole("button", { name: "Check" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("2 questions can be imported. Afterwards: 2 questions, 37 characters.");
    expect(fake.faqs).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Imported 2 questions.");
    expect(questionCells()).toEqual(["洗牙多少錢？", "可以刷卡嗎？"]);
    expect(fake.faqs.map((faq) => [faq.question, faq.variants])).toEqual([
      ["洗牙多少錢？", ["洗牙費用", "洗牙要錢嗎"]],
      ["可以刷卡嗎？", []],
    ]);
    const imports = fake.writes();
    expect(imports.map((call) => (call.body as { dryRun: boolean; mode: string }).dryRun)).toEqual([true, true, false]);
    // Import sends exactly the text and mode that were checked.
    expect(imports[2].body).toEqual({ ...(imports[1].body as object), dryRun: false });
    expect(imports[2].body).toMatchObject({ mode: "replace" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("refuses a file over 192 KiB before reading it, a request that JSON escaping makes too large, and non-UTF-8 text", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = screen.getByRole("dialog", { name: "Import CSV" });
    const read = vi.spyOn(Blob.prototype, "arrayBuffer");

    await user.upload(within(dialog).getByLabelText("CSV file"), csvFile("a".repeat(LIMITS.csvBodyBytes + 1)));
    await user.click(within(dialog).getByRole("button", { name: "Check" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The file is too large (limit 192 KB).");
    expect(read).not.toHaveBeenCalled();

    // 100,000 bytes on disk, but every quote becomes \" in the JSON body (over 196,608 bytes).
    await user.upload(within(dialog).getByLabelText("CSV file"), csvFile('"'.repeat(100_000)));
    await user.click(within(dialog).getByRole("button", { name: "Check" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The file is too large (limit 192 KB).");
    expect(read).toHaveBeenCalledTimes(1);

    // A check body of exactly 196,608 bytes would pass, but the import body ("dryRun":false) is one byte over.
    const overhead = new TextEncoder().encode(JSON.stringify({ csv: "", mode: "append", dryRun: true })).length;
    await user.upload(within(dialog).getByLabelText("CSV file"), csvFile("a".repeat(LIMITS.csvBodyBytes - overhead)));
    await user.click(within(dialog).getByRole("button", { name: "Check" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The file is too large (limit 192 KB).");

    // "中文" in Big5.
    await user.upload(within(dialog).getByLabelText("CSV file"), new File([new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5])], "big5.csv", { type: "text/csv" }));
    await user.click(within(dialog).getByRole("button", { name: "Check" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent('This file does not look like UTF-8. In Excel, save as "CSV UTF-8" and try again.');

    await user.upload(within(dialog).getByLabelText("CSV file"), csvFile("問題,答案\n亂碼\ufffd,答\n"));
    await user.click(within(dialog).getByRole("button", { name: "Check" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/does not look like UTF-8/);
    expect(fake.writes()).toEqual([]);

    // The BFF/backend limit is the same 196,608 bytes: one byte over is a 413 there too.
    const body = JSON.stringify({ csv: "a".repeat(LIMITS.csvBodyBytes), mode: "append", dryRun: true });
    const response = await fetch("/api/portal/me/voice/faqs/import", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect([response.status, (await response.json()).error]).toEqual([413, "invalid_input"]);
  });

  it("explains a header problem, a truncated error list and a capacity problem from the dry run", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    fake.add("甲？", "一。");
    fake.install();
    renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = screen.getByRole("dialog", { name: "Import CSV" });
    const check = async (text: string) => {
      await user.upload(within(dialog).getByLabelText("CSV file"), csvFile(text));
      await user.click(within(dialog).getByRole("button", { name: "Check" }));
      return within(dialog).findByRole("alert");
    };

    const header = await check("題目,回答\n甲,乙\n");
    expect(header).toHaveTextContent("Row 1: Row 1 must have 問題 and 答案 columns");

    const many = await check(`問題,答案\n${Array.from({ length: 60 }, (_, index) => `問${index},`).join("\n")}\n`);
    expect(within(many).getAllByRole("listitem")).toHaveLength(50);
    expect(many).toHaveTextContent("There are more problems; fix these first.");

    const full = await check(`問題,答案\n${Array.from({ length: 120 }, (_, index) => `問${index},答${index}`).join("\n")}\n`);
    expect(full).toHaveTextContent("Up to 120 questions. (afterwards: 121 questions,");
    expect(within(dialog).getByRole("button", { name: "Import" })).toBeDisabled();

    const empty = await check("問題,答案\n\n,\n");
    expect(empty).toHaveTextContent("This file has no question rows.");
    expect(fake.faqs).toHaveLength(1);
  });

  it("saves the store description with only introText and re-reads the totals", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    const onChanged = renderFaq(fake);
    const intro = await screen.findByLabelText("About the store", { selector: "textarea" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.type(intro, "  診所在台北市大安區。  ");
    expect(screen.getByText("Description: 10 characters")).toBeVisible();
    await user.click(save);
    expect(await screen.findByText("Store description saved.")).toBeVisible();
    expect(fake.writes()).toEqual([
      { method: "POST", path: "/me/voice/setup", body: { introText: "診所在台北市大安區。" }, contentType: "application/json" },
    ]);
    expect(fake.intro).toBe("診所在台北市大安區。");
    await waitFor(() => expect(capacityText()).toHaveTextContent("10 / 6,000 characters · 0 / 120 questions"));
    expect(intro).toHaveValue("診所在台北市大安區。");
    expect(save).toBeDisabled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("previews the compiled draft, with the bracket note, and applies it", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    fake.intro = "【重要】診所地址：（請填入：地址）。";
    fake.add("洗牙多少錢？", "健保洗牙免費。");
    fake.add("可以開診斷書嗎？", "請洽櫃台。", [], false);
    fake.install();
    const onChanged = renderFaq(fake);

    await user.click(await screen.findByRole("button", { name: "Show everything the AI receives" }));
    const region = await screen.findByRole("region", { name: "Show everything the AI receives" });
    expect(within(region).getByText(/【】 and 〖〗 in your text become 「」/)).toBeVisible();
    await waitFor(() => expect(region.querySelector("pre")).toHaveTextContent("「重要」診所地址"));
    expect(region.querySelector("pre")).toHaveTextContent("問：洗牙多少錢？");
    expect(region.querySelector("pre")).not.toHaveTextContent("可以開診斷書嗎？");
    expect(within(region).getByRole("listitem")).toHaveTextContent("可以開診斷書嗎？");
    expect(within(region).getByText(/您好，這裡是晴光牙醫診所/)).toHaveTextContent("(about 4.4 s)");

    await user.click(screen.getByRole("button", { name: "Apply" }));
    const applied = await screen.findByText(/Version 1 is applied/);
    expect(applied).toHaveTextContent(
      'Version 1 is applied. Go to "Try a call" to hear it. 1 places still say "（請填入）" (to be filled in); the AI may read them aloud. Fill in the ones marked "Needs input". No business hours yet; the AI will treat every call as after hours.',
    );
    expect(within(applied).getByRole("link", { name: "Try a call" })).toHaveAttribute("href", "/account/voice/try");
    expect(fake.version).toBe(1);
    const publish = fake.writes().find((call) => call.path === "/me/voice/publish");
    expect(publish).toEqual({ method: "POST", path: "/me/voice/publish", body: {}, contentType: "application/json" });

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/Nothing changed; still version 1\./)).toBeVisible();
    expect(fake.maxVersion).toBe(1);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("explains an empty draft in the preview and when applying", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Show everything the AI receives" }));
    const region = await screen.findByRole("region", { name: "Show everything the AI receives" });
    const message = "There is nothing to apply yet. Add a store description or a question first.";
    expect(await within(region).findByText(message)).toBeVisible();
    expect(region.querySelector("pre")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(fake.version).toBeNull();
  });

  it("is read-only for a suspended store, but still previews", async () => {
    const fake = new FakeVoice();
    fake.status = "suspended";
    fake.add("甲？", "一。");
    fake.install();
    renderFaq(fake);
    const row = await waitFor(() => rowOf("甲？")!);
    for (const name of ["Add a question", "Use the template", "Import CSV", "Apply"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    for (const name of ["Edit", "Move up", "Move down", "Delete"]) expect(within(row).getByRole("button", { name })).toBeDisabled();
    expect(screen.getByLabelText("About the store", { selector: "textarea" })).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Show everything the AI receives" })).toBeEnabled();
  });

  it("links to Security when the server asks for a new password", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    renderFaq(fake);
    await user.click(await screen.findByRole("button", { name: "Add a question" }));
    // An admin reset the password after the shell loaded M1.
    fake.passwordChangeRequired = true;
    const form = screen.getByRole("form", { name: "New question" });
    await user.type(within(form).getByLabelText("Question"), "營業到幾點？");
    await user.type(within(form).getByLabelText("Answer"), "晚上九點。");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent("Change the temporary password we gave you under Security before editing or trying a call.");
    expect(within(alert).getByRole("link", { name: "Security" })).toHaveAttribute("href", "/account/security");
    expect(fake.faqs).toEqual([]);
  });

  it("disables writes up front when the summary already says the password must change", async () => {
    const fake = new FakeVoice();
    fake.passwordChangeRequired = true;
    fake.install();
    renderFaq(fake);
    expect(await screen.findByRole("button", { name: "Add a question" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice();
    fake.faqListFailures.push(Response.json({ error: "service_unavailable", detail: "x" }, { status: 503 }));
    fake.install();
    renderFaq(fake);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No questions yet/)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the Chinese copy", async () => {
    localStorage.setItem("pc-locale", "zh");
    window.history.replaceState({}, "", "/account/voice/faq");
    const user = userEvent.setup();
    const fake = new FakeVoice();
    fake.add("可以刷卡嗎？", "可以。", [], false);
    fake.install();
    renderFaq(fake);
    expect(await screen.findByText("已用 9 / 6,000 字・1 / 120 題")).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "常見問答" })).toBeVisible();
    for (const name of ["新增問答", "從範本帶入", "匯入 CSV", "儲存介紹", "套用", "查看 AI 會收到的完整內容"]) expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByText("寫地址、交通、服務項目、價格這些客人常問的事實。營業時間請在「設定」填，不用寫在這裡。")).toBeVisible();
    expect(within(rowOf("可以刷卡嗎？")!).getByText("不讓 AI 回答")).toBeVisible();

    await user.click(within(rowOf("可以刷卡嗎？")!).getByRole("button", { name: "刪除" }));
    const dialog = screen.getByRole("dialog", { name: "要刪除這題嗎？" });
    expect(dialog).toHaveTextContent("「可以刷卡嗎？」刪除後無法復原。已套用的版本不受影響，直到你下次套用。");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    await user.click(screen.getByRole("button", { name: "從範本帶入" }));
    expect(screen.getByRole("dialog", { name: "從「診所」範本帶入" })).toHaveTextContent("也帶入範本的店家介紹（會取代目前的介紹）");
    await user.click(screen.getByRole("button", { name: "取消" }));

    await user.click(screen.getByRole("button", { name: "匯入 CSV" }));
    const csv = screen.getByRole("dialog", { name: "匯入 CSV" });
    await user.upload(within(csv).getByLabelText("CSV 檔案"), csvFile("問題,答案\n洗牙多少錢？,\n"));
    await user.click(within(csv).getByRole("button", { name: "檢查" }));
    expect(await within(csv).findByRole("listitem")).toHaveTextContent("第 2 列：缺少答案");
  });
});

describe("phone agent FAQ inside the account shell", () => {
  it("loads after M1 and asks the shell to re-read M1 after a write", async () => {
    const user = userEvent.setup();
    const fake = new FakeVoice().install();
    render(
      <LocaleProvider>
        <AccountPortal section="voice" voiceSub="faq" />
      </LocaleProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Add a question" }));
    expect(screen.getByText(/You have changes that are not applied yet/)).toBeVisible();
    const form = screen.getByRole("form", { name: "New question" });
    await user.type(within(form).getByLabelText("Question"), "營業到幾點？");
    await user.type(within(form).getByLabelText("Answer"), "晚上九點。");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.calls.filter((call) => call.path === "/me/voice")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByText(/You have changes that are not applied yet/)).not.toBeInTheDocument());
    expect(screen.getByText(/^Applied: version 1 \(/)).toBeVisible();
    const paths = fake.calls.map((call) => `${call.method} ${call.path}`).filter((call) => call !== "GET /me/engineer");
    expect(paths.slice(0, 3)).toEqual(["GET /session", "GET /me/voice", "GET /me/voice/faqs"]);
  });
});

describe("FAQ helpers", () => {
  it("turns the one-per-line field into the variants array", () => {
    expect(variantsFromText(" 洗牙費用 \r\n\n洗牙要錢嗎\r ")).toEqual(["洗牙費用", "洗牙要錢嗎"]);
    expect(variantsFromText("")).toEqual([]);
  });

  it("counts code points after trimming, like the server's len()", () => {
    expect(faqCharCount(" 問😀 ", "答\n案", ["𠀋"])).toBe(2 + 3 + 1);
  });

  it("finds the same placeholders as the contract regex", () => {
    expect(placeholderParts("自費（請填入：價格）元，（請填入）。（請填入：一二三四五六七八九十一二三四五六七八九十一）")).toEqual([
      { text: "自費", placeholder: false },
      { text: "（請填入：價格）", placeholder: true },
      { text: "元，", placeholder: false },
      { text: "（請填入）", placeholder: true },
      { text: "。（請填入：一二三四五六七八九十一二三四五六七八九十一）", placeholder: false },
    ]);
  });

  it("places a moved question and renumbers like the server", () => {
    const faq = (id: string, position: number) =>
      ({ id, question: id, answer: id, variants: [], aiAllowed: true, position, chars: 2, needsInput: false, updatedAt: "" }) as VoiceFaq;
    const list = [faq("a", 0), faq("b", 1), faq("c", 2)];
    expect(placeFaq(list, { ...list[0], position: 2 }).map((item) => [item.id, item.position])).toEqual([["b", 0], ["c", 1], ["a", 2]]);
    expect(placeFaq(list, { ...list[2], position: 9 }).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("has copy for every CSV problem code and every FAQ error code", () => {
    for (const problem of CSV_PROBLEMS) expect(csvProblemText(problem, "zh")).not.toMatch(/這一列有問題（/);
    expect(csvProblemText("something_new", "en")).toBe("This row has a problem (something_new)");
    for (const code of ["faq_not_found", "template_not_found", "faq_too_long", "kb_too_large", "faq_limit", "kb_empty", "csv_invalid", "store_suspended"]) {
      const text = voiceErrorText(new PortalError(400, code, "x"), "en");
      expect(text).not.toMatch(/Check that the fields meet the requirements/);
    }
    expect(voiceErrorText(new PortalError(413, "invalid_input", "x"), "zh")).toBe("內容太大。");
    expect(voiceErrorText(new PortalError(429, "voice_publish_limit", "x"), "zh")).toBe("最近 24 小時套用太多次了，請稍後再試。");
    expect(voiceErrorText(new PortalError(400, "invalid_input", "x"), "en")).toMatch(/Check that the fields meet the requirements/);
  });

  it("reports the first capacity problem in the server's order", () => {
    const limits = { questionChars: 100, variantChars: 50, variantsMax: 10, faqChars: 400 };
    const capacity = { kbChars: 5990, kbCharsMax: 6000, faqCount: 120, faqMax: 120, introChars: 0 };
    const draft = { question: "問", answer: "答".repeat(400), variantsText: "", aiAllowed: true };
    expect(faqDraftProblems(draft, limits, capacity, 0, true).capacity).toBe("faq_too_long");
    expect(faqDraftProblems({ ...draft, answer: "答" }, limits, capacity, 0, true).capacity).toBe("faq_limit");
    expect(faqDraftProblems({ ...draft, answer: "答".repeat(10) }, limits, capacity, 0, false).capacity).toBe("kb_too_large");
    expect(faqDraftProblems({ ...draft, answer: "答".repeat(10) }, limits, capacity, 10, false).capacity).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Front/back enum sync (LESSONS 2026-10-21). On the merged branch (feat/voice-p1) the backend is in
// the tree, so these checks always run: a missing backend file or constant fails instead of skipping.
// server/test_voice_sync.py checks the same lists from the Python side.
// ---------------------------------------------------------------------------------------------

const SERVER = join(process.cwd(), "server");
const serverSources = () =>
  existsSync(SERVER)
    ? readdirSync(SERVER)
        .filter((name) => name.endsWith(".py") && !name.startsWith("test_"))
        .map((name) => readFileSync(join(SERVER, name), "utf8"))
    : [];

/** `NAME = ("a", "b")` (one or more lines) in Python source → ["a", "b"]; null when not defined. */
function pythonTuple(source: string, name: string): string[] | null {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*[(\\[]([^)\\]]*)[)\\]]`, "m"));
  return match ? [...match[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((item) => item[1] ?? item[2]) : null;
}
/** `NAME = re.compile(r"...")` in Python source → the pattern; null when not defined. */
function pythonRegex(source: string, name: string): string | null {
  return source.match(new RegExp(`^${name}\\s*=\\s*re\\.compile\\(r"([^"]*)"\\)`, "m"))?.[1] ?? null;
}

describe("front/back enum sync", () => {
  const sources = serverSources();

  it("reads Python tuples and regexes the way the backend writes them", () => {
    // The PLACEHOLDER line as T2 wrote it in server/voice_compile.py (feat/voice-p1-prompt e0cba1e).
    expect(pythonRegex('PLACEHOLDER = re.compile(r"（請填入(?:：[^）\\n]{1,20})?）")\n', "PLACEHOLDER")).toBe(PLACEHOLDER.source);
    expect(pythonTuple('MODES = (\n    "append",\n    "replace",\n)\n', "MODES")).toEqual(["append", "replace"]);
    expect(pythonTuple("X = ('a', 'b')", "Y")).toBeNull();
  });

  it("uses the placeholder regex of server/voice_compile.py", () => {
    expect(pythonRegex(readFileSync(join(SERVER, "voice_compile.py"), "utf8"), "PLACEHOLDER")).toBe(PLACEHOLDER.source);
  });

  it("knows every CSV problem code the backend can report (CSV_PROBLEMS)", () => {
    const backend = sources.map((source) => pythonTuple(source, "CSV_PROBLEMS")).find((tuple) => tuple !== null);
    expect(backend, "define CSV_PROBLEMS = (...) next to the CSV import so this test can compare it").toBeDefined();
    expect(new Set(backend)).toEqual(new Set(CSV_PROBLEMS));
  });

  it("sends only the import modes the backend accepts (IMPORT_MODES)", () => {
    const backend = sources.map((source) => pythonTuple(source, "IMPORT_MODES")).find((tuple) => tuple !== null);
    expect(backend, "define IMPORT_MODES = (...) for M8/M9 so this test can compare it").toBeDefined();
    expect(new Set(backend)).toEqual(new Set(IMPORT_MODES));
  });
});
