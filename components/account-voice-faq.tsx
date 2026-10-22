"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { codePoints, unsafeMessage } from "../lib/admin-text";
import { PortalError, portalRequest } from "../lib/portal-client";
import {
  codeError,
  csvExampleHref,
  csvProblemText,
  draftIsValid,
  faqBody,
  faqDraftProblems,
  firstPlaceholder,
  placeFaq,
  IMPORT_MODES,
  placeholderParts,
  readCsvFile,
  removeFaq,
  utf8Bytes,
  voiceErrorText,
  type FaqDraft,
  type ImportMode,
  type VoiceCapacity,
  type VoiceCsvCheck,
  type VoiceCsvImported,
  type VoiceFaq,
  type VoiceFaqDeleted,
  type VoiceFaqList,
  type VoiceFaqWrite,
  type VoicePreview,
  type VoicePublished,
  type VoiceSetupSaved,
  type VoiceTemplateApplied,
} from "../lib/voice-faq";
import type { VoiceSubProps } from "./account-voice";
import { useLocale } from "./locale-provider";

type Copy = { en: string; zh: string };

/** Fixed strings (contract §8.3; additions are listed in the T8 report). */
const T = {
  title: { en: "FAQ", zh: "常見問答" },
  loading: { en: "Loading questions…", zh: "正在載入常見問答…" },
  retry: { en: "Try again", zh: "重新載入" },
  working: { en: "Working…", zh: "處理中…" },
  introTitle: { en: "About the store", zh: "店家介紹" },
  introHint: {
    en: "Write facts callers ask about: address, directions, services, prices. Set business hours on Setup instead of here.",
    zh: "寫地址、交通、服務項目、價格這些客人常問的事實。營業時間請在「設定」填，不用寫在這裡。",
  },
  introSave: { en: "Save", zh: "儲存介紹" },
  introSaved: { en: "Store description saved.", zh: "已儲存店家介紹。" },
  introUnchanged: { en: "Nothing changed.", zh: "內容沒有變更。" },
  questionsTitle: { en: "Questions", zh: "問答" },
  add: { en: "Add a question", zh: "新增問答" },
  useTemplate: { en: "Use the template", zh: "從範本帶入" },
  importCsv: { en: "Import CSV", zh: "匯入 CSV" },
  empty: { en: "No questions yet. Start from the template or add them one by one.", zh: "還沒有常見問答。可以從範本帶入，或一題一題新增。" },
  emptyNoTemplate: { en: "No questions yet. Add them one by one, or import a CSV.", zh: "還沒有常見問答。可以一題一題新增，或匯入 CSV。" },
  needsInput: { en: "Needs input", zh: "需要填寫" },
  onlyNeedsInput: { en: "Show only questions that need input", zh: "只顯示需要填寫的題目" },
  showAll: { en: "Show all questions", zh: "顯示全部題目" },
  allFilled: { en: "Every question is filled in.", zh: "需要填寫的題目都填好了。" },
  tryFirst: {
    en: 'You do not have to fill them all in now: use "Apply" below and try a call first, then fill in the rest.',
    zh: "不用一次填完：可以先按下方「套用」，試打一通聽聽看，之後再慢慢補。",
  },
  noAi: { en: "No AI answer", zh: "不讓 AI 回答" },
  edit: { en: "Edit", zh: "編輯" },
  moveUp: { en: "Move up", zh: "上移" },
  moveDown: { en: "Move down", zh: "下移" },
  delete: { en: "Delete", zh: "刪除" },
  colOrder: { en: "#", zh: "#" },
  colQuestion: { en: "Question", zh: "問題" },
  colAnswer: { en: "Answer", zh: "答案" },
  colActions: { en: "Actions", zh: "動作" },
  otherWays: { en: "Other ways to ask: ", zh: "相似問法：" },
  formNew: { en: "New question", zh: "新增問答" },
  formEdit: { en: "Edit question", zh: "編輯問答" },
  question: { en: "Question", zh: "問題" },
  answer: { en: "Answer", zh: "答案" },
  variants: { en: "Other ways to ask (one per line, optional)", zh: "相似問法（一行一個，選填）" },
  noAiCheck: {
    en: "Do not let the AI answer this (the AI will say someone will call back)",
    zh: "這題不要讓 AI 回答（客人問到時，AI 會說會請專人回電）",
  },
  save: { en: "Save", zh: "儲存" },
  cancel: { en: "Cancel", zh: "取消" },
  questionEmpty: { en: "Enter the question.", zh: "請填寫問題。" },
  answerEmpty: { en: "Enter the answer.", zh: "請填寫答案。" },
  deleteTitle: { en: "Delete this question?", zh: "要刪除這題嗎？" },
  templateMode: { en: "How to add them", zh: "帶入方式" },
  modeAppend: { en: "Add after existing questions", zh: "加在現有問答後面" },
  modeReplace: { en: "Replace all questions", zh: "取代現有的全部問答" },
  templateIntro: {
    en: "Also use the template's store description (replaces the current one)",
    zh: "也帶入範本的店家介紹（會取代目前的介紹）",
  },
  templateNote: {
    en: "Replace every \"（請填入）\" with your store's details, or the AI may read it aloud.",
    zh: "範本裡寫著「（請填入）」的地方，請換成你們店的實際資料，否則 AI 可能會照著念。",
  },
  templateApply: { en: "Use template", zh: "帶入" },
  csvTitle: { en: "Import CSV", zh: "匯入 CSV" },
  csvFormat: {
    en: "Row 1 is the header: 問題 (question), 答案 (answer), 相似問法 (other ways to ask, optional), separated by ｜. Save as UTF-8 (\"CSV UTF-8\" in Excel).",
    zh: "第一列是欄名：問題、答案、相似問法（可省略）。相似問法用「｜」分隔。請存成 UTF-8（Excel 選「CSV UTF-8」）。",
  },
  csvFile: { en: "CSV file", zh: "CSV 檔案" },
  csvExample: { en: "Download an example CSV", zh: "下載範例 CSV" },
  csvMode: { en: "Import mode", zh: "匯入方式" },
  csvCheck: { en: "Check", zh: "檢查" },
  csvImport: { en: "Import", zh: "匯入" },
  csvChooseFile: { en: "Choose a CSV file first.", zh: "請先選擇 CSV 檔案。" },
  csvTruncated: { en: "There are more problems; fix these first.", zh: "還有更多錯誤，請先修正上面這些。" },
  csvNoRows: { en: "This file has no question rows.", zh: "這個檔案沒有任何問答列。" },
  csvTooLarge: { en: "The file is too large (limit 192 KB).", zh: "檔案太大（上限 192 KB）。" },
  csvEncoding: {
    en: "This file does not look like UTF-8. In Excel, save as \"CSV UTF-8\" and try again.",
    zh: "這個檔案看起來不是 UTF-8。請在 Excel 選「CSV UTF-8」另存後再試。",
  },
  applyTitle: { en: "Apply", zh: "套用" },
  applyHint: {
    en: "Changes reach test calls only after you apply them: use \"Apply\" here, or \"Save and apply\" on ",
    zh: "修改後要套用，試打才會用到：在這裡按「套用」，或到「",
  },
  applyHintSetup: { en: "Setup", zh: "設定" },
  applyHintEnd: { en: ".", zh: "」按「儲存並套用」。" },
  apply: { en: "Apply", zh: "套用" },
  tryLink: { en: "Try a call", zh: "試打一通" },
  hoursEmpty: {
    en: "No business hours yet; the AI will treat every call as after hours.",
    zh: "還沒設定營業時間，AI 會一直當作下班時間。",
  },
  previewShow: { en: "Show everything the AI receives", zh: "查看 AI 會收到的完整內容" },
  previewHide: { en: "Hide what the AI receives", zh: "收合 AI 會收到的內容" },
  previewLoading: { en: "Compiling the draft…", zh: "正在整理草稿…" },
  previewBrackets: {
    en: "In what the AI receives, 【】 and 〖〗 in your text become 「」 (so do their vertical and half-width forms, such as ︻︼ and ｢｣), and brackets inside quotes become 『』, so store text cannot pose as rules. What you saved is not changed.",
    zh: "AI 收到的內容裡，你寫的【】和〖〗會換成「」（直書、半形的同類括號如︻︼、｢｣也一樣），引號裡面的括號會換成『』，避免店家文字被當成規則。你存的原文不會被改。",
  },
  previewOpening: { en: "Opening", zh: "開場" },
  previewPrompt: { en: "Rules and store details", zh: "規則與店家資料" },
  previewNoAi: { en: "Questions the AI will not answer", zh: "AI 不回答的問題" },
} satisfies Record<string, Copy>;

