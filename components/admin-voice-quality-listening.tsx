"use client";

import { useEffect, useRef, useState } from "react";
import { codePoints, lineProblem, textProblem, unsafeMessage } from "../lib/admin-text";
import { PortalError, portalRequest } from "../lib/portal-client";
import {
  LISTENING_FIELD_LIMITS as L,
  LISTENING_KINDS,
  noteHasPhoneNumber,
  toCsv,
  type ListeningInput,
  type ListeningKind,
  type ListeningList,
  type ListeningLog,
} from "../lib/voice-quality";
import { AdminDialog } from "./admin-dialog";
import { downloadText } from "./admin-resource";
import { taipeiToday, voiceFeatureOff } from "./admin-voice-dialogs";
import {
  FEATURE_OFF,
  LISTENING_KIND_LABEL,
  PASSED_LABEL,
  fill,
  passedLabel,
  qualityErrorText,
  say,
  taipeiStamp,
  working,
  type Copy,
} from "./admin-voice-quality-labels";
import { useLocale } from "./locale-provider";

/*
 * The blind listening log in the lower half of the "Quality" tab (phase2-contract §7.5 A13-A16, §4.3, §11.3). It holds
 * results only, never caller data: a summary that looks like a phone number is refused (400 note_contains_number),
 * and the report location is shown as plain text, never as a link (a `javascript:` location must not run).
 */

const T = {
  title: { zh: "盲聽紀錄", en: "Blind listening log" },
  intro: {
    zh: "記錄每一次聲音盲聽或通話抽樣盲標的結果。這裡不放客人資料，詳細資料放報告裡。",
    en: "Record the result of each blind voice test or blind call labelling. Do not store caller data here; keep the details in the report.",
  },
  add: { zh: "新增紀錄", en: "Add an entry" },
  export: { zh: "匯出 CSV", en: "Export CSV" },
  count: { zh: "共 {n} 筆", en: "{n} entries" },
  countMax: { zh: "共 {n} 筆（最多 {max} 筆）", en: "{n} of up to {max} entries" },
  date: { zh: "日期", en: "Date" },
  name: { zh: "名稱", en: "Title" },
  kind: { zh: "類型", en: "Type" },
  samples: { zh: "樣本數", en: "Samples" },
  raters: { zh: "評分人數", en: "Raters" },
  result: { zh: "結果", en: "Result" },
  report: { zh: "報告位置", en: "Report" },
  actions: { zh: "動作", en: "Actions" },
  summary: { zh: "摘要", en: "Summary" },
  summaryField: { zh: "摘要（最多 {n} 字）", en: "Summary (up to {n} characters)" },
  reportField: { zh: "報告位置（最多 {n} 字）", en: "Report location (up to {n} characters)" },
  reportHint: { zh: "檔案路徑或網址；畫面上只顯示成文字，不會變成連結。", en: "A file path or address; it is shown as text, never as a link." },
  edit: { zh: "編輯", en: "Edit" },
  remove: { zh: "刪除", en: "Delete" },
  editLabel: { zh: "編輯：{title}", en: "Edit: {title}" },
  removeLabel: { zh: "刪除：{title}", en: "Delete: {title}" },
  empty: { zh: "還沒有盲聽紀錄。", en: "No blind listening entries yet." },
  loading: { zh: "正在載入盲聽紀錄…", en: "Loading the blind listening log…" },
  failed: { zh: "盲聽紀錄載入失敗，請重新整理。", en: "The blind listening log could not be loaded. Reload the page." },
  retry: { zh: "重新整理", en: "Refresh" },
  addTitle: { zh: "新增盲聽紀錄", en: "Add a blind listening entry" },
  editTitle: { zh: "編輯盲聽紀錄", en: "Edit the blind listening entry" },
  save: { zh: "儲存", en: "Save" },
  cancel: { zh: "取消", en: "Cancel" },
  deleteTitle: { zh: "要刪除「{title}」這筆盲聽紀錄嗎？", en: 'Delete the blind listening entry "{title}"?' },
  deleteNote: { zh: "刪除後無法復原。", en: "This cannot be undone." },
  added: { zh: "已新增「{title}」。", en: 'Added "{title}".' },
  saved: { zh: "已儲存「{title}」。", en: 'Saved "{title}".' },
  unchanged: { zh: "「{title}」沒有變更。", en: '"{title}" did not change.' },
  deleted: { zh: "已刪除「{title}」。", en: 'Deleted "{title}".' },
  needTitle: { zh: "名稱要 1～{n} 字。", en: "Enter a title of 1 to {n} characters." },
  needDate: { zh: "請選擇 2000-01-01 到 2037-12-31 之間的日期。", en: "Choose a date between 2000-01-01 and 2037-12-31." },
  needSamples: { zh: "樣本數要是 1～{n} 的整數。", en: "Enter the samples as a whole number from 1 to {n}." },
  needRaters: { zh: "評分人數要是 1～{n} 的整數。", en: "Enter the raters as a whole number from 1 to {n}." },
  summaryLong: { zh: "摘要最多 {n} 字。", en: "The summary can be up to {n} characters." },
  summaryNumber: { zh: "摘要裡不要寫電話號碼。", en: "Do not put phone numbers in the summary." },
  reportLong: { zh: "報告位置最多 {n} 字。", en: "The report location can be up to {n} characters." },
} satisfies Record<string, Copy>;

