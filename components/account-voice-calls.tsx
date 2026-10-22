"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactElement } from "react";
import { PortalError, portalRequest } from "../lib/portal-client";
import {
  CALL_CURSOR,
  OUTCOMES,
  OUTCOME_LABELS,
  callTime,
  callerText,
  durationText,
  monthLabel,
  shiftMonth,
  taipeiMonth,
  type CallList,
  type CallOutcome,
} from "../lib/voice-calls";
import { voiceErrorText } from "../lib/voice-setup";
import type { VoiceSubProps } from "./account-voice";
import { AccountVoiceCallDetail, CallBadges } from "./account-voice-calls-detail";
import { useLocale } from "./locale-provider";

/** /account/voice/calls[/<id>]: `callId` is set on one call's page; the route has already checked it is 32 lowercase hex. */
export type VoiceCallsProps = VoiceSubProps & { callId?: string };

const DAY_MS = 86400 * 1000;
/**
 * §16.5 callDetailDays: a call's row is kept PC_VOICE_CALL_RETENTION_DAYS (5 years by default), so months before that
 * have nothing to show. M13's `limits.callDetailDays` replaces this as soon as the list answers.
 */
const CALL_DETAIL_DAYS_DEFAULT = 1825;
const detailDays = (list: CallList | null) => {
  const days = list?.limits.callDetailDays;
  return typeof days === "number" && Number.isInteger(days) && days >= 90 && days <= 3660 ? days : CALL_DETAIL_DAYS_DEFAULT;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only an M13 body is rendered; a proxy or mock answering some other JSON shows the load error instead. */
function isCallList(value: unknown): value is CallList {
  return (
    record(value) &&
    Array.isArray(value.calls) &&
    value.calls.every((call) => record(call) && typeof call.id === "string" && record(call.caller)) &&
    (value.next === null || (typeof value.next === "string" && CALL_CURSOR.test(value.next))) &&
    record(value.summary) &&
    record(value.summary.byOutcome) &&
    record(value.limits)
  );
}

type Filters = { month: string; outcome: CallOutcome | ""; flagged: boolean };

/**
 * The list's month and filters for this browser tab, so "← Calls" or the browser's Back from a call returns to the
 * same month and filters instead of this month's full list. Kept in sessionStorage (not the URL): the list is drawn
 * as soon as the route changes, before a client-side navigation has necessarily updated window.location.
 */
const FILTERS_KEY = "pc-voice-calls-filters";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function savedFilters(current: string, oldest: string): Filters {
  const fallback: Filters = { month: current, outcome: "", flagged: false };
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(FILTERS_KEY) ?? "null");
    if (!record(value)) return fallback;
    const month = typeof value.month === "string" && MONTH.test(value.month) && value.month >= oldest && value.month <= current ? value.month : current;
    const outcome = (OUTCOMES as readonly unknown[]).includes(value.outcome) ? (value.outcome as CallOutcome) : "";
    return { month, outcome, flagged: value.flagged === true };
  } catch {
    // Storage blocked or a bad value: start from this month.
    return fallback;
  }
}

function saveFilters(filters: Filters) {
  try {
    window.sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Not kept: the list still works, it just starts from this month next time.
  }
}
type Load =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; list: CallList; more: "idle" | "loading" | { error: unknown } };

function listPath(filters: Filters, before?: string) {
  const query = new URLSearchParams({ month: filters.month });
  if (filters.outcome) query.set("outcome", filters.outcome);
  if (filters.flagged) query.set("flagged", "1");
  if (before) query.set("before", before);
  return `/me/voice/calls?${query.toString()}`;
}

/** §11.1 errors: no store keeps the phase 1 copy; network errors and 5xx get the load-failure line. */
function loadErrorText(error: unknown, locale: "en" | "zh"): string {
  const zh = locale === "zh";
  if (error instanceof PortalError && error.code === "voice_store_not_found") return voiceErrorText(error, locale);
  if (!(error instanceof PortalError) || error.status >= 500 || error.status === 404)
    return zh ? "通話紀錄載入失敗，請重新整理。" : "Calls could not be loaded. Reload the page.";
  return voiceErrorText(error, locale);
}

