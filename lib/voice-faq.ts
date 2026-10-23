/**
 * Phone agent FAQ page (/account/voice/faq, phase 1 T8): API shapes, client-side checks and copy for
 * error codes. Shapes follow the phase 1 contract §3.4-§3.11; the backend (T4) is authoritative, these
 * checks only stop a request that would certainly be refused.
 */
import type { VoiceLimits } from "../components/account-voice";
import { codePoints, lineProblem, textProblem, type TextProblem } from "./admin-text";
import { PortalError, portalErrorText } from "./portal-client";

type Locale = "en" | "zh";

/** Faq (contract §3): position is 0-based and contiguous; chars and needsInput are computed by the server. */
export type VoiceFaq = {
  id: string;
  question: string;
  answer: string;
  variants: string[];
  aiAllowed: boolean;
  position: number;
  chars: number;
  needsInput: boolean;
  updatedAt: string;
};

export type VoiceCapacity = {
  kbChars: number;
  kbCharsMax: number;
  faqCount: number;
  faqMax: number;
  introChars: number;
};

export type VoiceTemplateInfo =
  | { available: false }
  | { available: true; templateId: string; title: { zh: string; en: string }; faqCount: number };

/** M4 GET /me/voice/faqs. */
export type VoiceFaqList = {
  introText: string;
  faqs: VoiceFaq[];
  capacity: VoiceCapacity;
  template: VoiceTemplateInfo;
};

/** M5 (201) and M6 (200). */
export type VoiceFaqWrite = { faq: VoiceFaq; capacity: VoiceCapacity };
/** M7. */
export type VoiceFaqDeleted = { ok: true; capacity: VoiceCapacity };

/** `mode` of M8 and M9; the backend accepts exactly these two. */
export const IMPORT_MODES = ["append", "replace"] as const;

/**
 * The example CSV the import dialog offers for download (verifier finding 2026-10-22: there was no sample file).
 * server/test_voice_sync.py parses these rows with the real importer and expects no problems. No double quotes here.
 */
export const CSV_EXAMPLE_ROWS = [
  "問題,答案,相似問法",
  "洗牙多少錢？,健保洗牙每半年一次免費；自費洗牙 800 元。,洗牙費用｜洗牙要錢嗎",
  "可以刷卡嗎？,可以，接受信用卡和行動支付。,",
] as const;