type Draft = { title: string; kind: ListeningKind; heldOn: string; sampleCount: string; raterCount: string; passed: "yes" | "no" | "recorded"; summary: string; reportRef: string };
const PASSED_CHOICES = ["yes", "no", "recorded"] as const;

const draftOf = (log: ListeningLog | null): Draft =>
  log
    ? {
        title: log.title,
        kind: log.kind,
        heldOn: log.heldOn,
        sampleCount: String(log.sampleCount),
        raterCount: String(log.raterCount),
        passed: log.passed === null ? "recorded" : log.passed ? "yes" : "no",
        summary: log.summary,
        reportRef: log.reportRef,
      }
    : { title: "", kind: "tts_voice", heldOn: taipeiToday(), sampleCount: "", raterCount: "", passed: "recorded", summary: "", reportRef: "" };

/** Newest first, like A13 (held_on, created_at, id, all descending). */
const newestFirst = (a: ListeningLog, b: ListeningLog) =>
  b.heldOn.localeCompare(a.heldOn) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01" || value > "2037-12-31") return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const wholeIn = (value: string, high: number) => /^[0-9]{1,6}$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= high;

export function AdminVoiceQualityListening({ listeningMax = null }: { listeningMax?: number | null }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ revision: number; logs: ListeningLog[] | null; error: unknown }>({ revision: -1, logs: null, error: null });
  const [editing, setEditing] = useState<ListeningLog | "new" | null>(null);
  const [deleting, setDeleting] = useState<ListeningLog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const focusIds = useRef<string[] | null>(null);
  useEffect(() => {
    if (focusIds.current === null) return;
    const target = focusIds.current.map((id) => document.getElementById(id)).find((element) => element !== null);
    focusIds.current = null;
    target?.focus();
  });

  useEffect(() => {
    const controller = new AbortController();
    portalRequest<ListeningList>("/admin/voice/quality/listening", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ revision, logs: [...data.logs].sort(newestFirst), error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ revision, logs: null, error });
      });
    return () => controller.abort();
  }, [revision]);

  const loading = state.revision !== revision;
  const logs = state.logs ?? [];
  const reload = () => setRevision((value) => value + 1);
  const t = (copy: Copy, values: Record<string, string | number> = {}) => fill(say(copy, zh), values);
  const count = (value: number) => value.toLocaleString(zh ? "zh-TW" : "en-US");

  /** The row after `index` (or before it when it was the last), else "Add an entry". */
  function focusNear(list: ListeningLog[], index: number) {
    const row = list[index] ?? list[index - 1];
    focusIds.current = row ? [`voice-listening-edit-${row.id}`, "voice-listening-add"] : ["voice-listening-add"];
  }

  function exportCsv() {
    const header = zh
      ? ["日期", "名稱", "類型", "樣本數", "評分人數", "結果", "摘要", "報告位置", "建立者", "建立時間（台北）", "更新時間（台北）"]
      : ["Date", "Title", "Type", "Samples", "Raters", "Result", "Summary", "Report", "Created by", "Created at (Taipei)", "Updated at (Taipei)"];
    const rows = logs.map((log) => [
      log.heldOn,
      log.title,
      log.kind,
      log.sampleCount,
      log.raterCount,
      log.passed === null ? "recorded" : log.passed ? "passed" : "failed",
      log.summary,
      log.reportRef,
      log.createdBy.email,
      taipeiStamp(log.createdAt),
      taipeiStamp(log.updatedAt),
    ]);
    downloadText(`voice-listening-${taipeiToday()}.csv`, toCsv(header, rows), "text/csv;charset=utf-8");
  }

  return (
    <section className="portal-panel" aria-labelledby="voice-listening-title">
      <div className="portal-panel-heading">
        <h2 id="voice-listening-title">{say(T.title, zh)}</h2>
        <div className="portal-actions">
          <button
            type="button"
            className="portal-button-secondary"
            disabled={loading || logs.length === 0}
            onClick={exportCsv}
          >
            {say(T.export, zh)}
          </button>
          <button
            type="button"
            id="voice-listening-add"
            className="portal-button"
            disabled={loading || state.error !== null}
            onClick={() => {
              setNotice(null);
              setEditing("new");
            }}
          >
            {say(T.add, zh)}
          </button>
        </div>
      </div>
      <p className="portal-muted">{say(T.intro, zh)}</p>
      {notice !== null && (
        <p className="portal-note" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p className="portal-muted" role="status">
          {say(T.loading, zh)}
        </p>
      ) : state.error !== null ? (
        <div>
          <p className="portal-error" role="alert">
            {voiceFeatureOff(state.error)
              ? say(FEATURE_OFF, zh)
              : !(state.error instanceof PortalError) || state.error.status >= 500
                ? say(T.failed, zh)
                : qualityErrorText(state.error, locale)}
          </p>
          <div className="portal-actions">
            <button type="button" className="portal-button-secondary" onClick={reload}>
              {say(T.retry, zh)}
            </button>
          </div>
        </div>
      ) : logs.length === 0 ? (
        <p className="portal-empty">{say(T.empty, zh)}</p>
      ) : (
        <>
          <p className="portal-muted">
            {listeningMax ? t(T.countMax, { n: count(logs.length), max: count(listeningMax) }) : t(T.count, { n: count(logs.length) })}
          </p>
          <div className="portal-table-wrap">
            <table className="portal-table voice-stack">
              <caption className="sr-only">{say(T.title, zh)}</caption>
              <thead>
                <tr>
                  <th scope="col">{say(T.date, zh)}</th>
                  <th scope="col">{say(T.name, zh)}</th>
                  <th scope="col">{say(T.kind, zh)}</th>
                  <th scope="col">{say(T.samples, zh)}</th>
                  <th scope="col">{say(T.raters, zh)}</th>
                  <th scope="col">{say(T.result, zh)}</th>
                  <th scope="col">{say(T.report, zh)}</th>
                  <th scope="col">{say(T.actions, zh)}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td data-label={say(T.date, zh)}>{log.heldOn}</td>
                    <th scope="row">
                      {log.title}
                      {log.summary && (
                        <span className="portal-muted voice-listening-summary">
                          {log.summary.split("\n").map((line, index) => (
                            <span key={index}>
                              <br />
                              {line}
                            </span>
                          ))}
                        </span>
                      )}
                    </th>
                    <td data-label={say(T.kind, zh)}>{LISTENING_KIND_LABEL[log.kind] ? say(LISTENING_KIND_LABEL[log.kind], zh) : log.kind}</td>
                    <td data-label={say(T.samples, zh)}>{count(log.sampleCount)}</td>
                    <td data-label={say(T.raters, zh)}>{count(log.raterCount)}</td>
                    <td data-label={say(T.result, zh)}>{passedLabel(log.passed, zh)}</td>
                    {/* Plain text on purpose (§4.3): a location is never turned into a link. */}
                    <td data-label={say(T.report, zh)}>{log.reportRef || "—"}</td>
                    <td>
                      <div className="portal-actions">
                        <button
                          type="button"
                          id={`voice-listening-edit-${log.id}`}
                          className="portal-text-button"
                          aria-label={t(T.editLabel, { title: log.title })}
                          onClick={() => {
                            setNotice(null);
                            setEditing(log);
                          }}
                        >
                          {say(T.edit, zh)}
                        </button>
                        <button
                          type="button"
                          className="portal-text-button"
                          aria-label={t(T.removeLabel, { title: log.title })}
                          onClick={() => {
                            setNotice(null);
                            setDeleting(log);
                          }}
                        >
                          {say(T.remove, zh)}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {editing !== null && (
        <ListeningDialog
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onStale={reload}
          onSaved={(log, changed) => {
            const next = [...logs.filter((item) => item.id !== log.id), log].sort(newestFirst);
            setState((current) => ({ ...current, logs: next }));
            setNotice(t(editing === "new" ? T.added : changed ? T.saved : T.unchanged, { title: log.title }));
            focusIds.current = [`voice-listening-edit-${log.id}`, "voice-listening-add"];
            setEditing(null);
          }}
        />
      )}
      {deleting !== null && (
        <DeleteListeningDialog
          log={deleting}
          onClose={() => setDeleting(null)}
          onStale={reload}
          onDeleted={() => {
            const index = logs.findIndex((item) => item.id === deleting.id);
            const next = logs.filter((item) => item.id !== deleting.id);
            setState((current) => ({ ...current, logs: next }));
            setNotice(t(T.deleted, { title: deleting.title }));
            focusNear(next, index);
            setDeleting(null);
          }}
        />
      )}
    </section>
  );
}

/** A14 (add) and A15 (edit, which replaces every field). */
function ListeningDialog({
  existing,
  onClose,
  onSaved,
  onStale,
}: {
  existing: ListeningLog | null;
  onClose: () => void;
  onSaved: (log: ListeningLog, changed: boolean) => void;
  onStale: () => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [draft, setDraft] = useState<Draft>(() => draftOf(existing));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const update = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const t = (copy: Copy, values: Record<string, string | number> = {}) => fill(say(copy, zh), values);

  function validate(): string | null {
    const title = lineProblem(draft.title, L.titleChars);
    if (title === "unsafe") return unsafeMessage({ en: "title", zh: "名稱" }, zh);
    if (title) return t(T.needTitle, { n: L.titleChars });
    if (!validDay(draft.heldOn)) return say(T.needDate, zh);
    if (!wholeIn(draft.sampleCount, L.samplesMax)) return t(T.needSamples, { n: L.samplesMax.toLocaleString(zh ? "zh-TW" : "en-US") });
    if (!wholeIn(draft.raterCount, L.ratersMax)) return t(T.needRaters, { n: L.ratersMax });
    if (textProblem(draft.summary, Number.MAX_SAFE_INTEGER) === "unsafe") return unsafeMessage({ en: "summary", zh: "摘要" }, zh);
    if (codePoints(draft.summary.trim()) > L.summaryChars) return t(T.summaryLong, { n: L.summaryChars });
    if (noteHasPhoneNumber(draft.summary)) return say(T.summaryNumber, zh);
    const report = lineProblem(draft.reportRef, L.reportRefChars, false);
    if (report === "unsafe") return unsafeMessage({ en: "report location", zh: "報告位置" }, zh);
    if (report) return t(T.reportLong, { n: L.reportRefChars });
    return null;
  }

  async function submit() {
    if (busyRef.current) return;
    const invalid = validate();
    setMessage(invalid);
    if (invalid) return;
    busyRef.current = true;
    setBusy(true);
    const body: ListeningInput = {
      title: draft.title.trim(),
      kind: draft.kind,
      heldOn: draft.heldOn,
      sampleCount: Number(draft.sampleCount),
      raterCount: Number(draft.raterCount),
      passed: draft.passed === "recorded" ? null : draft.passed === "yes",
      summary: draft.summary.trim(),
      reportRef: draft.reportRef.trim(),
    };
    try {
      if (existing) {
        const result = await portalRequest<{ changed: boolean; log: ListeningLog }>(`/admin/voice/quality/listening/${existing.id}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        onSaved(result.log, result.changed);
      } else {
        const result = await portalRequest<{ log: ListeningLog }>("/admin/voice/quality/listening", { method: "POST", body: JSON.stringify(body) });
        onSaved(result.log, true);
      }
    } catch (error: unknown) {
      setMessage(qualityErrorText(error, locale));
      if (error instanceof PortalError && error.code === "listening_not_found") onStale();
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      title={say(existing ? T.editTitle : T.addTitle, zh)}
      confirmLabel={busy ? working(zh) : say(T.save, zh)}
      cancelLabel={say(T.cancel, zh)}
      onConfirm={() => void submit()}
      onClose={onClose}
      inFlight={busy}
    >
      <label className="portal-field">
        {say(T.name, zh)}
        <input autoComplete="off" value={draft.title} disabled={busy} onChange={(event) => update({ title: event.target.value })} />
      </label>
      <label className="portal-field">
        {say(T.kind, zh)}
        <select value={draft.kind} disabled={busy} onChange={(event) => update({ kind: event.target.value as ListeningKind })}>
          {LISTENING_KINDS.map((value) => (
            <option key={value} value={value}>
              {say(LISTENING_KIND_LABEL[value], zh)}
            </option>
          ))}
        </select>
      </label>
      <label className="portal-field">
        {say(T.date, zh)}
        <input type="date" value={draft.heldOn} min="2000-01-01" max="2037-12-31" disabled={busy} onChange={(event) => update({ heldOn: event.target.value })} />
      </label>
      <label className="portal-field">
        {say(T.samples, zh)}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={L.samplesMax}
          step={1}
          value={draft.sampleCount}
          disabled={busy}
          onChange={(event) => update({ sampleCount: event.target.value })}
        />
      </label>
      <label className="portal-field">
        {say(T.raters, zh)}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={L.ratersMax}
          step={1}
          value={draft.raterCount}
          disabled={busy}
          onChange={(event) => update({ raterCount: event.target.value })}
        />
      </label>
      <fieldset className="portal-choices">
        <legend>{say(T.result, zh)}</legend>
        {PASSED_CHOICES.map((value) => (
          <label key={value} className="portal-choice">
            <input type="radio" name="voice-listening-passed" value={value} checked={draft.passed === value} disabled={busy} onChange={() => update({ passed: value })} />
            {say(PASSED_LABEL[value], zh)}
          </label>
        ))}
      </fieldset>
      <label className="portal-field">
        {t(T.summaryField, { n: L.summaryChars.toLocaleString(zh ? "zh-TW" : "en-US") })}
        <textarea value={draft.summary} rows={4} disabled={busy} onChange={(event) => update({ summary: event.target.value })} />
      </label>
      <label className="portal-field">
        {t(T.reportField, { n: L.reportRefChars })}
        <input autoComplete="off" value={draft.reportRef} disabled={busy} aria-describedby="voice-listening-report-hint" onChange={(event) => update({ reportRef: event.target.value })} />
      </label>
      <p id="voice-listening-report-hint" className="portal-hint">
        {say(T.reportHint, zh)}
      </p>
      {message !== null && (
        <p className="portal-error" role="alert">
          {message}
        </p>
      )}
    </AdminDialog>
  );
}

/** A16. */
function DeleteListeningDialog({ log, onClose, onDeleted, onStale }: { log: ListeningLog; onClose: () => void; onDeleted: () => void; onStale: () => void }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await portalRequest<{ ok: boolean }>(`/admin/voice/quality/listening/${log.id}`, { method: "DELETE" });
      onDeleted();
    } catch (error: unknown) {
      setMessage(qualityErrorText(error, locale));
      if (error instanceof PortalError && error.code === "listening_not_found") onStale();
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      title={fill(say(T.deleteTitle, zh), { title: log.title })}
      confirmLabel={busy ? working(zh) : say(T.remove, zh)}
      cancelLabel={say(T.cancel, zh)}
      onConfirm={() => void submit()}
      onClose={onClose}
      inFlight={busy}
      danger
    >
      <p>
        {log.heldOn}
        {" · "}
        {say(LISTENING_KIND_LABEL[log.kind] ?? { zh: log.kind, en: log.kind }, zh)}
        {" · "}
        {passedLabel(log.passed, zh)}
      </p>
      <p className="portal-note">{say(T.deleteNote, zh)}</p>
      {message !== null && (
        <p className="portal-error" role="alert">
          {message}
        </p>
      )}
    </AdminDialog>
  );
}