/** A click on the row (not on its link or another control) opens the call, like clicking its link (§11.1). */
function openRow(event: MouseEvent<HTMLTableRowElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("a, button, input, select, textarea, label")) return;
  // Selecting text in a row (to copy it) is not a request to leave the page.
  if (typeof window.getSelection === "function" && window.getSelection()?.toString()) return;
  event.currentTarget.querySelector<HTMLAnchorElement>("a[data-call-link]")?.click();
}

/**
 * /account/voice/calls, the store's call records (phase2-contract §6.1, §11.1): one Taipei month at a time, with the
 * result and "only flagged" filters, 50 a page (M13 `limits.callsPageSize`). Only times, lengths and results are
 * listed; the content of a call is read on its own page. One call's page is AccountVoiceCallDetail.
 */
export function AccountVoiceCalls({ callId, ...props }: VoiceCallsProps): ReactElement {
  if (callId) return <AccountVoiceCallDetail {...props} callId={callId} />;
  return <CallsList />;
}

function CallsList(): ReactElement {
  const { locale } = useLocale();
  const zh = locale === "zh";
  // Read once: the current month and the oldest month that can still have calls.
  const [now] = useState(() => Date.now());
  const current = taipeiMonth(now);
  const [days, setDays] = useState(CALL_DETAIL_DAYS_DEFAULT);
  const oldest = taipeiMonth(now - days * DAY_MS);
  const [filters, setFilters] = useState<Filters>(() => savedFilters(current, taipeiMonth(now - CALL_DETAIL_DAYS_DEFAULT * DAY_MS)));
  useEffect(() => saveFilters(filters), [filters]);
  const [reload, setReload] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // Each first-page read gets a number; a "Load more" answer for an older read is dropped.
  const generation = useRef(0);
  const moreInFlight = useRef(false);
  const moreController = useRef<AbortController | null>(null);
  /** The first row "Load more" added; focused after the re-render so a keyboard user continues from there. */
  const focusAfterMore = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    moreController.current?.abort();
    moreInFlight.current = false;
    async function first() {
      setLoad({ status: "loading" });
      try {
        const list = await portalRequest<unknown>(listPath(filters), { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!isCallList(list)) throw new PortalError(502, "service_unavailable", "Unexpected answer.");
        setDays(detailDays(list));
        setLoad({ status: "ready", list, more: "idle" });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", error });
      }
    }
    void first();
    return () => controller.abort();
  }, [filters, reload]);

  useEffect(() => {
    if (focusAfterMore.current === null) return;
    const element = document.getElementById(`voice-call-link-${focusAfterMore.current}`);
    focusAfterMore.current = null;
    element?.focus();
  });

  useEffect(() => () => moreController.current?.abort(), []);

  async function loadMore() {
    if (load.status !== "ready" || !load.list.next || moreInFlight.current) return;
    moreInFlight.current = true;
    const asked = generation.current;
    const controller = new AbortController();
    moreController.current = controller;
    const before = load.list.next;
    setLoad({ ...load, more: "loading" });
    try {
      const page = await portalRequest<unknown>(listPath(filters, before), { signal: controller.signal });
      if (controller.signal.aborted || asked !== generation.current) return;
      if (!isCallList(page)) throw new PortalError(502, "service_unavailable", "Unexpected answer.");
      // Same read (generation checked above), so the list on screen is the one `before` came from.
      const seen = new Set(load.list.calls.map((call) => call.id));
      const added = page.calls.filter((call) => !seen.has(call.id));
      focusAfterMore.current = added[0]?.id ?? null;
      setLoad((previous) =>
        previous.status !== "ready"
          ? previous
          : { status: "ready", list: { ...previous.list, calls: [...previous.list.calls, ...added], next: page.next }, more: "idle" },
      );
    } catch (error) {
      if (controller.signal.aborted || asked !== generation.current) return;
      setLoad((previous) => (previous.status === "ready" ? { ...previous, more: { error } } : previous));
    } finally {
      if (asked === generation.current) moreInFlight.current = false;
    }
  }

  const label = monthLabel(filters.month, zh);
  const filtered = filters.outcome !== "" || filters.flagged;
  const isCurrent = filters.month === current;

  return (
    <section className="portal-panel" aria-labelledby="voice-calls-title">
      <h2 id="voice-calls-title">{zh ? "通話紀錄" : "Calls"}</h2>
      <p className="portal-muted">
        {zh
          ? "每通電話通常在結束後幾分鐘內出現在這裡；留言的結果處理好之後會再更新。清單只有時間、長度和結果；逐字稿、摘要和錄音另外保存，打開某一通再按「查看內容」才會讀取。"
          : 'Calls usually show up here within a few minutes after they end, and are updated once the message has been processed. The list has only times, lengths and results; transcripts, summaries and recordings are kept separately and load only when you open a call and choose "Show content".'}
      </p>

      <div className="portal-actions" role="group" aria-label={zh ? "月份" : "Month"}>
        <button
          type="button"
          className="portal-button-secondary"
          disabled={filters.month <= oldest}
          aria-label={zh ? "上一月" : "Previous month"}
          onClick={() => setFilters((value) => ({ ...value, month: shiftMonth(value.month, -1) }))}
        >
          ←
        </button>
        <strong aria-live="polite">{label}</strong>
        <button
          type="button"
          className="portal-button-secondary"
          disabled={filters.month >= current}
          aria-label={zh ? "下一月" : "Next month"}
          onClick={() => setFilters((value) => ({ ...value, month: shiftMonth(value.month, 1) }))}
        >
          →
        </button>
      </div>
      <div className="portal-actions">
        <label className="portal-field">
          {zh ? "結果" : "Result"}
          <select
            value={filters.outcome}
            onChange={(event) => setFilters((value) => ({ ...value, outcome: event.target.value as CallOutcome | "" }))}
          >
            <option value="">{zh ? "全部結果" : "All results"}</option>
            {OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {OUTCOME_LABELS[outcome][locale]}
              </option>
            ))}
          </select>
        </label>
        <label className="portal-field">
          <input
            type="checkbox"
            checked={filters.flagged}
            onChange={(event) => setFilters((value) => ({ ...value, flagged: event.target.checked }))}
          />
          {zh ? "只看我標記的" : "Only calls I flagged"}
        </label>
      </div>

      {load.status === "loading" && (
        <p className="portal-empty" role="status">
          {zh ? "正在載入通話紀錄…" : "Loading calls…"}
        </p>
      )}
      {load.status === "error" && (
        <div className="portal-empty">
          <p className="portal-error" role="alert">
            {loadErrorText(load.error, locale)}
          </p>
          <button type="button" className="portal-button-secondary" onClick={() => setReload((value) => value + 1)}>
            {zh ? "重新載入" : "Try again"}
          </button>
        </div>
      )}
      {load.status === "ready" && (
        <CallsTable
          list={load.list}
          more={load.more}
          zh={zh}
          locale={locale}
          label={label}
          isCurrent={isCurrent}
          filtered={filtered}
          onMore={() => void loadMore()}
        />
      )}
    </section>
  );
}