const formatNumber = (value: number) => value.toLocaleString("en-US");
const BLANK: FaqDraft = { question: "", answer: "", variantsText: "", aiAllowed: true };

/** A modal <dialog> like the account page's revoke dialog (jsdom has no showModal, so `open` is set instead). */
function Modal({ labelledBy, busy, onClose, children }: { labelledBy: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    element.querySelector<HTMLElement>("input, button")?.focus();
    return () => {
      if (typeof element.close === "function") element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="portal-dialog"
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

/** Text with every "（請填入…）" marked, so the store sees what still needs filling in. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {placeholderParts(text).map((part, index) => (part.placeholder ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
    </>
  );
}

type CapacityLimits = { faqChars: number; kbCharsMax: number; faqMax: number };
type Message = { kind: "ok" | "error"; content: ReactNode } | null;

function MessageLine({ message }: { message: Message }) {
  if (!message) return null;
  return message.kind === "error" ? (
    <p className="portal-error" role="alert">
      {message.content}
    </p>
  ) : (
    <p className="portal-note" role="status">
      {message.content}
    </p>
  );
}

/** The dry run result (contract §3.8): rows that can be imported, or every row problem the backend listed. */
function CsvCheckResult({ check, locale, limits }: { check: VoiceCsvCheck; locale: "en" | "zh"; limits: CapacityLimits }) {
  const zh = locale === "zh";
  if (check.ok)
    return (
      <p className="portal-note" role="status">
        {zh
          ? `共 ${check.rows} 題可以匯入。匯入後共 ${check.result.faqCount} 題、${formatNumber(check.result.kbChars)} 字。`
          : `${check.rows} questions can be imported. Afterwards: ${check.result.faqCount} questions, ${formatNumber(check.result.kbChars)} characters.`}
      </p>
    );
  return (
    <div role="alert">
      {check.errors.length > 0 && (
        <ul className="portal-error" aria-label={zh ? "CSV 錯誤" : "CSV problems"}>
          {check.errors.map((item, index) => (
            <li key={`${item.row}-${index}`}>
              {zh ? `第 ${item.row} 列：${csvProblemText(item.problem, locale)}` : `Row ${item.row}: ${csvProblemText(item.problem, locale)}`}
            </li>
          ))}
        </ul>
      )}
      {check.errorsTruncated && <p className="portal-error">{T.csvTruncated[locale]}</p>}
      {check.errors.length === 0 && check.rows === 0 && <p className="portal-error">{T.csvNoRows[locale]}</p>}
      {check.capacityProblem && (
        <p className="portal-error">
          {voiceErrorText(codeError(check.capacityProblem), locale, limits)}{" "}
          {zh
            ? `（匯入後會有 ${check.result.faqCount} 題、${formatNumber(check.result.kbChars)} 字）`
            : `(afterwards: ${check.result.faqCount} questions, ${formatNumber(check.result.kbChars)} characters)`}
        </p>
      )}
    </div>
  );
}

/** /account/voice/faq (contract §8.3): store description, questions, template, CSV import, preview and apply. */
export function AccountVoiceFaq({ summary, onChanged }: VoiceSubProps): ReactElement {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const t = (copy: Copy) => copy[locale];
  const limits = summary.limits;
  // GET is never blocked, but writes are refused for a suspended store or a temporary password (the shell says why).
  const readOnly = summary.store.status === "suspended" || summary.account.passwordChangeRequired;

  const [load, setLoad] = useState<{ status: "loading" } | { status: "ready" } | { status: "error"; error: unknown }>({ status: "loading" });
  const [list, setList] = useState<VoiceFaqList | null>(null);
  /** The saved store description and the one being typed. */
  const [intro, setIntro] = useState({ saved: "", draft: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<Message>(null);
  const [introMessage, setIntroMessage] = useState<Message>(null);

  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [draft, setDraft] = useState<FaqDraft>(BLANK);
  const [attempted, setAttempted] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);

  // Verifier finding 2026-10-22: a template brings 27 questions to fill among 37; this shows just those.
  const [onlyNeedsInput, setOnlyNeedsInput] = useState(false);
  /**
   * Element ids to focus after a write re-renders the list, first usable one wins. A save, delete or move removes
   * or moves the focused button, which left keyboard focus on <body> (verifier finding 2026-10-22).
   */
  const [focusIds, setFocusIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (focusIds === null) return;
    const usable = (element: HTMLElement | null) => element !== null && !(element instanceof HTMLButtonElement && element.disabled);
    const target = [...focusIds, "voice-faq-questions"].map((id) => document.getElementById(id)).find(usable);
    target?.focus();
    setFocusIds(null);
  }, [focusIds]);

  const [deleting, setDeleting] = useState<VoiceFaq | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateMode, setTemplateMode] = useState<ImportMode>("append");
  const [templateIntro, setTemplateIntro] = useState(false);
  const [templateError, setTemplateError] = useState<unknown>(null);

  const [csvOpen, setCsvOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvMode, setCsvMode] = useState<ImportMode>("append");
  /** The dry run result and the exact CSV and mode it checked; Import sends those with dryRun false. */
  const [csvCheck, setCsvCheck] = useState<{ result: VoiceCsvCheck; csv: string; mode: ImportMode } | null>(null);
  const [csvError, setCsvError] = useState<ReactNode>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ status: "loading" } | { status: "ready"; data: VoicePreview } | { status: "error"; error: unknown }>({
    status: "loading",
  });
  const [publishMessage, setPublishMessage] = useState<Message>(null);

  const capacityLimits: CapacityLimits = {
    faqChars: limits.faqChars,
    kbCharsMax: list?.capacity.kbCharsMax ?? limits.kbCharsMax,
    faqMax: list?.capacity.faqMax ?? limits.faqMax,
  };

  /** Error copy by code (contract §9); the temporary-password case links to Security. */
  const errorContent = (error: unknown): ReactNode => {
    if (error instanceof PortalError && error.code === "password_change_required")
      return (
        <>
          {zh ? "請先到「" : "Change the temporary password we gave you under "}
          <Link href="/account/security">{zh ? "安全性" : "Security"}</Link>
          {zh ? "」變更我們發給你的臨時密碼，再修改設定或試打。" : " before editing or trying a call."}
        </>
      );
    return voiceErrorText(error, locale, capacityLimits);
  };
  const errorBlock = (error: unknown) => <MessageLine message={{ kind: "error", content: errorContent(error) }} />;

  /** forceIntro replaces the description being typed; otherwise it is kept unless it still equals the saved one. */
  const loadList = useCallback(async (options: { signal?: AbortSignal; forceIntro?: boolean } = {}) => {
    const { signal, forceIntro = false } = options;
    try {
      const next = await portalRequest<VoiceFaqList>("/me/voice/faqs", signal ? { signal } : {});
      if (signal?.aborted) return;
      setList(next);
      setIntro((current) => ({
        saved: next.introText,
        draft: forceIntro || current.draft === current.saved ? next.introText : current.draft,
      }));
      setLoad({ status: "ready" });
    } catch (error) {
      if (signal?.aborted) return;
      setLoad((current) => (current.status === "ready" ? current : { status: "error", error }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadList({ signal: controller.signal });
    return () => controller.abort();
  }, [loadList]);

  /** One write at a time (a second click while busy sends nothing). Returns null when skipped. */
  async function write<R>(
    key: string,
    path: string,
    method: "POST" | "DELETE",
    body?: string,
  ): Promise<{ ok: true; value: R } | { ok: false; error: unknown } | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(key);
    try {
      const value = await portalRequest<R>(path, { method, ...(body === undefined ? {} : { body }) });
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error };
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const gone = (error: unknown) => error instanceof PortalError && error.code === "faq_not_found";

  function setFaqs(faqs: VoiceFaq[], capacity: VoiceCapacity) {
    setList((current) => (current ? { ...current, faqs, capacity } : current));
  }

  const label = (key: string, copy: Copy) => (busy === key ? t(T.working) : t(copy));
  /** Row buttons carry their question, so a screen reader's button list tells the 37 "Edit"s apart. */
  const rowLabel = (text: string, faq: VoiceFaq) => (zh ? `${text}：${faq.question}` : `${text}: ${faq.question}`);
  /** The Edit button of the row at `anchor` in `faqs` if it is shown, else of the next shown row, else the one before. */
  const rowFocus = (faqs: VoiceFaq[], anchor: number) => {
    const shown = (faq: VoiceFaq) => !onlyNeedsInput || faq.needsInput;
    const row = faqs.slice(Math.max(0, anchor)).find(shown) ?? faqs.slice(0, Math.max(0, anchor)).reverse().find(shown);
    return row ? [`voice-faq-edit-${row.id}`] : [];
  };

  // ---------- store description ----------
  async function saveIntro(event: FormEvent) {
    event.preventDefault();
    setIntroMessage(null);
    const result = await write<VoiceSetupSaved>("intro", "/me/voice/setup", "POST", JSON.stringify({ introText: intro.draft.trim() }));
    if (!result) return;
    if (!result.ok) {
      setIntroMessage({ kind: "error", content: errorContent(result.error) });
      return;
    }
    const changed = result.value.changed.includes("introText");
    setIntroMessage({ kind: "ok", content: t(changed ? T.introSaved : T.introUnchanged) });
    // M3 answers with the setup shape, which has no capacity: re-read M4 for the totals and the stored text.
    await loadList({ forceIntro: true });
    if (changed) onChanged();
  }

  // ---------- add / edit ----------
  function startNew() {
    setEditing({ id: null });
    setDraft(BLANK);
    setAttempted(false);
    setFormError(null);
    setNotice(null);
  }
  function startEdit(faq: VoiceFaq) {
    setEditing({ id: faq.id });
    setDraft({ question: faq.question, answer: faq.answer, variantsText: faq.variants.join("\n"), aiAllowed: faq.aiAllowed });
    setAttempted(false);
    setFormError(null);
    setNotice(null);
  }

  async function saveFaq(event: FormEvent) {
    event.preventDefault();
    if (!list || !editing) return;
    const edited = editing.id ? list.faqs.find((item) => item.id === editing.id) : undefined;
    setAttempted(true);
    if (!draftIsValid(faqDraftProblems(draft, limits, list.capacity, edited?.chars ?? 0, editing.id === null))) return;
    setFormError(null);
    const path = editing.id ? `/me/voice/faqs/${editing.id}` : "/me/voice/faqs";
    const result = await write<VoiceFaqWrite>("faq", path, "POST", JSON.stringify(faqBody(draft)));
    if (!result) return;
    if (!result.ok) {
      if (gone(result.error)) {
        // The row is about to disappear with its form, so the message goes to the page.
        setEditing(null);
        setNotice({ kind: "error", content: errorContent(result.error) });
        void loadList();
      } else setFormError(result.error);
      return;
    }
    const next = placeFaq(list.faqs, result.value.faq);
    setFaqs(next, result.value.capacity);
    setEditing(null);
    setFocusIds(rowFocus(next, next.findIndex((item) => item.id === result.value.faq.id)));
    onChanged();
  }

  // ---------- move / delete ----------
  async function move(faq: VoiceFaq, key: string, position: number) {
    if (!list) return;
    setNotice(null);
    const result = await write<VoiceFaqWrite>(key, `/me/voice/faqs/${faq.id}`, "POST", JSON.stringify({ position }));
    if (!result) return;
    if (!result.ok) {
      setNotice({ kind: "error", content: errorContent(result.error) });
      if (gone(result.error)) void loadList();
      return;
    }
    setFaqs(placeFaq(list.faqs, result.value.faq), result.value.capacity);
    // The same button again if it can still be pressed (not at the top or bottom now), else the row's Edit.
    setFocusIds([`voice-faq-${key.split("-")[0]}-${faq.id}`, `voice-faq-edit-${faq.id}`]);
    onChanged();
  }

  async function confirmDelete() {
    if (!list || !deleting) return;
    const target = deleting;
    setDeleteError(null);
    const result = await write<VoiceFaqDeleted>("delete", `/me/voice/faqs/${target.id}`, "DELETE");
    if (!result) return;
    if (!result.ok) {
      if (gone(result.error)) {
        setDeleting(null);
        setNotice({ kind: "error", content: errorContent(result.error) });
        void loadList();
      } else setDeleteError(result.error);
      return;
    }
    const next = removeFaq(list.faqs, target.id);
    setFaqs(next, result.value.capacity);
    setDeleting(null);
    if (editing?.id === target.id) setEditing(null);
    setFocusIds(rowFocus(next, list.faqs.findIndex((item) => item.id === target.id)));
    onChanged();
  }

  // ---------- template ----------
  async function applyTemplate() {
    setTemplateError(null);
    const result = await write<VoiceTemplateApplied>(
      "template",
      "/me/voice/faqs/from-template",
      "POST",
      JSON.stringify({ mode: templateMode, includeIntro: templateIntro }),
    );
    if (!result) return;
    if (!result.ok) {
      setTemplateError(result.error);
      return;
    }
    const { added, needsInput, introReplaced, faqs, capacity } = result.value;
    setFaqs(faqs, capacity);
    setTemplateOpen(false);
    setEditing(null);
    setNotice({
      kind: "ok",
      content: `${zh ? `已帶入 ${added} 題，其中 ${needsInput} 題需要填寫。` : `Added ${added} questions; ${needsInput} need your input.`}${
        needsInput > 0 ? ` ${t(T.tryFirst)}` : ""
      }`,
    });
    // M9 does not return the description; the template's one replaces whatever is in the editor.
    if (introReplaced) await loadList({ forceIntro: true });
    onChanged();
  }

  // ---------- CSV ----------
  function openCsv() {
    setCsvOpen(true);
    setCsvFile(null);
    setCsvMode("append");
    setCsvCheck(null);
    setCsvError(null);
    setNotice(null);
  }

  async function checkCsv() {
    setCsvError(null);
    setCsvCheck(null);
    if (!csvFile) {
      setCsvError(t(T.csvChooseFile));
      return;
    }
    // The size is checked before the file is read or anything is parsed.
    const read = await readCsvFile(csvFile, limits.csvBodyBytes);
    if (!read.ok) {
      setCsvError(t(read.reason === "too_large" ? T.csvTooLarge : T.csvEncoding));
      return;
    }
    const mode = csvMode;
    // JSON escaping can make the request larger than the file, and the BFF refuses more than csvBodyBytes
    // with 413. Measure the import request ("dryRun":false is one byte longer than the check's "true").
    if (utf8Bytes(JSON.stringify({ csv: read.text, mode, dryRun: false })) > limits.csvBodyBytes) {
      setCsvError(t(T.csvTooLarge));
      return;
    }
    const body = JSON.stringify({ csv: read.text, mode, dryRun: true });
    const result = await write<VoiceCsvCheck>("csv-check", "/me/voice/faqs/import", "POST", body);
    if (!result) return;
    if (!result.ok) {
      setCsvError(errorContent(result.error));
      return;
    }
    setCsvCheck({ result: result.value, csv: read.text, mode });
  }

  async function importCsv() {
    if (!csvCheck?.result.ok) return;
    setCsvError(null);
    const result = await write<VoiceCsvImported>(
      "csv-import",
      "/me/voice/faqs/import",
      "POST",
      JSON.stringify({ csv: csvCheck.csv, mode: csvCheck.mode, dryRun: false }),
    );
    if (!result) return;
    if (!result.ok) {
      setCsvError(errorContent(result.error));
      // The questions may have changed since the check; checking again shows why.
      setCsvCheck(null);
      return;
    }
    setFaqs(result.value.faqs, result.value.capacity);
    setCsvOpen(false);
    setEditing(null);
    setNotice({ kind: "ok", content: zh ? `已匯入 ${result.value.imported} 題。` : `Imported ${result.value.imported} questions.` });
    onChanged();
  }

  // ---------- preview (M10) and apply (M11) ----------
  async function loadPreview() {
    setPreview({ status: "loading" });
    try {
      setPreview({ status: "ready", data: await portalRequest<VoicePreview>("/me/voice/preview") });
    } catch (error) {
      setPreview({ status: "error", error });
    }
  }
  function togglePreview() {
    const next = !previewOpen;
    setPreviewOpen(next);
    // Read again every time it opens: the draft may have changed since.
    if (next) void loadPreview();
  }

  async function publish() {
    setPublishMessage(null);
    // A POST without fields still sends {} (contract §1.1: the backend refuses a request without a JSON body).
    const result = await write<VoicePublished>("publish", "/me/voice/publish", "POST", "{}");
    if (!result) return;
    if (!result.ok) {
      setPublishMessage({ kind: "error", content: errorContent(result.error) });
      return;
    }
    const published = result.value;
    const unfilled = published.warnings.filter((warning) => warning.code === "placeholder_unfilled").length;
    const hoursEmpty = published.warnings.some((warning) => warning.code === "hours_empty");
    setPublishMessage({
      kind: "ok",
      content: (
        <>
          {published.changed ? (
            <>
              {zh ? `已套用第 ${published.version} 版，可以到「` : `Version ${published.version} is applied. Go to "`}
              <Link href="/account/voice/try">{t(T.tryLink)}</Link>
              {zh ? "」聽聽看。" : '" to hear it.'}
            </>
          ) : zh ? (
            `內容沒有變更，仍是第 ${published.version} 版。`
          ) : (
            `Nothing changed; still version ${published.version}.`
          )}
          {unfilled > 0 &&
            (zh
              ? ` 還有 ${unfilled} 個地方寫著「（請填入）」，AI 可能會照著念。可以先試打聽聽看，之後再把標著「需要填寫」的地方補上。`
              : ` ${unfilled} places still say "（請填入）" (to be filled in); the AI may read them aloud. You can try a call first and fill in the ones marked "Needs input" later.`)}
          {hoursEmpty && ` ${t(T.hoursEmpty)}`}
        </>
      ),
    });
    if (previewOpen) void loadPreview();
    onChanged();
  }

  // ---------- render ----------
  const title = (
    <section className="portal-panel" aria-labelledby="voice-faq-title">
      <h2 id="voice-faq-title">{t(T.title)}</h2>
      {load.status === "loading" && (
        <p className="portal-empty" role="status">
          {t(T.loading)}
        </p>
      )}
      {load.status === "error" && (
        <>
          {errorBlock(load.error)}
          <button
            className="portal-button-secondary"
            onClick={() => {
              setLoad({ status: "loading" });
              void loadList();
            }}
          >
            {t(T.retry)}
          </button>
        </>
      )}
      {list && (
        <p
          className={
            list.capacity.kbChars / list.capacity.kbCharsMax > 0.9 || list.capacity.faqCount / list.capacity.faqMax > 0.9
              ? "portal-note"
              : "portal-muted"
          }
        >
          {zh
            ? `已用 ${formatNumber(list.capacity.kbChars)} / ${formatNumber(list.capacity.kbCharsMax)} 字・${formatNumber(list.capacity.faqCount)} / ${formatNumber(list.capacity.faqMax)} 題`
            : `${formatNumber(list.capacity.kbChars)} / ${formatNumber(list.capacity.kbCharsMax)} characters · ${formatNumber(list.capacity.faqCount)} / ${formatNumber(list.capacity.faqMax)} questions`}
        </p>
      )}
      <MessageLine message={notice} />
    </section>
  );
  if (load.status !== "ready" || !list) return <>{title}</>;

  const { capacity, faqs, template } = list;
  const needsInputCount = faqs.filter((faq) => faq.needsInput).length;
  const introChars = codePoints(intro.draft.trim());
  const introPlaceholder = firstPlaceholder(intro.draft);
  const disabled = readOnly || busy !== null;

  const faqForm = (faq: VoiceFaq | null) => {
    const problems = faqDraftProblems(draft, limits, capacity, faq?.chars ?? 0, faq === null);
    const headingId = faq ? `voice-faq-form-${faq.id}` : "voice-faq-form-new";
    const fieldMessage = (field: "question" | "answer") => {
      const problem = problems[field];
      const name = field === "question" ? { en: "question", zh: "問題" } : { en: "answer", zh: "答案" };
      if (problem === "unsafe") return unsafeMessage(name, zh);
      if (problem === "long")
        return field === "question"
          ? zh
            ? `問題最多 ${limits.questionChars} 字。`
            : `The question can be up to ${limits.questionChars} characters.`
          : voiceErrorText(codeError("faq_too_long"), locale, capacityLimits);
      if (problem === "empty" && attempted) return t(field === "question" ? T.questionEmpty : T.answerEmpty);
      return null;
    };
    const variantMessage =
      problems.variants === "unsafe"
        ? unsafeMessage({ en: "alternative", zh: "相似問法" }, zh)
        : problems.variants === "long"
          ? zh
            ? `每個相似問法最多 ${limits.variantChars} 字。`
            : `Each alternative can be up to ${limits.variantChars} characters.`
          : problems.variants === "count"
            ? zh
              ? `相似問法最多 ${limits.variantsMax} 個。`
              : `Up to ${limits.variantsMax} alternatives.`
            : null;
    const placeholderHint = (text: string) => {
      const found = firstPlaceholder(text);
      return found ? (
        <p className="portal-note">
          {zh ? `這裡還有「${found}」，請換成你們店的實際資料。` : `This still says "${found}"; replace it with your store's details.`}
        </p>
      ) : null;
    };
    const questionMessage = fieldMessage("question");
    const answerMessage = fieldMessage("answer");
    return (
      <form className="portal-form" aria-labelledby={headingId} onSubmit={saveFaq} noValidate>
        <h3 id={headingId}>{t(faq ? T.formEdit : T.formNew)}</h3>
        <label className="portal-field">
          {t(T.question)}
          <input
            value={draft.question}
            aria-invalid={questionMessage ? true : undefined}
            onChange={(event) => setDraft({ ...draft, question: event.target.value })}
          />
        </label>
        {questionMessage && <p className="portal-error">{questionMessage}</p>}
        {placeholderHint(draft.question)}
        <label className="portal-field">
          {t(T.answer)}
          <textarea
            value={draft.answer}
            aria-invalid={answerMessage ? true : undefined}
            onChange={(event) => setDraft({ ...draft, answer: event.target.value })}
          />
        </label>
        {answerMessage && <p className="portal-error">{answerMessage}</p>}
        {placeholderHint(draft.answer)}
        <label className="portal-field">
          {t(T.variants)}
          <textarea
            rows={3}
            value={draft.variantsText}
            aria-invalid={variantMessage ? true : undefined}
            onChange={(event) => setDraft({ ...draft, variantsText: event.target.value })}
          />
        </label>
        {variantMessage && <p className="portal-error">{variantMessage}</p>}
        {placeholderHint(draft.variantsText)}
        <label className="portal-choice">
          <input type="checkbox" checked={!draft.aiAllowed} onChange={(event) => setDraft({ ...draft, aiAllowed: !event.target.checked })} />{" "}
          {t(T.noAiCheck)}
        </label>
        <p className={problems.capacity === "faq_too_long" ? "portal-error" : "portal-hint"}>
          {zh
            ? `這題 ${problems.chars} / ${formatNumber(limits.faqChars)} 字`
            : `${problems.chars} / ${formatNumber(limits.faqChars)} characters for this question`}
        </p>
        {problems.capacity && problems.capacity !== "faq_too_long" && (
          <p className="portal-error">{voiceErrorText(codeError(problems.capacity), locale, capacityLimits)}</p>
        )}
        {formError !== null && errorBlock(formError)}
        <div className="portal-actions">
          <button
            type="button"
            className="portal-button-secondary"
            disabled={busy === "faq"}
            onClick={() => {
              setEditing(null);
              setFormError(null);
              setFocusIds(faq ? [`voice-faq-edit-${faq.id}`] : ["voice-faq-add"]);
            }}
          >
            {t(T.cancel)}
          </button>
          <button className="portal-button" disabled={disabled}>
            {label("faq", T.save)}
          </button>
        </div>
      </form>
    );
  };

  return (
    <>
      {title}

      <section className="portal-panel" aria-labelledby="voice-faq-intro">
        <div className="portal-panel-heading">
          <h3 id="voice-faq-intro">{t(T.introTitle)}</h3>
          {introPlaceholder && <span className="portal-badge">{t(T.needsInput)}</span>}
        </div>
        <p className="portal-muted">{t(T.introHint)}</p>
        <form onSubmit={saveIntro}>
          <label className="portal-field">
            {t(T.introTitle)}
            <textarea
              rows={6}
              value={intro.draft}
              readOnly={readOnly}
              onChange={(event) => {
                const value = event.target.value;
                setIntro((current) => ({ ...current, draft: value }));
                setIntroMessage(null);
              }}
            />
          </label>
          {introPlaceholder && (
            <p className="portal-note">
              {zh
                ? `這裡還有「${introPlaceholder}」，請換成你們店的實際資料。`
                : `This still says "${introPlaceholder}"; replace it with your store's details.`}
            </p>
          )}
          <p className="portal-hint">{zh ? `介紹 ${formatNumber(introChars)} 字` : `Description: ${formatNumber(introChars)} characters`}</p>
          <MessageLine message={introMessage} />
          <div className="portal-actions">
            <button className="portal-button" disabled={disabled || intro.draft === intro.saved}>
              {label("intro", T.introSave)}
            </button>
          </div>
        </form>
      </section>

      <section className="portal-panel" aria-labelledby="voice-faq-questions">
        <div className="portal-panel-heading">
          <h3 id="voice-faq-questions" tabIndex={-1}>
            {t(T.questionsTitle)}
          </h3>
        </div>
        <div className="portal-actions">
          <button id="voice-faq-add" className="portal-button" disabled={disabled} onClick={startNew}>
            {t(T.add)}
          </button>
          {template.available && (
            <button
              className="portal-button-secondary"
              disabled={disabled}
              onClick={() => {
                setTemplateOpen(true);
                setTemplateMode("append");
                // Also take the template's description when there is none yet; never replace one by default.
                setTemplateIntro(intro.saved.trim() === "" && intro.draft.trim() === "");
                setTemplateError(null);
                setNotice(null);
              }}
            >
              {t(T.useTemplate)}
            </button>
          )}
          <button className="portal-button-secondary" disabled={disabled} onClick={openCsv}>
            {t(T.importCsv)}
          </button>
        </div>
        {editing?.id === null && faqForm(null)}
        {(needsInputCount > 0 || onlyNeedsInput) && (
          <div className="portal-actions">
            <button
              type="button"
              className="portal-button-secondary"
              aria-pressed={onlyNeedsInput}
              onClick={() => setOnlyNeedsInput((value) => !value)}
            >
              {onlyNeedsInput ? t(T.showAll) : `${t(T.onlyNeedsInput)}${zh ? `（${needsInputCount} 題）` : ` (${needsInputCount})`}`}
            </button>
          </div>
        )}
        {onlyNeedsInput && needsInputCount === 0 && <p className="portal-note">{t(T.allFilled)}</p>}
        {faqs.length === 0 ? (
          <p className="portal-empty">{t(template.available ? T.empty : T.emptyNoTemplate)}</p>
        ) : (
          <div className="portal-table-wrap">
            <table className="portal-table voice-stack voice-faq-table">
              <thead>
                <tr>
                  <th scope="col">{t(T.colOrder)}</th>
                  <th scope="col">{t(T.colQuestion)}</th>
                  <th scope="col">{t(T.colAnswer)}</th>
                  <th scope="col">{t(T.colActions)}</th>
                </tr>
              </thead>
              <tbody>
                {faqs.map((faq, index) =>
                  onlyNeedsInput && !faq.needsInput && editing?.id !== faq.id ? null : editing?.id === faq.id ? (
                    <tr key={faq.id}>
                      <td colSpan={4}>{faqForm(faq)}</td>
                    </tr>
                  ) : (
                    <tr key={faq.id}>
                      <td>{index + 1}</td>
                      <td>
                        <Marked text={faq.question} />
                        {faq.needsInput && (
                          <>
                            {" "}
                            <span className="portal-badge">{t(T.needsInput)}</span>
                          </>
                        )}
                        {!faq.aiAllowed && (
                          <>
                            {" "}
                            <span className="portal-badge">{t(T.noAi)}</span>
                          </>
                        )}
                        {faq.variants.length > 0 && (
                          <p className="portal-hint">
                            {t(T.otherWays)}
                            <Marked text={faq.variants.join(zh ? "、" : ", ")} />
                          </p>
                        )}
                      </td>
                      <td style={{ whiteSpace: "pre-wrap" }} data-label={t(T.colAnswer)}>
                        <Marked text={faq.answer} />
                      </td>
                      <td>
                        <div className="portal-actions">
                          <button
                            id={`voice-faq-edit-${faq.id}`}
                            className="portal-text-button"
                            disabled={disabled}
                            aria-label={rowLabel(t(T.edit), faq)}
                            onClick={() => startEdit(faq)}
                          >
                            {t(T.edit)}
                          </button>
                          <button
                            id={`voice-faq-up-${faq.id}`}
                            className="portal-text-button"
                            disabled={disabled || index === 0}
                            aria-label={rowLabel(label(`up-${faq.id}`, T.moveUp), faq)}
                            onClick={() => void move(faq, `up-${faq.id}`, index - 1)}
                          >
                            {label(`up-${faq.id}`, T.moveUp)}
                          </button>
                          <button
                            id={`voice-faq-down-${faq.id}`}
                            className="portal-text-button"
                            disabled={disabled || index === faqs.length - 1}
                            aria-label={rowLabel(label(`down-${faq.id}`, T.moveDown), faq)}
                            onClick={() => void move(faq, `down-${faq.id}`, index + 1)}
                          >
                            {label(`down-${faq.id}`, T.moveDown)}
                          </button>
                          <button
                            className="portal-text-button portal-danger"
                            disabled={disabled}
                            aria-label={rowLabel(t(T.delete), faq)}
                            onClick={() => {
                              setDeleting(faq);
                              setDeleteError(null);
                              setNotice(null);
                            }}
                          >
                            {t(T.delete)}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="portal-panel" aria-labelledby="voice-faq-apply">
        <h3 id="voice-faq-apply">{t(T.applyTitle)}</h3>
        <p className="portal-muted">
          {t(T.applyHint)}
          <Link href="/account/voice/setup">{t(T.applyHintSetup)}</Link>
          {t(T.applyHintEnd)}
        </p>
        <MessageLine message={publishMessage} />
        <div className="portal-actions">
          <button className="portal-button" disabled={disabled} onClick={() => void publish()}>
            {label("publish", T.apply)}
          </button>
          <button className="portal-button-secondary" aria-expanded={previewOpen} aria-controls="voice-faq-preview" onClick={togglePreview}>
            {t(previewOpen ? T.previewHide : T.previewShow)}
          </button>
        </div>
        {previewOpen && (
          <div id="voice-faq-preview" role="region" aria-label={t(T.previewShow)}>
            <p className="portal-hint">{t(T.previewBrackets)}</p>
            {preview.status === "loading" && (
              <p className="portal-empty" role="status">
                {t(T.previewLoading)}
              </p>
            )}
            {preview.status === "error" && errorBlock(preview.error)}
            {preview.status === "ready" && (
              <>
                {preview.data.problems.map((problem) => (
                  <p key={problem.code} className="portal-error">
                    {voiceErrorText(codeError(problem.code, 409), locale, capacityLimits)}
                  </p>
                ))}
                {preview.data.config && (
                  <>
                    <h4>{t(T.previewOpening)}</h4>
                    <p>
                      {preview.data.config.opening.text}
                      {zh ? `（約 ${preview.data.config.opening.est_seconds} 秒）` : ` (about ${preview.data.config.opening.est_seconds} s)`}
                    </p>
                    {preview.data.config.rules.no_ai_questions.length > 0 && (
                      <>
                        <h4>{t(T.previewNoAi)}</h4>
                        <ul>
                          {preview.data.config.rules.no_ai_questions.map((question, index) => (
                            <li key={index}>{question}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    <h4>{t(T.previewPrompt)}</h4>
                    <pre style={{ whiteSpace: "pre-wrap" }}>{preview.data.config.prompt.prefix}</pre>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {deleting && (
        <Modal labelledBy="voice-faq-delete-title" busy={busy === "delete"} onClose={() => setDeleting(null)}>
          <h2 id="voice-faq-delete-title">{t(T.deleteTitle)}</h2>
          <p>
            {zh
              ? `「${deleting.question}」刪除後無法復原。已套用的版本不受影響，直到你下次套用。`
              : `"${deleting.question}" cannot be restored. The applied version is unaffected until you apply again.`}
          </p>
          {deleteError !== null && errorBlock(deleteError)}
          <div className="portal-actions">
            <button className="portal-button-secondary" disabled={busy === "delete"} onClick={() => setDeleting(null)}>
              {t(T.cancel)}
            </button>
            <button className="portal-button portal-button-danger" disabled={busy !== null} onClick={() => void confirmDelete()}>
              {label("delete", T.delete)}
            </button>
          </div>
        </Modal>
      )}

      {templateOpen && template.available && (
        <Modal labelledBy="voice-faq-template-title" busy={busy === "template"} onClose={() => setTemplateOpen(false)}>
          <h2 id="voice-faq-template-title">{zh ? `從「${template.title.zh}」範本帶入` : `Use the "${template.title.en}" template`}</h2>
          <fieldset className="portal-choices">
            <legend>{t(T.templateMode)}</legend>
            {IMPORT_MODES.map((mode) => (
              <label key={mode} className="portal-choice">
                <input type="radio" name="voice-template-mode" checked={templateMode === mode} onChange={() => setTemplateMode(mode)} />{" "}
                {t(mode === "append" ? T.modeAppend : T.modeReplace)}
              </label>
            ))}
          </fieldset>
          <label className="portal-choice">
            <input type="checkbox" checked={templateIntro} onChange={(event) => setTemplateIntro(event.target.checked)} /> {t(T.templateIntro)}
          </label>
          <p className="portal-note">{t(T.templateNote)}</p>
          {templateError !== null && errorBlock(templateError)}
          <div className="portal-actions">
            <button className="portal-button-secondary" disabled={busy === "template"} onClick={() => setTemplateOpen(false)}>
              {t(T.cancel)}
            </button>
            <button className="portal-button" disabled={busy !== null} onClick={() => void applyTemplate()}>
              {label("template", T.templateApply)}
            </button>
          </div>
        </Modal>
      )}

      {csvOpen && (
        <Modal labelledBy="voice-faq-csv-title" busy={busy === "csv-check" || busy === "csv-import"} onClose={() => setCsvOpen(false)}>
          <h2 id="voice-faq-csv-title">{t(T.csvTitle)}</h2>
          <p>{t(T.csvFormat)}</p>
          <p>
            <a href={csvExampleHref()} download="faq-example.csv">
              {t(T.csvExample)}
            </a>
          </p>
          <label className="portal-field">
            {t(T.csvFile)}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setCsvFile(event.target.files?.[0] ?? null);
                setCsvCheck(null);
                setCsvError(null);
              }}
            />
          </label>
          <fieldset className="portal-choices">
            <legend>{t(T.csvMode)}</legend>
            {IMPORT_MODES.map((mode) => (
              <label key={mode} className="portal-choice">
                <input
                  type="radio"
                  name="voice-csv-mode"
                  checked={csvMode === mode}
                  onChange={() => {
                    setCsvMode(mode);
                    setCsvCheck(null);
                  }}
                />{" "}
                {t(mode === "append" ? T.modeAppend : T.modeReplace)}
              </label>
            ))}
          </fieldset>
          {csvCheck && <CsvCheckResult check={csvCheck.result} locale={locale} limits={capacityLimits} />}
          {csvError !== null && (
            <p className="portal-error" role="alert">
              {csvError}
            </p>
          )}
          <div className="portal-actions">
            <button
              className="portal-button-secondary"
              disabled={busy === "csv-check" || busy === "csv-import"}
              onClick={() => setCsvOpen(false)}
            >
              {t(T.cancel)}
            </button>
            <button className="portal-button-secondary" disabled={busy !== null || !csvFile} onClick={() => void checkCsv()}>
              {label("csv-check", T.csvCheck)}
            </button>
            <button className="portal-button" disabled={busy !== null || !csvCheck?.result.ok} onClick={() => void importCsv()}>
              {label("csv-import", T.csvImport)}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
