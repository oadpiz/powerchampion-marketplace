"use client";

import { useEffect, useRef, useState } from "react";
import { PortalError, portalRequest } from "../lib/portal-client";
import { ENTRIES, OUTCOMES, type CallEntry, type CallOutcome } from "../lib/voice-calls";
import {
  QUALITY_FLAG_FILTERS,
  QUALITY_REVIEWED_FILTERS,
  toCsv,
  type CallReview,
  type QualityDetail,
  type QualityFlagFilter,
  type QualityItem,
  type QualityLimits,
  type QualityList,
  type QualityReviewedFilter,
} from "../lib/voice-quality";
import { downloadText } from "./admin-resource";
import { taipeiToday, voiceFeatureOff, type StoreItem } from "./admin-voice-dialogs";
import { AdminVoiceQualityDrawer } from "./admin-voice-quality-drawer";
import {
  AUTO_FLAG_LABEL,
  ENTRY_LABEL,
  FEATURE_OFF,
  LIST_STATUS,
  NO_STORE,
  OUTCOME_LABEL,
  fill,
  qualityErrorText,
  say,
  taipeiStamp,
  taipeiTime,
  working,
  type Copy,
} from "./admin-voice-quality-labels";
import { AdminVoiceQualityListening } from "./admin-voice-quality-listening";
import { useLocale } from "./locale-provider";

/*
 * /admin/voice, "Quality" tab (P2-6; phase2-contract §7.1-§7.4, §11.3): calls flagged by a store or by the system,
 * filters, a CSV export of what is loaded, and an in-page drawer with the call's facts, its content and the review.
 * The blind listening log (§7.5) sits below. Nothing here stores or shows what the caller said: the list and the
 * drawer hold times, lengths, categories and the operators' own notes; content is read from the Taiwan host only
 * when an operator asks (admin-voice-quality-content.tsx).
 */

type Filters = {
  /** A9 `ref`: the call ID a store quotes (CallItem.ref, the first 8 hex of the id); "" for none. */
  ref: string;
  store: string;
  flag: QualityFlagFilter;
  reviewed: QualityReviewedFilter;
  month: string;
  outcome: CallOutcome | "";
  entry: CallEntry | "";
};
const DEFAULT_FILTERS: Filters = { ref: "", store: "", flag: "any", reviewed: "0", month: "", outcome: "", entry: "" };
/** A9 `ref` (the BFF forwards only this shape). */
const CALL_REF = /^[a-f0-9]{8}$/;

const FLAG_FILTER_LABEL: Record<QualityFlagFilter, Copy> = {
  any: { zh: "有標記（店家或自動）", en: "Flagged (store or auto)" },
  store: { zh: "店家標記", en: "Store flags" },
  auto: { zh: "自動標記", en: "Auto flags" },
  none: { zh: "沒有標記", en: "Not flagged" },
  all: { zh: "全部", en: "All" },
};
const REVIEWED_FILTER_LABEL: Record<QualityReviewedFilter, Copy> = {
  "0": { zh: "待審", en: "To review" },
  "1": { zh: "已審", en: "Reviewed" },
  all: { zh: "全部", en: "All" },
};

