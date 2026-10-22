import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountVoiceCalls } from "../components/account-voice-calls";
import { LocaleProvider } from "../components/locale-provider";
import {
  MEDIA_ORIGIN,
  OTHER_STORE_ID,
  backend,
  row,
  stubPortal,
  summaryOf,
  type Backend,
  type Request,
  type Row,
} from "./support/voice-calls-backend";

/** 2026-12-21 12:00 in Taipei. */
const NOW = new Date("2026-12-21T04:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const DAY = 86400;

function oneCall(values: Partial<Row> = {}, state: Partial<Backend> = {}): Backend {
  return backend({ rows: [row(0, { id: ID, ...values })], ...state });
}

function renderCall(state: Backend, id = ID, onChanged = vi.fn()) {
  const requests = stubPortal(state);
  const view = render(
    <LocaleProvider>
      <AccountVoiceCalls summary={summaryOf(state)} onChanged={onChanged} callId={id} />
    </LocaleProvider>,
  );
  return { requests, onChanged, view };
}

/** The saved locale applies on account pages only ("/" is English-only). */
function chinese() {
  localStorage.setItem("pc-locale", "zh");
  window.history.replaceState({}, "", `/account/voice/calls/${ID}`);
}

const meta = (container: HTMLElement) => {
  const list = container.querySelector("dl.portal-meta")!;
  const terms = [...list.querySelectorAll("dt")].map((dt) => dt.textContent);
  const values = [...list.querySelectorAll("dd")].map((dd) => dd.textContent);
  return Object.fromEntries(terms.map((term, index) => [term, values[index]]));
};
const links = (requests: Request[]) => requests.filter((request) => request.path.endsWith("/content-link"));
const mediaReads = (requests: Request[]) => requests.filter((request) => request.url.startsWith(MEDIA_ORIGIN));
const showContent = () => screen.getByRole("button", { name: "Show content" });

let created: string[];
let revoked: string[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  created = [];
  revoked = [];
  // jsdom has no object URLs.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      created.push(`blob:recording-${created.length + 1}-${blob.type}`);
      return created.at(-1);
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn((url: string) => revoked.push(url)) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("one call's page", () => {
  it("shows the call's facts and its estimated billing, and reads no content until asked", async () => {
    const { requests } = renderCall(oneCall());
    expect(screen.getByRole("heading", { level: 2, name: "Call details" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Loading calls…");
    const title = await screen.findByRole("heading", { level: 2, name: "Call on Dec 21, 2026 at 09:15" });
    const panel = title.closest("section")!;
    expect(screen.getByRole("link", { name: "← Calls" })).toHaveAttribute("href", "/account/voice/calls");
    expect(screen.getByText(/^Call ID a1b2c3d4/)).toHaveTextContent("Call ID a1b2c3d4 Give us this ID if you contact us");
    expect(meta(panel)).toEqual({
      Time: "Dec 21, 2026, 09:15:02 – 09:17:41",
      Length: "2m 39s",
      Caller: "Ends in 678 (mobile)",
      Entry: "Phone line",
      Result: "Answered",
      "Settings version": "Version 1",
      Billing: "Estimated 1 billable (AI answered and the caller spoke for 3 seconds or more)",
    });
    expect(screen.getByText("Transcript and summary can be viewed until Mar 21, 2027.")).toBeVisible();
    expect(screen.getByText("There is no recording for this call (because of your recording setting or the caller's request).")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Play recording" })).not.toBeInTheDocument();
    expect(showContent()).toBeEnabled();
    expect(screen.getByText("Did the AI get something wrong on this call? Flag it and we will review it.")).toBeVisible();
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([`GET /me/voice/calls/${ID}`]);
  });

  it("speaks Traditional Chinese", async () => {
    chinese();
    renderCall(oneCall({ recordingSaved: true }));
    const title = await screen.findByRole("heading", { level: 2, name: "2026 年 12 月 21 日 09:15 的來電" });
    expect(screen.getByText(/^通話編號 a1b2c3d4/)).toHaveTextContent("通話編號 a1b2c3d4 跟我們聯絡時請提供這個編號");
    expect(meta(title.closest("section")!)).toEqual({
      時間: "2026 年 12 月 21 日 09:15:02～09:17:41",
      長度: "2 分 39 秒",
      來電: "尾碼 678（手機）",
      入口: "市話",
      結果: "已回答",
      設定版本: "第 1 版",
      計費: "預估計 1 則（AI 接聽，客人說話滿 3 秒）",
    });
    expect(screen.getByRole("heading", { level: 3, name: "內容" })).toBeVisible();
    expect(screen.getByText("逐字稿與摘要可以查看到 2027 年 3 月 21 日。錄音可以查看到 2027 年 1 月 20 日。")).toBeVisible();
    expect(screen.getByRole("button", { name: "查看內容" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "播放錄音" })).toBeEnabled();
    expect(screen.getByText("AI 這通答錯了嗎？標記後我們會檢查並改進。")).toBeVisible();
    expect(screen.getByRole("button", { name: "標記「答錯了」" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "← 通話紀錄" })).toBeVisible();
  });

  it("names a test call, a hand-off, an urgent and a fallback call, and why a call is not billed", async () => {
    renderCall(
      oneCall({
        entry: "try", caller: { tail: null, kind: "unknown" }, endedAt: null, configVersion: null, meterUnits: 0, meterReason: "try",
        outcome: "handoff", handoff: true, handoffReason: "requested", urgent: true, degraded: true, hasMessage: true,
        callbackConfirmed: true,
      }),
    );
    const title = await screen.findByRole("heading", { level: 2, name: /^Call on Dec 21, 2026 at 09:15/ });
    expect(title).toHaveTextContent("Call on Dec 21, 2026 at 09:15 Test call Fallback Urgent");
    expect(meta(title.closest("section")!)).toMatchObject({
      Time: "Dec 21, 2026, 09:15:02",
      Length: "—",
      Caller: "Test call",
      Entry: "Test call",
      Result: "Handed off",
      "Settings version": "No AI settings used",
      Billing: "Not billed: Test calls are free",
    });
    for (const line of [
      "Handed off: the caller asked for a person",
      "Urgent words were heard on this call.",
      "The AI could not serve this call, so the caller was asked to leave a message.",
      "The caller left a message",
      "Left a callback number (confirmed)",
    ])
      expect(screen.getByText(line)).toBeVisible();
  });

  it("does not show another store's call, and does not ask for an id that is not one", async () => {
    const { requests } = renderCall(oneCall({ storeId: OTHER_STORE_ID }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This call does not exist or does not belong to your store.");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it("refuses a malformed id without a request", async () => {
    const { requests } = renderCall(oneCall(), "ABC");
    expect(await screen.findByRole("alert")).toHaveTextContent("This call does not exist or does not belong to your store.");
    expect(requests).toHaveLength(0);
  });
});

describe("call content", () => {
  it("says when nothing was kept, or when it is past its retention", async () => {
    renderCall(oneCall({ contentExpected: false }));
    expect(await screen.findByText("No content was kept for this call.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Show content" })).not.toBeInTheDocument();
  });

  it("says when the content is past its retention", async () => {
    renderCall(oneCall({ startedAt: NOW_S - 91 * DAY, endedAt: NOW_S - 91 * DAY + 60 }));
    expect(await screen.findByText("The content is past its retention period and can no longer be viewed.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Show content" })).not.toBeInTheDocument();
  });

  it("keeps the button off while viewing content is not open yet", async () => {
    const user = userEvent.setup();
    const { requests } = renderCall(oneCall({}, { mediaAvailable: false }));
    expect(await screen.findByText("Viewing call content is not available yet.")).toBeVisible();
    expect(showContent()).toBeDisabled();
    await user.click(showContent());
    expect(links(requests)).toHaveLength(0);
  });

  it("asks portal for a link, then reads the summary and transcript with the token in the header only", async () => {
    const user = userEvent.setup();
    const state = oneCall();
    const { requests } = renderCall(state);
    await user.click(await screen.findByRole("button", { name: "Show content" }));
    expect(await screen.findByRole("heading", { level: 4, name: "Transcript" })).toBeVisible();
    const [link] = links(requests);
    expect(link.method).toBe("POST");
    expect(link.body).toBe("{}");
    expect(link.headers.get("Content-Type")).toBe("application/json");
    expect(state.tokens.size).toBe(1);
    const [token] = [...state.tokens.keys()];
    const reads = mediaReads(requests);
    expect(reads.map((read) => read.url).sort()).toEqual([
      `${MEDIA_ORIGIN}/v1/calls/1797815702.100/summary`,
      `${MEDIA_ORIGIN}/v1/calls/1797815702.100/transcript`,
    ]);
    for (const read of reads) {
      expect(read.headers.get("Authorization")).toBe(`Bearer ${token}`);
      expect(read.url).not.toContain(token.slice(0, 20));
      expect(read.init).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store" });
    }
    // The heading names the summary once; its text follows, then the callback number and the message.
    const summary = screen.getByRole("heading", { level: 4, name: "Summary" }).nextElementSibling as HTMLElement;
    expect(summary.tagName).toBe("P");
    expect(summary.textContent).toBe("客人詢問洗牙價格。");
    const rest = summary.nextElementSibling as HTMLElement;
    expect([...rest.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["Callback number", "Message"]);
    expect([...rest.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual(["0912345678", "請回電確認時間"]);
    const lines = within(screen.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual(["AI 0:00 您好，這裡是晴光牙醫診所。", "Caller 0:03 請問洗牙多少錢？", "System 1:05 通話結束"]);
    // The token is never put on the page.
    expect(document.body.innerHTML).not.toContain(token.split(".")[1]);
  });

  it("names the speakers and the summary rows in Chinese", async () => {
    chinese();
    const user = userEvent.setup();
    renderCall(oneCall());
    await user.click(await screen.findByRole("button", { name: "查看內容" }));
    expect(await screen.findByRole("heading", { level: 4, name: "逐字稿" })).toBeVisible();
    const summary = screen.getByRole("heading", { level: 4, name: "摘要" }).nextElementSibling as HTMLElement;
    // Fix round: "摘要" is the heading only, not also the first row's label.
    expect(screen.getAllByText("摘要")).toHaveLength(1);
    expect([...(summary.nextElementSibling as HTMLElement).querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["回電號碼", "留言內容"]);
    expect(screen.getAllByRole("listitem").map((item) => item.querySelector("strong")?.textContent)).toEqual(["AI", "客人", "系統"]);
  });

  it("asks for a new link once when the Taiwan host says it expired", async () => {
    const user = userEvent.setup();
    const { requests } = renderCall(oneCall({}, { media: { transcript: ["token_expired"], summary: ["token_expired"] } }));
    await user.click(await screen.findByRole("button", { name: "Show content" }));
    expect(await screen.findByRole("heading", { level: 4, name: "Transcript" })).toBeVisible();
    expect(links(requests)).toHaveLength(2);
    expect(mediaReads(requests)).toHaveLength(4);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the link expired when the second one expires too", async () => {
    const user = userEvent.setup();
    const { requests } = renderCall(oneCall({}, { media: { transcript: ["token_expired", "token_expired"], summary: ["ok"] } }));
    await user.click(await screen.findByRole("button", { name: "Show content" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('The viewing link expired. Choose "Show content" again.');
    expect(links(requests)).toHaveLength(2);
    // What did load is still shown.
    expect(screen.getByRole("heading", { level: 4, name: "Summary" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 4, name: "Transcript" })).not.toBeInTheDocument();
  });

  it.each([
    ["not_ready", "The content is still being processed, usually within a few minutes after the call. Try again later."],
    ["forbidden", "The content could not be loaded. Reload and try again."],
    ["invalid", "The content could not be loaded. Reload and try again."],
    ["expired", "The content is past its retention period and can no longer be viewed."],
    ["not_found", "No content was kept for this call."],
    ["network", "The content cannot be loaded right now. Try again later."],
    ["down", "The content cannot be loaded right now. Try again later."],
  ] as const)("explains a Taiwan host answer %s once", async (answer, text) => {
    const user = userEvent.setup();
    renderCall(oneCall({}, { media: { transcript: [answer], summary: [answer] } }));
    await user.click(await screen.findByRole("button", { name: "Show content" }));
    // One line, even though both reads failed the same way.
    await waitFor(() => expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([text]));
    expect(showContent()).toBeEnabled();
  });

  it("explains the content link limit", async () => {
    const user = userEvent.setup();
    const { requests } = renderCall(oneCall({}, { linksUsed: 60 }));
    await user.click(await screen.findByRole("button", { name: "Show content" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many views. Try again in an hour.");
    expect(mediaReads(requests)).toHaveLength(0);
  });

  it("turns the button off when portal says viewing is not open (503)", async () => {
    const user = userEvent.setup();
    const state = oneCall();
    const { requests } = renderCall(state);
    await screen.findByRole("button", { name: "Show content" });
    state.mediaAvailable = false;
    await user.click(showContent());
    expect(await screen.findByText("Viewing call content is not available yet.")).toBeVisible();
    expect(showContent()).toBeDisabled();
    expect(mediaReads(requests)).toHaveLength(0);
  });

  it("shows the retention notice when the content expired after the page opened (410)", async () => {
    const user = userEvent.setup();
    const startedAt = NOW_S - 90 * DAY + 5;
    renderCall(oneCall({ startedAt, endedAt: startedAt + 60 }));
    await screen.findByRole("button", { name: "Show content" });
    vi.setSystemTime(new Date(NOW.getTime() + 10_000));
    await user.click(showContent());
    expect(await screen.findByText("The content is past its retention period and can no longer be viewed.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Show content" })).not.toBeInTheDocument();
  });

  it.each([
    ["an http URL off this machine", (media: Record<string, unknown>) => ({ media: { ...media, urls: { summary: "http://media.example.test/v1/calls/x/summary", transcript: "http://media.example.test/v1/calls/x/transcript" } } })],
    ["a URL with a query", (media: Record<string, unknown>) => ({ media: { ...media, urls: { summary: `${MEDIA_ORIGIN}/v1/calls/x/summary?t=1`, transcript: `${MEDIA_ORIGIN}/v1/calls/x/transcript` } } })],
    ["a URL for another kind", (media: Record<string, unknown>) => ({ media: { ...media, urls: { summary: `${MEDIA_ORIGIN}/v1/calls/x/transcript`, transcript: `${MEDIA_ORIGIN}/v1/calls/x/transcript` } } })],
    ["a token that is not two base64url parts", (media: Record<string, unknown>) => ({ media: { ...media, token: "abc" } })],
    ["no media at all", () => ({ ok: true })],
  ])("sends the token nowhere when M17 answers %s", async (_name, override) => {
    const user = userEvent.setup();
    const { requests } = renderCall(oneCall({}, { linkOverride: override }));
    await user.click(await screen.findByRole("button", { name: "Show content" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The content could not be loaded. Reload and try again.");
    expect(mediaReads(requests)).toHaveLength(0);
  });

  it("downloads the recording only when asked, reuses a fresh link, and frees it on leaving", async () => {
    const user = userEvent.setup();
    const { requests, view } = renderCall(oneCall({ recordingSaved: true }));
    expect(await screen.findByText("Transcript and summary can be viewed until Mar 21, 2027. The recording can be viewed until Jan 20, 2027.")).toBeVisible();
    expect(screen.queryByText(/There is no recording/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Play recording" }));
    const audio = await waitFor(() => {
      const element = document.querySelector<HTMLAudioElement>("audio[data-voice-recording]");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(audio).toHaveAttribute("src", "blob:recording-1-audio/wav");
    expect(audio).toHaveAttribute("controls");
    expect(mediaReads(requests).map((read) => read.url)).toEqual([`${MEDIA_ORIGIN}/v1/calls/1797815702.100/recording`]);
    // The same link (still valid for minutes) serves "Show content": portal is asked once.
    await user.click(showContent());
    await screen.findByRole("heading", { level: 4, name: "Transcript" });
    expect(links(requests)).toHaveLength(1);
    view.unmount();
    expect(revoked).toEqual(["blob:recording-1-audio/wav"]);
  });

  it("asks for a new link when the one it has is about to run out", async () => {
    const user = userEvent.setup();
    const { requests } = renderCall(oneCall({ recordingSaved: true }));
    await user.click(await screen.findByRole("button", { name: "Show content" }));
    await screen.findByRole("heading", { level: 4, name: "Transcript" });
    vi.setSystemTime(new Date(NOW.getTime() + 290_000));
    await user.click(screen.getByRole("button", { name: "Play recording" }));
    await waitFor(() => expect(document.querySelector("audio[data-voice-recording]")).not.toBeNull());
    expect(links(requests)).toHaveLength(2);
  });
});

describe("flag as wrong answer", () => {
  it("flags with a note, says when, and removes the flag; focus stays on the next control", async () => {
    const user = userEvent.setup();
    const state = oneCall();
    const { requests } = renderCall(state);
    const open = await screen.findByRole("button", { name: "Flag as wrong answer" });
    expect(state.rows[0].flag).toBeNull();
    await user.click(open);
    const dialog = screen.getByRole("dialog", { name: "Flag as wrong answer" });
    const input = within(dialog).getByRole("textbox", { name: "What was wrong? (optional, up to 100 characters)" });
    expect(document.activeElement).toBe(input);
    expect(within(dialog).getByText(/^Do not include the caller's phone number or name\./)).toHaveTextContent("0 / 100 characters");
    await user.type(input, "  問洗牙價格，AI 說的是去年的價錢 ");
    expect(within(dialog).getByText(/^Do not include/)).toHaveTextContent("17 / 100 characters");
    await user.click(within(dialog).getByRole("button", { name: "Flag" }));
    expect(await screen.findByText("You flagged this call as a wrong answer on Dec 21, 2026, 12:00.")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const post = requests.find((request) => request.method === "POST" && request.path.endsWith("/flag"))!;
    expect(JSON.parse(post.body!)).toEqual({ kind: "wrong_answer", note: "問洗牙價格，AI 說的是去年的價錢" });
    expect(state.rows[0].flag).toMatchObject({ kind: "wrong_answer", note: "問洗牙價格，AI 說的是去年的價錢" });
    expect(screen.getByText("問洗牙價格，AI 說的是去年的價錢")).toBeVisible();
    expect(screen.getByText("We have not reviewed this call yet.")).toBeVisible();
    const remove = screen.getByRole("button", { name: "Remove flag" });
    expect(document.activeElement).toBe(remove);
    await user.click(remove);
    expect(await screen.findByRole("button", { name: "Flag as wrong answer" })).toBe(document.activeElement);
    const removal = requests.find((request) => request.method === "DELETE")!;
    expect(removal.path).toBe(`/me/voice/calls/${ID}/flag`);
    expect(removal.body).toBeNull();
    expect(state.rows[0].flag).toBeNull();
  });

  it("speaks Traditional Chinese while flagging", async () => {
    chinese();
    const user = userEvent.setup();
    renderCall(oneCall({ flag: { kind: "wrong_answer", note: "", flaggedAt: NOW_S - 3600 }, reviewStatus: "done" }));
    expect(await screen.findByText("你在 2026 年 12 月 21 日 11:00 標記了「答錯了」。")).toBeVisible();
    expect(screen.getByText("我們已經檢查過這通。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "取消標記" }));
    await user.click(await screen.findByRole("button", { name: "標記「答錯了」" }));
    const dialog = screen.getByRole("dialog", { name: "標記「答錯了」" });
    expect(within(dialog).getByRole("textbox", { name: "哪裡答錯了？（選填，最多 100 字）" })).toBeVisible();
    expect(within(dialog).getByText(/^請不要寫客人的電話號碼或姓名。/)).toHaveTextContent("請不要寫客人的電話號碼或姓名。 0 / 100 字");
    expect(within(dialog).getByRole("button", { name: "送出" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeEnabled();
  });

  it.each([
    ["請回電 0912 345 678", "Do not put phone numbers in the note."],
    ["x".repeat(101), "The note can be up to 100 characters."],
    ["價格\u200b錯了", "The note contains a control or hidden character (such as a zero-width or direction-control character). Remove it and type it again."],
  ])("checks the note like the backend before sending (%s)", async (note, text) => {
    const user = userEvent.setup();
    const { requests } = renderCall(oneCall());
    await user.click(await screen.findByRole("button", { name: "Flag as wrong answer" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: note } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(text);
    expect(within(dialog).getByRole("button", { name: "Flag" })).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  it("counts a note in code points like the backend (100 emoji fit)", async () => {
    const user = userEvent.setup();
    const state = oneCall();
    renderCall(state);
    await user.click(await screen.findByRole("button", { name: "Flag as wrong answer" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "😀".repeat(100) } });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Flag" }));
    await screen.findByRole("button", { name: "Remove flag" });
    expect(state.rows[0].flag?.note).toBe("😀".repeat(100));
  });

  it("shows the backend's refusal in the dialog and re-reads the shell when the store was suspended meanwhile", async () => {
    const user = userEvent.setup();
    const state = oneCall();
    const { onChanged } = renderCall(state);
    await user.click(await screen.findByRole("button", { name: "Flag as wrong answer" }));
    state.storeStatus = "suspended";
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Flag" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "Phone agent is suspended for this store; it is read-only.",
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(state.rows[0].flag).toBeNull();
  });

  it("says a flag that did not go through was not sent, not that the calls did not load", async () => {
    const user = userEvent.setup();
    const state = oneCall();
    renderCall(state);
    await user.click(await screen.findByRole("button", { name: "Flag as wrong answer" }));
    const inner = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input).endsWith("/flag") ? Response.json({ error: "service_unavailable", detail: "down" }, { status: 502 }) : inner(input, init),
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Flag" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("The flag was not sent. Try again later.");
    expect(screen.queryByText("Calls could not be loaded. Reload the page.")).not.toBeInTheDocument();
    expect(state.rows[0].flag).toBeNull();
  });

  it("says a removal that did not go through in Chinese", async () => {
    chinese();
    const user = userEvent.setup();
    renderCall(oneCall({ flag: { kind: "wrong_answer", note: "", flaggedAt: NOW_S - 60 } }));
    const remove = await screen.findByRole("button", { name: "取消標記" });
    const inner = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input).endsWith("/flag") ? Promise.reject(new TypeError("Failed to fetch")) : inner(input, init),
    );
    await user.click(remove);
    expect(await screen.findByRole("alert")).toHaveTextContent("標記沒有取消，請稍後再試。");
  });

  it("asks about a wrong answer only where the AI took part, and keeps an earlier flag removable", async () => {
    // configVersion null: no AI settings were used (hung up during the notice, not answered, a message only).
    renderCall(oneCall({ configVersion: null, outcome: "hangup_early", meterUnits: 0, meterReason: "notice_hangup" }));
    expect(await screen.findByText("No AI settings used")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Flag as wrong answer" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Did the AI get something wrong/)).not.toBeInTheDocument();
    cleanup();
    renderCall(oneCall({ configVersion: null, flag: { kind: "wrong_answer", note: "", flaggedAt: NOW_S - 60 } }));
    expect(await screen.findByRole("button", { name: "Remove flag" })).toBeEnabled();
  });

  it("closes the dialog with Escape or Cancel and gives focus back", async () => {
    const user = userEvent.setup();
    renderCall(oneCall());
    const open = await screen.findByRole("button", { name: "Flag as wrong answer" });
    await user.click(open);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(open);
    await user.click(open);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(open);
  });

  it("lets a suspended store look at the call and its content but not flag it", async () => {
    const user = userEvent.setup();
    const { requests } = renderCall(oneCall({}, { storeStatus: "suspended" }));
    expect(await screen.findByText("Phone agent is suspended for this store; you cannot flag calls but can still view them.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Flag as wrong answer" })).toBeDisabled();
    await user.click(showContent());
    expect(await screen.findByRole("heading", { level: 4, name: "Transcript" })).toBeVisible();
    expect(links(requests)).toHaveLength(1);
  });

  it("asks a temporary password to be changed before content or flags", async () => {
    const { requests } = renderCall(oneCall({ recordingSaved: true }, { passwordChangeRequired: true }));
    expect(await screen.findByText(/^Change the temporary password we gave you under/)).toHaveTextContent(
      "Change the temporary password we gave you under Security before viewing content or flagging calls.",
    );
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/account/security");
    expect(showContent()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Play recording" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Flag as wrong answer" })).toBeDisabled();
    expect(requests).toHaveLength(1);
  });
});
