import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountVoiceCalls } from "../components/account-voice-calls";
import { LocaleProvider } from "../components/locale-provider";
import {
  callTime,
  callerText,
  dateText,
  durationText,
  hasPhoneNumber,
  monthLabel,
  shiftMonth,
  taipeiMonth,
} from "../lib/voice-calls";
import vectors from "./support/phone-like-vectors.json";
import { OTHER_STORE_ID, backend, failure, row, stubPortal, summaryOf, type Backend } from "./support/voice-calls-backend";

/** 2026-12-21 12:00 in Taipei. */
const NOW = new Date("2026-12-21T04:00:00Z");
const NOV = Math.floor(Date.parse("2026-11-30T15:59:59Z") / 1000); // 23:59:59 on 30 November in Taipei
const DEC = Math.floor(Date.parse("2026-11-30T16:00:00Z") / 1000); // 00:00:00 on 1 December in Taipei

/** Six December calls of the store, one late-November call, and one call of another store. */
function month(): Backend {
  return backend({
    rows: [
      row(0),
      row(1, { outcome: "message", hasMessage: true, caller: { tail: "123", kind: "landline" }, meterReason: "message" }),
      row(2, { entry: "try", caller: { tail: null, kind: "unknown" }, meterUnits: 0, meterReason: "try", endedAt: null }),
      row(3, { caller: { tail: null, kind: "hidden" }, outcome: "handoff", handoff: true, handoffReason: "requested", urgent: true }),
      row(4, { entry: "webrtc", caller: { tail: null, kind: "web" }, outcome: "degraded", degraded: true, meterUnits: 0, meterReason: "channel_not_billable" }),
      row(5, { startedAt: DEC, endedAt: DEC + 61, degraded: true, flag: { kind: "wrong_answer", note: "", flaggedAt: DEC + 600 } }),
      row(6, { startedAt: NOV, endedAt: NOV + 30 }),
      row(7, { storeId: OTHER_STORE_ID }),
    ],
  });
}

function renderCalls(state: Backend) {
  const requests = stubPortal(state);
  render(
    <LocaleProvider>
      <AccountVoiceCalls summary={summaryOf(state)} onChanged={vi.fn()} />
    </LocaleProvider>,
  );
  return requests;
}

/** The saved locale applies on account pages only ("/" is English-only). */
function chinese() {
  localStorage.setItem("pc-locale", "zh");
  window.history.replaceState({}, "", "/account/voice/calls");
}

const listReads = (requests: { path: string }[]) => requests.map((request) => request.path).filter((path) => path.startsWith("/me/voice/calls"));
const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const cells = (tr: HTMLElement) => within(tr).getAllByRole("cell").map((cell) => cell.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("call records helpers", () => {
  it("formats Taipei times, lengths, months and callers", () => {
    expect(taipeiMonth(NOV * 1000)).toBe("2026-11");
    expect(taipeiMonth(DEC * 1000)).toBe("2026-12");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthLabel("2026-12", true)).toBe("2026 年 12 月");
    expect(monthLabel("2026-12", false)).toBe("December 2026");
    expect(callTime("2026-12-21T01:15:02Z", true)).toBe("2026 年 12 月 21 日 09:15");
    expect(callTime("2026-12-21T01:15:02Z", false, false)).toBe("Dec 21, 09:15");
    expect(callTime("not a time", false)).toBe("—");
    expect(dateText("2027-03-20T16:30:00Z", true)).toBe("2027 年 3 月 21 日");
    expect(durationText(159, true)).toBe("2 分 39 秒");
    expect(durationText(42, false)).toBe("0m 42s");
    expect(durationText(null, true)).toBe("—");
    expect(callerText({ entry: "softphone", caller: { tail: "001", kind: "unknown" } }, false)).toBe("Ends in 001");
  });

  // The same file is checked against the backend by server/test_voice_calls_note_sync.py.
  it("finds phone numbers like the backend's PHONE_LIKE, with Python's whitespace", () => {
    expect(vectors.number.length).toBeGreaterThanOrEqual(10);
    for (const text of vectors.number) expect(hasPhoneNumber(text), JSON.stringify(text)).toBe(true);
    // e.g. seven digits, or U+FEFF between digits (JavaScript's \s has it, Python's does not).
    for (const text of vectors.not_number) expect(hasPhoneNumber(text), JSON.stringify(text)).toBe(false);
  });
});