const T = {
  title: { zh: "品質", en: "Quality" },
  // Not in the contract's §11.3 (added with the A9 `ref` filter): the store's page says "通話編號 {ref}" (§11.2).
  ref: { zh: "通話編號", en: "Call ID" },
  refHint: { zh: "店家提供的 8 碼，例如 77a7b240。查詢時會看全部標記與審查狀態。", en: "The 8 characters a store gives, e.g. 77a7b240. Searches every flag and review state." },
  refInvalid: { zh: "通話編號是 8 個字元（0–9、a–f）。", en: "A call ID is 8 characters (0–9, a–f)." },
  counts: { zh: "店家標記待審 {n}・自動標記待審 {m}", en: "Store flags to review: {n} · Auto flags to review: {m}" },
  store: { zh: "店家", en: "Store" },
  allStores: { zh: "全部店家", en: "All stores" },
  flag: { zh: "標記", en: "Flags" },
  reviewed: { zh: "審查", en: "Review" },
  month: { zh: "月份", en: "Month" },
  allMonths: { zh: "全部月份", en: "All months" },
  outcome: { zh: "結果", en: "Result" },
  allOutcomes: { zh: "全部結果", en: "All results" },
  entry: { zh: "入口", en: "Entry" },
  allEntries: { zh: "全部入口", en: "All entries" },
  refresh: { zh: "重新整理", en: "Refresh" },
  export: { zh: "匯出 CSV", en: "Export CSV" },
  exportHint: {
    zh: "匯出目前載入的 {n} 通（依目前的篩選，不含備註）。要更多就先按「載入更多」。",
    en: "Exports the {n} calls loaded now (current filters, without notes). Use \"Load more\" first to include more.",
  },
  time: { zh: "時間", en: "Time" },
  result: { zh: "結果", en: "Result" },
  flags: { zh: "標記", en: "Flags" },
  score: { zh: "分數", en: "Score" },
  status: { zh: "狀態", en: "Status" },
  actions: { zh: "動作", en: "Actions" },
  open: { zh: "查看", en: "Open" },
  openLabel: { zh: "查看通話：{store}・{time}", en: "Open call: {store} · {time}" },
  storeFlag: { zh: "店家：答錯了", en: "Store: wrong answer" },
  storeDeleted: { zh: "店家已刪除內容", en: "Store deleted the content" },
  urgent: { zh: "緊急", en: "Urgent" },
  empty: {
    zh: "沒有符合條件的通話。店家標記或系統自動標記的通話會出現在這裡。",
    en: "No calls match these filters. Calls flagged by stores or by the system appear here.",
  },
  loading: { zh: "正在載入通話…", en: "Loading calls…" },
  failed: { zh: "通話載入失敗，請重新整理。", en: "Calls could not be loaded. Reload the page." },
  loadMore: { zh: "載入更多", en: "Load more" },
  showing: { zh: "已載入 {n} 通", en: "{n} calls loaded" },
} satisfies Record<string, Copy>;

/** The last 13 Taipei months, newest first (the month filter; "All months" reaches older calls, kept 5 years by default, §16.5). */
function recentMonths(today = taipeiToday()): string[] {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: 13 }, (_, back) => {
    const index = year * 12 + (month - 1) - back;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  });
}

/** A9 query string; only the filters the BFF forwards (app/api/portal/[...path]/route.ts QUALITY_CALL_FILTERS). */
function queryOf(filters: Filters, before?: string): string {
  const params = new URLSearchParams();
  if (filters.ref) params.set("ref", filters.ref);
  if (filters.store) params.set("store", filters.store);
  params.set("flag", filters.flag);
  params.set("reviewed", filters.reviewed);
  if (filters.month) params.set("month", filters.month);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.entry) params.set("entry", filters.entry);
  if (before) params.set("before", before);
  return params.toString();
}

/** True for errors that mean "the list could not be read" rather than a specific refusal. */
const loadFailed = (error: unknown) => !(error instanceof PortalError) || error.status >= 500 || error.code === "unavailable";

/** What one row says in the "Flags" column: a store deletion (§16.2), the store's flag, then the system's. */
function flagTexts(item: QualityItem, zh: boolean): string[] {
  const texts = [...(item.storeDeletedAt ? [say(T.storeDeleted, zh)] : []), ...(item.storeFlag ? [say(T.storeFlag, zh)] : [])];
  return texts.concat(item.autoFlags.map((flag) => (AUTO_FLAG_LABEL[flag] ? say(AUTO_FLAG_LABEL[flag], zh) : flag)));
}

const storeName = (item: { store: QualityItem["store"] }, zh: boolean) => item.store?.name ?? say(NO_STORE, zh);