function CallsTable({
  list,
  more,
  zh,
  locale,
  label,
  isCurrent,
  filtered,
  onMore,
}: {
  list: CallList;
  more: "idle" | "loading" | { error: unknown };
  zh: boolean;
  locale: "en" | "zh";
  label: string;
  isCurrent: boolean;
  filtered: boolean;
  onMore: () => void;
}) {
  const { summary, calls } = list;
  const count = (key: CallOutcome) => summary.byOutcome[key] ?? 0;
  // §11.1 writes "This month"; another month names itself so the line never says "this month" about September.
  const lead = zh ? (isCurrent ? "本月" : label) : isCurrent ? "This month" : label;
  return (
    <>
      <p>
        {zh
          ? `${lead} ${summary.total} 通：已回答 ${count("answered")}、留言 ${count("message")}、轉真人 ${count("handoff")}、降級 ${count("degraded")}。預估計費 ${summary.meterUnits} 則。`
          : `${lead}: ${summary.total} calls. Answered ${count("answered")}, messages ${count("message")}, handed off ${count("handoff")}, fallback ${count("degraded")}. Estimated billable: ${summary.meterUnits}.`}
      </p>
      <p className="portal-hint">
        {zh
          ? "計費則數以月結明細為準；試打、測試號碼和網頁通話不計費。"
          : "Billing follows the monthly statement; test calls, test numbers and web calls are not billed."}
      </p>
      {(summary.deleted ?? 0) > 0 && (
        <p className="portal-hint">
          {zh
            ? `其中 ${summary.deleted} 通你已刪除錄音與文字，不在清單上，但仍算在上面的通數與計費裡。`
            : `You deleted the recording and text of ${summary.deleted} of these calls; they are not on the list but still count above, billing included.`}
        </p>
      )}
      {calls.length === 0 ? (
        <p className="portal-empty">
          {filtered ? (
            zh ? "沒有符合條件的通話。" : "No calls match these filters."
          ) : isCurrent ? (
            zh ? (
              <>
                這個月還沒有通話。到「<Link href="/account/voice/try">試打一通</Link>」打一通看看，結束後幾分鐘內會出現在這裡。
              </>
            ) : (
              <>
                No calls this month yet. <Link href="/account/voice/try">Try a call</Link>; it shows up here within a few minutes
                after it ends.
              </>
            )
          ) : zh ? (
            "這個月沒有通話。"
          ) : (
            "No calls in this month."
          )}
        </p>
      ) : (
        <div className="portal-table-wrap">
          <table className="portal-table voice-stack">
            <caption className="sr-only">{zh ? `${label}的通話` : `Calls in ${label}`}</caption>
            <thead>
              <tr>
                <th scope="col">{zh ? "時間" : "Time"}</th>
                <th scope="col">{zh ? "來電" : "Caller"}</th>
                <th scope="col">{zh ? "長度" : "Length"}</th>
                <th scope="col">{zh ? "結果" : "Result"}</th>
                <th scope="col">{zh ? "留言" : "Message"}</th>
                <th scope="col">{zh ? "標記" : "Flag"}</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const time = callTime(call.startedAt, zh, false);
                const result = OUTCOME_LABELS[call.outcome]?.[locale] ?? call.outcome;
                return (
                  // The row's link is the keyboard and screen-reader way in; a click anywhere else on the row is a
                  // mouse shortcut to the same link (§11.1 "row opens the call").
                  <tr key={call.id} onClick={openRow} style={{ cursor: "pointer" }}>
                    <th scope="row">
                      <Link
                        id={`voice-call-link-${call.id}`}
                        data-call-link=""
                        href={`/account/voice/calls/${call.id}`}
                        aria-label={zh ? `查看 ${time} 的來電（${result}）` : `Open the call at ${time} (${result})`}
                      >
                        {time}
                      </Link>
                    </th>
                    <td data-label={zh ? "來電" : "Caller"}>{callerText(call, zh)}</td>
                    <td data-label={zh ? "長度" : "Length"}>{durationText(call.durationSeconds, zh)}</td>
                    <td data-label={zh ? "結果" : "Result"}>
                      {result}
                      <CallBadges call={call} zh={zh} />
                    </td>
                    <td data-label={zh ? "留言" : "Message"}>{call.hasMessage ? (zh ? "有" : "Yes") : "—"}</td>
                    <td data-label={zh ? "標記" : "Flag"}>{call.flagged ? (zh ? "已標記" : "Flagged") : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {typeof more === "object" && (
        <p className="portal-error" role="alert">
          {loadErrorText(more.error, locale)}
        </p>
      )}
      {list.next !== null && (
        <div className="portal-actions">
          <button type="button" className="portal-button-secondary" disabled={more === "loading"} onClick={onMore}>
            {more === "loading" ? (zh ? "處理中…" : "Working…") : zh ? "載入更多" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