/** UTF-8 with a byte-order mark and CRLF line ends, which Excel opens as Chinese text. */
export const csvExampleHref = () =>
  `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${CSV_EXAMPLE_ROWS.join("\r\n")}\r\n`)}`;
export type ImportMode = (typeof IMPORT_MODES)[number];

/** Every `problem` value M8 can report for a CSV row (contract §5.5). */
export const CSV_PROBLEMS = [
  "header_invalid",
  "question_required",
  "answer_required",
  "question_too_long",
  "variant_too_long",
  "too_many_variants",
  "faq_too_long",
  "unsafe_text",
  "csv_unparseable",
] as const;
export type CsvProblem = (typeof CSV_PROBLEMS)[number];

/** M8 with dryRun: true (200). */
export type VoiceCsvCheck = {
  dryRun: true;
  ok: boolean;
  rows: number;
  errors: { row: number; problem: string }[];
  errorsTruncated: boolean;
  result: { faqCount: number; kbChars: number };
  capacityProblem: null | "faq_limit" | "kb_too_large";
};

/** M8 with dryRun: false (200). */
export type VoiceCsvImported = { imported: number; mode: ImportMode; faqs: VoiceFaq[]; capacity: VoiceCapacity };

/** M9 (200). The response has no introText: reload M4 when introReplaced is true. */
export type VoiceTemplateApplied = {
  added: number;
  needsInput: number;
  introReplaced: boolean;
  faqs: VoiceFaq[];
  capacity: VoiceCapacity;
};

/** M3 (200) as far as this page reads it. */
export type VoiceSetupSaved = { changed: string[] };

export type VoiceWarning = { code: string; field: string | null; faq_id: string | null };

/** The parts of voice.store-config/v1 (contract §5.1) the preview shows. */
export type VoiceConfigPreview = {
  version: number;
  shop_name: string;
  opening: { text: string; est_seconds: number };
  prompt: { prefix: string };
  rules: { no_ai_questions: string[] };
  kb_chars: number;
  warnings: VoiceWarning[];
};

/** M10 GET /me/voice/preview. config is null when the draft does not compile (see problems). */
export type VoicePreview = {
  basedOnVersion: number | null;
  nextVersion: number;
  config: VoiceConfigPreview | null;
  configSha256: string | null;
  hasUnpublishedChanges: boolean;
  problems: { code: string; detail: string }[];
};

/** M11 POST /me/voice/publish (200). */
export type VoicePublished = {
  changed: boolean;
  version: number;
  configSha256: string;
  publishedAt: string;
  warnings: VoiceWarning[];
};

/**
 * The "to be filled in" marker (contract §1.4): 「（請填入）」 or 「（請填入：洗牙費用）」, full-width brackets.
 * The source must stay identical to server/voice_compile.py PLACEHOLDER (a test compares them).
 */
export const PLACEHOLDER = /（請填入(?:：[^）\n]{1,20})?）/;

export const hasPlaceholder = (text: string) => PLACEHOLDER.test(text);

/** Splits text into plain and placeholder parts, so the page can mark what still needs filling in. */
export function placeholderParts(text: string): { text: string; placeholder: boolean }[] {
  const parts: { text: string; placeholder: boolean }[] = [];
  const pattern = new RegExp(PLACEHOLDER.source, "g");
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), placeholder: false });
    parts.push({ text: match[0], placeholder: true });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), placeholder: false });
  return parts;
}

/** The first placeholder in a text, or null. */
export function firstPlaceholder(text: string): string | null {
  return text.match(PLACEHOLDER)?.[0] ?? null;
}

/** "Other ways to ask" is one per line in the form; the API takes an array (blank lines dropped). */
export function variantsFromText(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** One question's size (contract §5.2): question + answer + every variant, each trimmed. */
export function faqCharCount(question: string, answer: string, variants: string[]): number {
  return codePoints(question.trim()) + codePoints(answer.trim()) + variants.reduce((sum, item) => sum + codePoints(item.trim()), 0);
}

export type FaqDraft = { question: string; answer: string; variantsText: string; aiAllowed: boolean };

export type FaqDraftProblems = {
  question: TextProblem;
  answer: TextProblem;
  /** "long" means one line is over variantChars; "count" means more than variantsMax lines. */
  variants: "unsafe" | "long" | "count" | null;
  /** The question would be over faqChars, or the knowledge base over kbCharsMax, or there are already faqMax questions. */
  capacity: "faq_too_long" | "kb_too_large" | "faq_limit" | null;
  chars: number;
};

export type FaqLimits = Pick<VoiceLimits, "questionChars" | "variantChars" | "variantsMax" | "faqChars">;

/**
 * Mirrors the M5/M6 checks (contract §3.5) in the same order, so the form can say what to fix before
 * sending. `previousChars` is the edited question's current size (0 for a new one).
 */
export function faqDraftProblems(
  draft: FaqDraft,
  limits: FaqLimits,
  capacity: VoiceCapacity,
  previousChars: number,
  isNew: boolean,
): FaqDraftProblems {
  const variants = variantsFromText(draft.variantsText);
  const chars = faqCharCount(draft.question, draft.answer, variants);
  const question = lineProblem(draft.question, limits.questionChars);
  const answerText = draft.answer.trim();
  const answer: TextProblem = !answerText ? "empty" : textProblem(answerText, limits.faqChars);
  // Each variant is a single-line field (tabs and invisible characters are refused like the server's text_value).
  const variantLine = draft.variantsText
    .split(/\r\n|\r|\n/)
    .map((line) => lineProblem(line, limits.variantChars, false))
    .find((problem) => problem !== null);
  const variantsProblem =
    variantLine === "unsafe" ? "unsafe" : variantLine === "long" ? "long" : variants.length > limits.variantsMax ? "count" : null;
  let capacityProblem: FaqDraftProblems["capacity"] = null;
  if (chars > limits.faqChars) capacityProblem = "faq_too_long";
  else if (isNew && capacity.faqCount >= capacity.faqMax) capacityProblem = "faq_limit";
  else if (capacity.kbChars - previousChars + chars > capacity.kbCharsMax) capacityProblem = "kb_too_large";
  return { question, answer, variants: variantsProblem, capacity: capacityProblem, chars };
}

export const draftIsValid = (problems: FaqDraftProblems) =>
  !problems.question && !problems.answer && !problems.variants && !problems.capacity;

/** M5/M6 body from the form. */
export function faqBody(draft: FaqDraft) {
  return {
    question: draft.question.trim(),
    answer: draft.answer.trim(),
    variants: variantsFromText(draft.variantsText),
    aiAllowed: draft.aiAllowed,
  };
}

/** Puts a written question at its new position and renumbers the list 0..n-1, as the server does. */
export function placeFaq(faqs: VoiceFaq[], written: VoiceFaq): VoiceFaq[] {
  const rest = faqs.filter((item) => item.id !== written.id);
  const index = Math.max(0, Math.min(written.position, rest.length));
  rest.splice(index, 0, written);
  return rest.map((item, position) => (item.position === position ? item : { ...item, position }));
}

/** Removes a question and renumbers the rest. */
export function removeFaq(faqs: VoiceFaq[], id: string): VoiceFaq[] {
  return faqs.filter((item) => item.id !== id).map((item, position) => (item.position === position ? item : { ...item, position }));
}

/** Size in bytes of the exact JSON body M8 receives; the BFF and backend refuse more than limits.csvBodyBytes. */
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

export type CsvFileResult = { ok: true; text: string } | { ok: false; reason: "too_large" | "encoding" };

/**
 * Reads a CSV file as UTF-8 after checking its size (before reading it). A file that is not valid UTF-8,
 * or that decodes to U+FFFD, is refused with "encoding" (contract §5.5: tell the store to save as UTF-8).
 */
export async function readCsvFile(file: Blob, maxBytes: number): Promise<CsvFileResult> {
  if (file.size > maxBytes) return { ok: false, reason: "too_large" };
  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { ok: false, reason: "encoding" };
  }
  if (text.includes("\ufffd")) return { ok: false, reason: "encoding" };
  return { ok: true, text };
}

const pick = (locale: Locale, en: string, zh: string) => (locale === "zh" ? zh : en);
const number = (value: number) => value.toLocaleString("en-US");

/** Contract §8.3: why a CSV row was refused. Unknown codes are shown with the code so nothing is hidden. */
export function csvProblemText(problem: string, locale: Locale): string {
  switch (problem) {
    case "header_invalid":
      return pick(locale, "Row 1 must have 問題 and 答案 columns", "第一列要有「問題」和「答案」兩個欄名");
    case "question_required":
      return pick(locale, "Missing question", "缺少問題");
    case "answer_required":
      return pick(locale, "Missing answer", "缺少答案");
    case "question_too_long":
      return pick(locale, "Question over 100 characters", "問題超過 100 字");
    case "variant_too_long":
      return pick(locale, "An alternative phrasing is over 50 characters", "有相似問法超過 50 字");
    case "too_many_variants":
      return pick(locale, "More than 10 alternative phrasings", "相似問法超過 10 個");
    case "faq_too_long":
      return pick(locale, "This question is over 400 characters in total", "這題合計超過 400 字");
    case "unsafe_text":
      return pick(locale, "Contains a control or hidden character", "含有控制字元或隱藏字元");
    case "csv_unparseable":
      return pick(locale, "This row could not be read; later rows were not checked", "這一列讀不出來（格式錯誤），之後的列沒有檢查");
    default:
      return pick(locale, `This row has a problem (${problem})`, `這一列有問題（${problem}）`);
  }
}

type CapacityLimits = { faqChars?: number; kbCharsMax?: number; faqMax?: number };

/** Contract §9 for the codes this page can receive; anything else falls back to portalErrorText. */
export function voiceErrorText(error: unknown, locale: Locale, limits: CapacityLimits = {}): string {
  const faqChars = number(limits.faqChars ?? 400);
  const kbCharsMax = number(limits.kbCharsMax ?? 6000);
  const faqMax = number(limits.faqMax ?? 120);
  if (error instanceof PortalError) {
    switch (error.code) {
      case "voice_store_not_found":
        return pick(locale, "Phone agent is not set up for this account.", "這個帳號沒有開通電話客服。");
      case "faq_not_found":
        return pick(locale, "This question no longer exists. Reload the page.", "這題已經不存在，請重新整理。");
      case "template_not_found":
        return pick(locale, "There is no template for this industry yet.", "這個產業還沒有範本。");
      case "password_change_required":
        return pick(
          locale,
          "Change the temporary password we gave you under Security before editing or trying a call.",
          "請先到「安全性」變更我們發給你的臨時密碼，再修改設定或試打。",
        );
      case "store_suspended":
        return pick(locale, "Phone agent is suspended for this store; it is read-only.", "這家店的電話客服已暫停，目前只能查看。");
      case "opening_too_long":
        return pick(locale, "The opening is longer than 15 seconds. Shorten the greeting.", "開場超過 15 秒，請縮短開場白。");
      case "faq_too_long":
        return pick(
          locale,
          `One question (question, answer and alternatives) can be up to ${faqChars} characters.`,
          `一題（問題、答案、相似問法合計）最多 ${faqChars} 字。`,
        );
      case "kb_too_large":
        return pick(
          locale,
          `The store description and all questions together can be up to ${kbCharsMax} characters.`,
          `店家介紹加上所有問答最多 ${kbCharsMax} 字。`,
        );
      case "faq_limit":
        return pick(locale, `Up to ${faqMax} questions.`, `最多 ${faqMax} 題。`);
      case "kb_empty":
        return pick(
          locale,
          "There is nothing to apply yet. Add a store description or a question first.",
          "還沒有任何內容。請先填店家介紹或新增問答。",
        );
      case "csv_invalid":
        return pick(locale, 'The CSV has problems; nothing was imported. Use "Check" first.', "CSV 有錯誤，沒有匯入任何資料。請先按「檢查」。");
      case "voice_publish_limit":
        return pick(locale, "You have applied many new versions in the last 24 hours. Try again later.", "最近 24 小時套用太多次了，請稍後再試。");
      case "invalid_input":
        if (error.status === 413) return pick(locale, "The content is too large.", "內容太大。");
        break;
    }
  }
  return portalErrorText(error, locale);
}

/** Capacity codes reported without an HTTP error (dry-run capacityProblem, preview problems). */
export const codeError = (code: string, status = 400) => new PortalError(status, code, code);