/** The export: codes rather than labels (stable for counting in a spreadsheet), no free-text notes (§9 purges them). */
function exportCsv(calls: QualityItem[], zh: boolean): string {
  const header = zh
    ? ["時間（台北）", "紀錄 id", "通話編號", "線路通話 ID", "店家", "店家 id", "號碼", "用途", "入口", "長度（秒）", "結果", "降級原因", "轉真人原因", "緊急",
       "自動標記", "店家標記", "店家標記時間（台北）", "分數", "審查標籤", "審查狀態", "審查人", "審查時間（台北）", "預估計費則數", "計量理由"]
    : ["Time (Taipei)", "Record id", "Call ID", "Line call ID", "Store", "Store id", "Number", "Purpose", "Entry", "Length (s)", "Result", "Fallback reason",
       "Handoff reason", "Urgent", "Auto flags", "Store flag", "Store flagged at (Taipei)", "Score", "Review labels", "Review status",
       "Reviewer", "Reviewed at (Taipei)", "Estimated billable", "Meter reason"];
  const rows = calls.map((item) => [
    taipeiStamp(item.startedAt),
    item.id,
    item.id.slice(0, 8),
    item.callId,
    item.store?.name ?? "",
    item.store?.id ?? "",
    item.dialed,
    item.numberPurpose,
    item.entry,
    item.durationSeconds,
    item.outcome,
    item.degradeReason,
    item.handoffReason,
    item.urgent ? 1 : 0,
    item.autoFlags.join("|"),
    item.storeFlag?.kind ?? "",
    taipeiStamp(item.storeFlag?.flaggedAt ?? null),
    item.review?.score ?? null,
    item.review ? item.review.labels.join("|") : "",
    item.review?.status ?? "",
    item.review?.reviewer.email ?? "",
    taipeiStamp(item.review?.updatedAt ?? null),
    item.meterUnits,
    item.meterReason,
  ]);
  return toCsv(header, rows);
}

type ListState = {
  key: string;
  calls: QualityItem[];
  next: string | null;
  error: unknown;
};