describe("store call records list", () => {
  it("lists this Taipei month's calls of the store with the month summary", async () => {
    const requests = renderCalls(month());
    expect(screen.getByRole("status")).toHaveTextContent("Loading calls…");
    expect(await screen.findByText("This month: 6 calls. Answered 3, messages 1, handed off 1, fallback 1. Estimated billable: 4.")).toBeVisible();
    expect(screen.getByText("Billing follows the monthly statement; test calls, test numbers and web calls are not billed.")).toBeVisible();
    expect(listReads(requests)).toEqual(["/me/voice/calls?month=2026-12"]);
    expect(screen.getByText("December 2026")).toBeVisible();
    // Newest first; the November call and the other store's call are not here.
    const rows = bodyRows();
    expect(rows).toHaveLength(6);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("Dec 21, 09:15");
    expect(cells(rows[0])).toEqual(["Ends in 678 (mobile)", "2m 39s", "Answered", "—", "—"]);
    expect(cells(rows[1])).toEqual(["Ends in 123 (landline)", "2m 39s", "Message", "Yes", "—"]);
    expect(cells(rows[2])).toEqual(["Test call", "—", "Answered Test call", "—", "—"]);
    expect(cells(rows[3])).toEqual(["Number hidden", "2m 39s", "Handed off Urgent", "—", "—"]);
    // A fallback result does not repeat itself as a badge; a fallback on another result does.
    expect(cells(rows[4])).toEqual(["Web call", "2m 39s", "Fallback", "—", "—"]);
    expect(within(rows[5]).getByRole("rowheader")).toHaveTextContent("Dec 1, 00:00");
    expect(cells(rows[5])).toEqual(["Ends in 678 (mobile)", "1m 1s", "Answered Fallback", "—", "Flagged"]);
    const link = within(rows[0]).getByRole("link", { name: "Open the call at Dec 21, 09:15 (Answered)" });
    expect(link).toHaveAttribute("href", `/account/voice/calls/${"0".repeat(31)}1`);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("speaks Traditional Chinese", async () => {
    chinese();
    renderCalls(month());
    expect(await screen.findByText("本月 6 通：已回答 3、留言 1、轉真人 1、降級 1。預估計費 4 則。")).toBeVisible();
    expect(screen.getByText("計費則數以月結明細為準；試打、測試號碼和網頁通話不計費。")).toBeVisible();
    expect(screen.getByText("2026 年 12 月")).toBeVisible();
    expect(within(screen.getByRole("table")).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "時間", "來電", "長度", "結果", "留言", "標記",
    ]);
    const rows = bodyRows();
    expect(cells(rows[0])).toEqual(["尾碼 678（手機）", "2 分 39 秒", "已回答", "—", "—"]);
    expect(cells(rows[1])).toEqual(["尾碼 123（市話）", "2 分 39 秒", "留言", "有", "—"]);
    expect(cells(rows[2])).toEqual(["試打", "—", "已回答 試打", "—", "—"]);
    expect(cells(rows[3])).toEqual(["未顯示號碼", "2 分 39 秒", "轉真人 緊急", "—", "—"]);
    expect(cells(rows[4])).toEqual(["網頁通話", "2 分 39 秒", "降級", "—", "—"]);
    expect(cells(rows[5])).toEqual(["尾碼 678（手機）", "1 分 1 秒", "已回答 降級", "—", "已標記"]);
    expect(within(rows[0]).getByRole("link", { name: "查看 12 月 21 日 09:15 的來電（已回答）" })).toBeVisible();
    const select = screen.getByRole("combobox", { name: "結果" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "全部結果", "已回答", "留言", "轉真人", "降級", "未接通", "開頭就掛斷", "沒有說話", "處理失敗", "待補紀錄",
    ]);
    expect(screen.getByRole("checkbox", { name: "只看我標記的" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "上一月" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下一月" })).toBeDisabled();
  });

  it("filters by result and by the store's own flag; the summary stays the month's", async () => {
    const user = userEvent.setup();
    const requests = renderCalls(month());
    await screen.findByText(/^This month: 6 calls\./);
    expect(bodyRows()).toHaveLength(6);
    await user.selectOptions(screen.getByRole("combobox", { name: "Result" }), "message");
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(cells(bodyRows()[0])[2]).toBe("Message");
    expect(screen.getByText(/^This month: 6 calls\./)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Only calls I flagged" }));
    expect(await screen.findByText("No calls match these filters.")).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "Result" }), "");
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(cells(bodyRows()[0])[4]).toBe("Flagged");
    expect(listReads(requests)).toEqual([
      "/me/voice/calls?month=2026-12",
      "/me/voice/calls?month=2026-12&outcome=message",
      "/me/voice/calls?month=2026-12&outcome=message&flagged=1",
      "/me/voice/calls?month=2026-12&flagged=1",
    ]);
  });

  it("moves between months, not past this month nor before the 400 days a call is kept", async () => {
    const user = userEvent.setup();
    const requests = renderCalls(month());
    await screen.findByText(/^This month: 6 calls\./);
    const previous = screen.getByRole("button", { name: "Previous month" });
    const next = screen.getByRole("button", { name: "Next month" });
    expect(next).toBeDisabled();
    await user.click(previous);
    expect(await screen.findByText("November 2026: 1 calls. Answered 1, messages 0, handed off 0, fallback 0. Estimated billable: 1.")).toBeVisible();
    expect(bodyRows()).toHaveLength(1);
    expect(within(bodyRows()[0]).getByRole("rowheader")).toHaveTextContent("Nov 30, 23:59");
    expect(next).toBeEnabled();
    await user.click(previous);
    expect(await screen.findByText("No calls in this month.")).toBeVisible();
    while (!previous.hasAttribute("disabled")) await user.click(previous);
    // 21 December 2026 minus 400 days is 16 November 2025.
    expect(screen.getByText("November 2025")).toBeVisible();
    await user.click(next);
    expect(listReads(requests).at(-1)).toBe("/me/voice/calls?month=2025-12");
    expect(listReads(requests).filter((path) => path.endsWith("month=2025-11"))).toHaveLength(1);
  });

  it("loads the next 50 with the cursor and moves focus to the first added call", async () => {
    const user = userEvent.setup();
    const state = backend({ rows: Array.from({ length: 55 }, (_, n) => row(n)) });
    const requests = renderCalls(state);
    await screen.findByText(/^This month: 55 calls\./);
    expect(bodyRows()).toHaveLength(50);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(bodyRows()).toHaveLength(55));
    const fiftieth = state.rows[49];
    expect(listReads(requests)[1]).toBe(`/me/voice/calls?month=2026-12&before=${fiftieth.startedAt}-${fiftieth.id}`);
    expect(new Set(bodyRows().map((tr) => within(tr).getByRole("link").getAttribute("href"))).size).toBe(55);
    expect(document.activeElement).toBe(within(bodyRows()[50]).getByRole("link"));
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("says when the month has no calls, with a way to try one", async () => {
    renderCalls(backend());
    expect(await screen.findByText(/^No calls this month yet\./)).toHaveTextContent(
      "No calls this month yet. Try a call; it shows up here within a few minutes after it ends.",
    );
    expect(screen.getByRole("link", { name: "Try a call" })).toHaveAttribute("href", "/account/voice/try");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says so in Chinese when the month has no calls", async () => {
    chinese();
    renderCalls(backend());
    expect(await screen.findByText(/^這個月還沒有通話。/)).toHaveTextContent(
      "這個月還沒有通話。到「試打一通」打一通看看，結束後幾分鐘內會出現在這裡。",
    );
    expect(screen.getByText("本月 0 通：已回答 0、留言 0、轉真人 0、降級 0。預估計費 0 則。")).toBeVisible();
  });

  it("shows the load failure and reads again on request", async () => {
    const user = userEvent.setup();
    const state = month();
    const requests = stubPortal(state);
    const fetchMock = vi.mocked(fetch);
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementationOnce(async () => failure(500, "internal_error"));
    render(
      <LocaleProvider>
        <AccountVoiceCalls summary={summaryOf(state)} onChanged={vi.fn()} />
      </LocaleProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Calls could not be loaded. Reload the page.");
    fetchMock.mockImplementation(real);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/^This month: 6 calls\./)).toBeVisible();
    expect(requests).toHaveLength(1); // the failed read was answered by the override, not recorded by the stub
  });

  it("explains a missing store", async () => {
    renderCalls(backend({ storeMissing: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Phone agent is not set up for this account.");
  });

  it("does not render an answer that is not a call list", async () => {
    const state = month();
    stubPortal(state);
    vi.mocked(fetch).mockImplementation(async () => Response.json({ calls: "nope" }));
    render(
      <LocaleProvider>
        <AccountVoiceCalls summary={summaryOf(state)} onChanged={vi.fn()} />
      </LocaleProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Calls could not be loaded. Reload the page.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps only the newest filter's answer when an older read comes back late", async () => {
    const user = userEvent.setup();
    let release = () => {};
    const state = month();
    state.gates.push(new Promise<void>((resolve) => (release = resolve)));
    renderCalls(state);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Result" }), "handoff");
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bodyRows()).toHaveLength(1);
    expect(cells(bodyRows()[0])[2]).toBe("Handed off Urgent");
  });

  it("opens a call when its row is clicked, and leaves modified clicks to the browser", async () => {
    const user = userEvent.setup();
    renderCalls(month());
    await screen.findByText(/^This month: 6 calls\./);
    const first = bodyRows()[0];
    const link = within(first).getByRole("link");
    const opened = vi.fn();
    link.addEventListener("click", (event) => {
      event.preventDefault();
      opened();
    });
    await user.click(within(first).getAllByRole("cell")[1]);
    expect(opened).toHaveBeenCalledTimes(1);
    await user.keyboard("{Control>}");
    await user.click(within(first).getAllByRole("cell")[1]);
    await user.keyboard("{/Control}");
    expect(opened).toHaveBeenCalledTimes(1);
    // The link is the keyboard way in.
    link.focus();
    await user.keyboard("{Enter}");
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("stacks into cards on a phone: every cell is labelled and the time is the row header", async () => {
    renderCalls(month());
    await screen.findByText(/^This month: 6 calls\./);
    const table = screen.getByRole("table");
    expect(table).toHaveClass("portal-table", "voice-stack");
    for (const tr of bodyRows()) {
      expect(within(tr).getByRole("rowheader").querySelector("a")).not.toBeNull();
      for (const cell of within(tr).getAllByRole("cell")) expect(cell).toHaveAttribute("data-label");
    }
    expect(within(bodyRows()[0]).getAllByRole("cell").map((cell) => cell.getAttribute("data-label"))).toEqual([
      "Caller", "Length", "Result", "Message", "Flag",
    ]);
  });

  it("sends only filters the BFF forwards", async () => {
    const user = userEvent.setup();
    const requests = renderCalls(month());
    await screen.findByText(/^This month: 6 calls\./);
    await user.selectOptions(screen.getByRole("combobox", { name: "Result" }), "unknown");
    await screen.findByText("No calls match these filters.");
    for (const path of listReads(requests)) {
      const query = new URLSearchParams(path.split("?")[1]);
      expect([...query.keys()].every((key) => ["month", "outcome", "flagged", "before"].includes(key))).toBe(true);
    }
  });
});