export function AdminVoiceQuality({ stores }: { stores: StoreItem[] }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  /** What is typed in the call ID box; it becomes the `ref` filter once it is 8 hex characters (or empty). */
  const [refDraft, setRefDraft] = useState("");
  const [revision, setRevision] = useState(0);
  const query = queryOf(filters);
  const key = `${query}#${revision}`;
  const [list, setList] = useState<ListState>({ key: "", calls: [], next: null, error: null });
  const [counts, setCounts] = useState<QualityList["counts"] | null>(null);
  const [limits, setLimits] = useState<QualityLimits | null>(null);
  const [more, setMore] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });
  const moreBusy = useRef(false);
  const [selected, setSelected] = useState<QualityItem | null>(null);
  /** Element ids to focus after the next render, first one present wins (phase 1 fix: focus never falls to <body>). */
  const focusIds = useRef<string[] | null>(null);
  useEffect(() => {
    if (focusIds.current === null) return;
    const target = focusIds.current.map((id) => document.getElementById(id)).find((element) => element !== null);
    focusIds.current = null;
    target?.focus();
  });

  useEffect(() => {
    const controller = new AbortController();
    portalRequest<QualityList>(`/admin/voice/quality/calls?${query}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setList({ key, calls: data.calls, next: data.next, error: null });
        setCounts(data.counts);
        setLimits(data.limits);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setList({ key, calls: [], next: null, error });
      });
    return () => controller.abort();
  }, [query, key]);

  const loading = list.key !== key;
  const update = (change: Partial<Filters>) => {
    setMore({ busy: false, error: null });
    setFilters((current) => ({ ...current, ...change }));
  };
  /** A store's call ID: looked up whatever its flags and review (A9 does the same when they are left out). */
  function typeRef(value: string) {
    setRefDraft(value);
    const ref = value.trim().toLowerCase();
    if (ref === filters.ref || (ref !== "" && !CALL_REF.test(ref))) return;
    update(ref ? { ref, flag: "all", reviewed: "all" } : { ref: "", flag: DEFAULT_FILTERS.flag, reviewed: DEFAULT_FILTERS.reviewed });
  }
  const refProblem = refDraft.trim() !== "" && !CALL_REF.test(refDraft.trim().toLowerCase());

  async function loadMore() {
    if (moreBusy.current || !list.next) return;
    moreBusy.current = true;
    setMore({ busy: true, error: null });
    const startKey = key;
    try {
      const data = await portalRequest<QualityList>(`/admin/voice/quality/calls?${queryOf(filters, list.next)}`);
      setList((current) => {
        if (current.key !== startKey) return current;
        const seen = new Set(current.calls.map((item) => item.id));
        return { ...current, calls: [...current.calls, ...data.calls.filter((item) => !seen.has(item.id))], next: data.next };
      });
      setCounts(data.counts);
      setLimits(data.limits);
      // The button may be gone now (last page): keyboard focus goes to the first row that just arrived.
      if (data.calls[0]) focusIds.current = ["voice-quality-more", `voice-quality-open-${data.calls[0].id}`];
      setMore({ busy: false, error: null });
    } catch (error: unknown) {
      setMore({ busy: false, error });
    } finally {
      moreBusy.current = false;
    }
  }

  function closeDrawer() {
    if (selected) focusIds.current = [`voice-quality-open-${selected.id}`, "voice-quality-title"];
    setSelected(null);
  }

  /** A11 saved: the row shows the new review, and the open counts move when the review was opened or finished. */
  function reviewed(call: QualityDetail["call"], review: CallReview, before: CallReview | null) {
    setList((current) => ({
      ...current,
      calls: current.calls.map((item) => (item.id === call.id ? { ...item, review } : item)),
    }));
    const wasOpen = before?.status !== "done";
    const isOpen = review.status !== "done";
    if (wasOpen === isOpen) return;
    const delta = isOpen ? 1 : -1;
    setCounts((current) =>
      current && {
        storeFlaggedOpen: Math.max(0, current.storeFlaggedOpen + (call.storeFlag ? delta : 0)),
        autoFlaggedOpen: Math.max(0, current.autoFlaggedOpen + (call.autoFlags.length ? delta : 0)),
      },
    );
  }

  const count = (value: number) => value.toLocaleString(zh ? "zh-TW" : "en-US");
  const months = recentMonths();
  return (
    <>
      <section className="portal-panel" aria-labelledby="voice-quality-title">
        <div className="portal-panel-heading">
          <h2 id="voice-quality-title" tabIndex={-1}>
            {say(T.title, zh)}
          </h2>
        </div>
        {counts && (
          <p className="portal-muted" data-voice-quality-counts="">
            {fill(say(T.counts, zh), { n: count(counts.storeFlaggedOpen), m: count(counts.autoFlaggedOpen) })}
          </p>
        )}
        <div className="portal-actions">
          <label className="portal-field">
            {say(T.ref, zh)}
            <input
              type="search"
              value={refDraft}
              maxLength={16}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={refProblem}
              aria-describedby="voice-quality-ref-hint"
              onChange={(event) => typeRef(event.target.value)}
            />
          </label>
          <label className="portal-field">
            {say(T.store, zh)}
            <select value={filters.store} onChange={(event) => update({ store: event.target.value })}>
              <option value="">{say(T.allStores, zh)}</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-field">
            {say(T.flag, zh)}
            <select value={filters.flag} onChange={(event) => update({ flag: event.target.value as QualityFlagFilter })}>
              {QUALITY_FLAG_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {say(FLAG_FILTER_LABEL[value], zh)}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-field">
            {say(T.reviewed, zh)}
            <select value={filters.reviewed} onChange={(event) => update({ reviewed: event.target.value as QualityReviewedFilter })}>
              {QUALITY_REVIEWED_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {say(REVIEWED_FILTER_LABEL[value], zh)}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-field">
            {say(T.month, zh)}
            <select value={filters.month} onChange={(event) => update({ month: event.target.value })}>
              <option value="">{say(T.allMonths, zh)}</option>
              {months.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-field">
            {say(T.outcome, zh)}
            <select value={filters.outcome} onChange={(event) => update({ outcome: event.target.value as CallOutcome | "" })}>
              <option value="">{say(T.allOutcomes, zh)}</option>
              {OUTCOMES.map((value) => (
                <option key={value} value={value}>
                  {say(OUTCOME_LABEL[value], zh)}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-field">
            {say(T.entry, zh)}
            <select value={filters.entry} onChange={(event) => update({ entry: event.target.value as CallEntry | "" })}>
              <option value="">{say(T.allEntries, zh)}</option>
              {ENTRIES.map((value) => (
                <option key={value} value={value}>
                  {say(ENTRY_LABEL[value], zh)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="portal-button-secondary" onClick={() => setRevision((value) => value + 1)}>
            {say(T.refresh, zh)}
          </button>
          <button
            type="button"
            className="portal-button-secondary"
            disabled={loading || list.calls.length === 0}
            aria-describedby="voice-quality-export-hint"
            onClick={() => downloadText(`voice-quality-${taipeiStamp(new Date().toISOString()).replace(/[-: ]/g, "").slice(0, 12)}.csv`, exportCsv(list.calls, zh), "text/csv;charset=utf-8")}
          >
            {say(T.export, zh)}
          </button>
        </div>
        <p id="voice-quality-ref-hint" className={refProblem ? "portal-error" : "portal-hint"} role={refProblem ? "alert" : undefined}>
          {say(refProblem ? T.refInvalid : T.refHint, zh)}
        </p>
        <p id="voice-quality-export-hint" className="portal-hint">
          {fill(say(T.exportHint, zh), { n: count(loading ? 0 : list.calls.length) })}
        </p>
        {loading ? (
          <p className="portal-muted" role="status">
            {say(T.loading, zh)}
          </p>
        ) : list.error !== null ? (
          <div>
            <p className="portal-error" role="alert">
              {voiceFeatureOff(list.error) ? say(FEATURE_OFF, zh) : loadFailed(list.error) ? say(T.failed, zh) : qualityErrorText(list.error, locale)}
            </p>
            <div className="portal-actions">
              <button type="button" className="portal-button-secondary" onClick={() => setRevision((value) => value + 1)}>
                {say(T.refresh, zh)}
              </button>
            </div>
          </div>
        ) : list.calls.length === 0 ? (
          <p className="portal-empty">{say(T.empty, zh)}</p>
        ) : (
          <>
            <p className="portal-muted">{fill(say(T.showing, zh), { n: count(list.calls.length) })}</p>
            <div className="portal-table-wrap">
              <table className="portal-table voice-stack">
                <caption className="sr-only">{say(T.title, zh)}</caption>
                <thead>
                  <tr>
                    <th scope="col">{say(T.time, zh)}</th>
                    <th scope="col">{say(T.ref, zh)}</th>
                    <th scope="col">{say(T.store, zh)}</th>
                    <th scope="col">{say(T.entry, zh)}</th>
                    <th scope="col">{say(T.result, zh)}</th>
                    <th scope="col">{say(T.flags, zh)}</th>
                    <th scope="col">{say(T.score, zh)}</th>
                    <th scope="col">{say(T.status, zh)}</th>
                    <th scope="col">{say(T.actions, zh)}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.calls.map((item) => {
                    const time = taipeiTime(item.startedAt, zh);
                    const flags = flagTexts(item, zh);
                    return (
                      <tr key={item.id} aria-current={selected?.id === item.id ? "true" : undefined}>
                        <th scope="row">{time}</th>
                        <td data-label={say(T.ref, zh)}>
                          <code>{item.id.slice(0, 8)}</code>
                        </td>
                        <td data-label={say(T.store, zh)}>{storeName(item, zh)}</td>
                        <td data-label={say(T.entry, zh)}>{ENTRY_LABEL[item.entry] ? say(ENTRY_LABEL[item.entry], zh) : item.entry}</td>
                        <td data-label={say(T.result, zh)}>
                          {OUTCOME_LABEL[item.outcome] ? say(OUTCOME_LABEL[item.outcome], zh) : item.outcome}
                          {item.urgent && (
                            <>
                              {" "}
                              <span className="portal-badge">{say(T.urgent, zh)}</span>
                            </>
                          )}
                        </td>
                        <td data-label={say(T.flags, zh)}>{flags.length ? flags.join(zh ? "、" : ", ") : "—"}</td>
                        <td data-label={say(T.score, zh)}>{item.review ? item.review.score : "—"}</td>
                        <td data-label={say(T.status, zh)}>{say(item.review?.status === "done" ? LIST_STATUS.done : LIST_STATUS.open, zh)}</td>
                        <td>
                          <button
                            type="button"
                            id={`voice-quality-open-${item.id}`}
                            className="portal-text-button"
                            aria-label={fill(say(T.openLabel, zh), { store: storeName(item, zh), time })}
                            aria-expanded={selected?.id === item.id}
                            aria-controls={selected?.id === item.id ? "voice-quality-drawer" : undefined}
                            onClick={() => setSelected(item)}
                          >
                            {say(T.open, zh)}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {list.next !== null && (
              <div className="portal-actions">
                <button
                  type="button"
                  id="voice-quality-more"
                  className="portal-button-secondary"
                  disabled={more.busy}
                  onClick={() => void loadMore()}
                >
                  {more.busy ? working(zh) : say(T.loadMore, zh)}
                </button>
              </div>
            )}
            {more.error !== null && (
              <p className="portal-error" role="alert">
                {loadFailed(more.error) ? say(T.failed, zh) : qualityErrorText(more.error, locale)}
              </p>
            )}
          </>
        )}
      </section>
      {selected !== null && (
        <AdminVoiceQualityDrawer key={selected.id} item={selected} limits={limits} onClose={closeDrawer} onReviewed={reviewed} />
      )}
      <AdminVoiceQualityListening listeningMax={limits?.listeningMax ?? null} />
    </>
  );
}
