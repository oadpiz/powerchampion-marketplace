import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountPortal } from "../components/account-portal";
import type { VoiceSummary } from "../components/account-voice";
import { AccountVoiceTry, tryLink } from "../components/account-voice-try";
import { LocaleProvider } from "../components/locale-provider";

const customer = { id: "cust-1", email: "clinic@example.test", name: "Clinic", role: "customer" };
const STORE_ID = "a".repeat(32);
const TRY_URL = "http://localhost:8097/";
const limits = {
  storeNameChars: 40, greetingChars: 40, openingNonSpaceMax: 67, openingSecondsMax: 15, charsPerSecond: 4.5,
  questionChars: 100, variantChars: 50, variantsMax: 10, faqChars: 400, kbCharsMax: 6000, faqMax: 120,
  csvBodyBytes: 196608, hoursSegmentsPerDay: 4, closuresMax: 60, closureNoteChars: 40, maxMessageSecondsMin: 60,
  maxMessageSecondsMax: 180, retentionDaysMax: 90, retentionDaysMaxFull: 30, tryLimit: 20, tryWindowHours: 24,
  ticketTtlSeconds: 900,
};

/**
 * A contract-faithful stand-in for the BFF plus T4's M1 and M12 (contract §1.1, §3.1, §3.12, §7.1, §10 item 1).
 * M12 checks run in the contract's order and the count is checked and taken in one step, like the backend's write lock.
 */
type Backend = {
  used: number;
  limit: number;
  available: boolean;
  passwordChangeRequired: boolean;
  status: string;
  currentVersion: number | null;
  hasUnpublishedChanges: boolean;
  url: string;
  tickets: string[];
  /** Replaces the M12 answer (e.g. a malformed one) after all checks pass. */
  override?: () => unknown;
  /** Holds M12 open until the test releases it. */
  gate?: Promise<void>;
};
type Call = { method: string; path: string; contentType: string | null; body: string | null };

const b64u = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** §6.1 shape: B64U(payload) + "." + B64U(signature); the signature here is fake. */
function ticketFor(n: number, version: number) {
  const nonce = n.toString(16).padStart(32, "0");
  const payload = JSON.stringify({
    v: 1, purpose: "try", store_id: STORE_ID, config_version: version, iat: 1793491200 + n, exp: 1793492100 + n, nonce,
    config: { schema: "voice.store-config/v1", store_id: STORE_ID, version },
  });
  return `${b64u(payload)}.${b64u(`not-a-real-signature-${n}`)}`;
}

function backend(state: Partial<Backend> = {}): Backend {
  return {
    used: 3, limit: 20, available: true, passwordChangeRequired: false, status: "draft", currentVersion: 2,
    hasUnpublishedChanges: false, url: TRY_URL, tickets: [], ...state,
  };
}

/** GET /me/voice built from the backend's state (contract §3.1). */
function summaryOf(state: Backend): VoiceSummary {
  return {
    store: {
      id: STORE_ID, name: "晴光牙醫診所", industry: "clinic", templateId: "clinic", status: state.status,
      currentVersion: state.currentVersion, publishedAt: state.currentVersion === null ? null : "2026-11-01T02:00:00Z",
      hasUnpublishedChanges: state.hasUnpublishedChanges, faqCount: 12, kbChars: 2875, aiAnswerEnabled: false,
      updatedAt: "2026-11-01T01:58:00Z",
    },
    account: { passwordChangeRequired: state.passwordChangeRequired },
    try: {
      available: state.available, limit: state.limit, windowHours: 24, used: state.used,
      remaining: Math.max(0, state.limit - state.used), lastIssuedAt: state.used ? "2026-11-01T02:05:00Z" : null,
    },
    limits,
  };
}

const error = (status: number, code: string, detail = "Rejected.") => Response.json({ error: code, detail }, { status });

async function tryRoute(state: Backend, init: RequestInit | undefined): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!(headers.get("Content-Type") ?? "").startsWith("application/json")) return error(415, "invalid_input");
  let body: unknown;
  try {
    body = JSON.parse(String(init?.body ?? ""));
  } catch {
    return error(400, "invalid_input");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return error(400, "invalid_input");
  if (state.gate) await state.gate;
  if (state.passwordChangeRequired) return error(403, "password_change_required");
  if (state.status === "suspended") return error(409, "store_suspended");
  if (state.currentVersion === null) return error(409, "not_published");
  // The backend says voice_try_unavailable; the BFF rewrites every other 5xx code and detail (route.ts:151-165).
  if (!state.available) return error(503, "service_unavailable", "The account service is unavailable.");
  if (state.used >= state.limit) return error(429, "voice_try_limit");
  state.used += 1;
  if (state.override) return Response.json(state.override());
  const ticket = ticketFor(state.used, state.currentVersion);
  state.tickets.push(ticket);
  return Response.json({
    ticket, url: state.url, expiresAt: "2026-11-01T00:15:00Z", version: state.currentVersion,
    remaining: state.limit - state.used,
  });
}

function stubPortal(state: Backend) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("/api/portal", "");
      const method = init?.method ?? "GET";
      calls.push({ method, path, contentType: new Headers(init?.headers).get("Content-Type"), body: init?.body ? String(init.body) : null });
      if (method === "GET" && path === "/session") return Response.json({ user: customer });
      if (method === "GET" && path === "/me/voice") return Response.json(summaryOf(state));
      // The BFF only lets POST through for /me/voice/try (contract §7.1: GET is rejected).
      if (method === "POST" && path === "/me/voice/try") return tryRoute(state, init);
      return error(404, "not_found", "This portal endpoint is not available for this request.");
    }),
  );
  return calls;
}

const tryCalls = (calls: Call[]) => calls.filter((call) => call.path === "/me/voice/try");

function renderTry(state: Backend, onChanged = vi.fn()) {
  const calls = stubPortal(state);
  render(
    <LocaleProvider>
      <AccountVoiceTry summary={summaryOf(state)} onChanged={onChanged} />
    </LocaleProvider>,
  );
  return { calls, onChanged };
}

const button = (name: RegExp | string = "Try a call") => screen.getByRole("button", { name });
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // window.open with "noopener" always returns null.
  open = vi.fn(() => null);
  vi.stubGlobal("open", open);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("try a call: opening the test call", () => {
  it("issues a ticket with POST {} and opens it only in the URL fragment", async () => {
    const user = userEvent.setup();
    const state = backend();
    const { calls, onChanged } = renderTry(state);
    expect(screen.getByText("17 test calls left in the last 24 hours (limit 20)")).toBeVisible();
    await user.click(button());

    expect(await screen.findByText(/^The test call opened in a new tab \(valid for 15 minutes, one use\)\./)).toBeVisible();
    expect(tryCalls(calls)).toEqual([
      { method: "POST", path: "/me/voice/try", contentType: "application/json", body: "{}" },
    ]);
    const [ticket] = state.tickets;
    expect(open).toHaveBeenCalledTimes(1);
    const [opened, target, features] = open.mock.calls[0];
    expect([target, features]).toEqual(["_blank", "noopener"]);
    expect(opened).toBe(`${TRY_URL}#t=${ticket}`);
    // The ticket travels only after "#": never in the path or a query string.
    expect(opened).not.toContain("?");
    const [beforeHash, fragment] = String(opened).split("#");
    expect(beforeHash).toBe(TRY_URL);
    expect(beforeHash).not.toContain(ticket);
    expect(fragment).toBe(`t=${ticket}`);
    expect(new URL(String(opened)).search).toBe("");

    const fallback = screen.getByRole("link", { name: "No new tab? Start the test call here" });
    expect(fallback).toHaveAttribute("href", opened);
    expect(fallback).toHaveAttribute("target", "_blank");
    expect(fallback).toHaveAttribute("rel", "noopener noreferrer");
    // The ticket is a bearer credential: it is in the link target, not printed on the page.
    expect(document.body.textContent).not.toContain(ticket);

    expect(screen.getByText("16 test calls left in the last 24 hours (limit 20)")).toBeVisible();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(button()).toBeEnabled();
  });

  it("shows Working… while the ticket is issued and sends one request for a double click", async () => {
    let release = () => {};
    const state = backend({ gate: new Promise<void>((resolve) => (release = resolve)) });
    const { calls } = renderTry(state);
    const start = button();
    // Two clicks in one frame: the second arrives before React re-renders the button as disabled.
    act(() => {
      start.click();
      start.click();
    });
    expect(button("Working…")).toBeDisabled();
    await waitFor(() => expect(tryCalls(calls)).toHaveLength(1));
    await act(async () => release());
    expect(await screen.findByRole("link", { name: "No new tab? Start the test call here" })).toBeVisible();
    expect(tryCalls(calls)).toHaveLength(1);
    expect(state.used).toBe(4);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("issues a fresh ticket each time and replaces the fallback link", async () => {
    const user = userEvent.setup();
    const state = backend();
    renderTry(state);
    await user.click(button());
    await screen.findByRole("link", { name: /No new tab/ });
    await user.click(button());
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(state.tickets).toHaveLength(2);
    expect(state.tickets[0]).not.toBe(state.tickets[1]);
    expect(screen.getAllByRole("link", { name: /No new tab/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /No new tab/ })).toHaveAttribute("href", `${TRY_URL}#t=${state.tickets[1]}`);
    expect(screen.getByText("15 test calls left in the last 24 hours (limit 20)")).toBeVisible();
  });

  it("notes that test calls are free and not recorded", () => {
    renderTry(backend());
    expect(
      screen.getByText(
        "Test calls are free and not recorded. They always use AI answers so you can hear them; real calls use AI answers only after we turn them on.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/^Test calls use version 2 \(/)).toBeVisible();
    expect(screen.getByText(/The button opens a new tab\. Allow the microphone/)).toBeVisible();
  });
});

describe("try a call: before anything is applied", () => {
  it("disables the button and points to Setup", async () => {
    const state = backend({ currentVersion: null, hasUnpublishedChanges: true });
    const { calls } = renderTry(state);
    const note = screen.getByText(/^Nothing is applied yet\. Use "Save and apply" on/);
    expect(note).toHaveTextContent('Nothing is applied yet. Use "Save and apply" on Setup, then come back.');
    expect(within(note).getByRole("link", { name: "Setup" })).toHaveAttribute("href", "/account/voice/setup");
    expect(button()).toBeDisabled();
    // The button's click handler refuses too, not only the disabled attribute.
    act(() => button().click());
    expect(tryCalls(calls)).toHaveLength(0);
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Test calls use version/)).not.toBeInTheDocument();
    // The "unapplied changes" note needs an applied version to compare against.
    expect(screen.queryByText(/Some changes are not applied/)).not.toBeInTheDocument();
  });

  it("says which version a test call uses when there are unapplied changes", () => {
    renderTry(backend({ currentVersion: 4, hasUnpublishedChanges: true }));
    const note = screen.getByText(/^Some changes are not applied; test calls use version 4\./);
    expect(note).toHaveTextContent('Some changes are not applied; test calls use version 4. Use "Save and apply" on Setup to try them.');
    expect(within(note).getByRole("link", { name: "Setup" })).toHaveAttribute("href", "/account/voice/setup");
    expect(button()).toBeEnabled();
  });

  it("shows not_published from M12 when the summary was stale", async () => {
    const user = userEvent.setup();
    const state = backend();
    const { onChanged } = renderTry(state);
    state.currentVersion = null;
    await user.click(button());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent('Nothing is applied yet. Use "Save and apply" on Setup first.');
    expect(within(alert).getByRole("link", { name: "Setup" })).toHaveAttribute("href", "/account/voice/setup");
    expect(open).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe("try a call: limits and errors", () => {
  it("shows the daily limit copy on 429 and turns the button off", async () => {
    const user = userEvent.setup();
    // M1 said 5 left, but other tabs used them up: M12 answers 429 voice_try_limit.
    const state = backend({ used: 15 });
    const { onChanged } = renderTry(state);
    state.used = 20;
    await user.click(button());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have used all test calls for now (20 per 24 hours). Try again later.",
    );
    expect(screen.getByText("0 test calls left in the last 24 hours (limit 20)")).toBeVisible();
    expect(button()).toBeDisabled();
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /No new tab/ })).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("allows exactly 20 test calls in the window, then refuses", async () => {
    const user = userEvent.setup();
    const state = backend({ used: 0 });
    const calls = stubPortal(state);
    // Through the real shell: each success re-reads M1, which the backend computes from its own count.
    render(
      <LocaleProvider>
        <AccountPortal section="voice" voiceSub="try" />
      </LocaleProvider>,
    );
    expect(await screen.findByText("20 test calls left in the last 24 hours (limit 20)")).toBeVisible();
    for (let n = 1; n <= 20; n += 1) {
      await user.click(button());
      expect(await screen.findByText(`${20 - n} test calls left in the last 24 hours (limit 20)`)).toBeVisible();
      await waitFor(() => expect(button()).toHaveTextContent("Try a call"));
    }
    expect(open).toHaveBeenCalledTimes(20);
    expect(state.used).toBe(20);
    expect(new Set(state.tickets).size).toBe(20);
    expect(button()).toBeDisabled();
    expect(screen.getByText("You have used all test calls for now (20 per 24 hours). Try again later.")).toBeVisible();
    act(() => button().click());
    expect(tryCalls(calls)).toHaveLength(20);
    // The fallback link of the 20th call survives the shell's M1 refresh.
    expect(screen.getByRole("link", { name: /No new tab/ })).toHaveAttribute("href", `${TRY_URL}#t=${state.tickets[19]}`);
  });

  it("shows the unavailable copy on 503 and lets the merchant retry", async () => {
    const user = userEvent.setup();
    const state = backend();
    const { onChanged } = renderTry(state);
    state.available = false;
    await user.click(button());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Test calls are unavailable right now. Try again later or contact us.",
    );
    expect(open).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    // A 503 can be transient, so the button stays on.
    expect(button()).toBeEnabled();
    state.available = true;
    await user.click(button());
    expect(await screen.findByRole("link", { name: /No new tab/ })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("treats a network failure like the service being unavailable", async () => {
    const user = userEvent.setup();
    renderTry(backend());
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await user.click(button());
    expect(await screen.findByRole("alert")).toHaveTextContent("Test calls are unavailable right now.");
    expect(button()).toBeEnabled();
  });

  it.each([
    ["no tests are left", { used: 20 }, "You have used all test calls for now (20 per 24 hours). Try again later."],
    ["the try service is not configured", { available: false }, "Test calls are unavailable right now. Try again later or contact us."],
  ])("disables the button when M1 says %s", (_case, state, text) => {
    const { calls } = renderTry(backend(state));
    expect(screen.getByText(text)).toBeVisible();
    expect(button()).toBeDisabled();
    act(() => button().click());
    expect(tryCalls(calls)).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the button for a suspended store", () => {
    renderTry(backend({ status: "suspended" }));
    expect(button()).toBeDisabled();
  });

  it("does not tell a suspended store to apply changes it cannot apply", () => {
    // Verifier finding 2026-10-22: the page still said to use "Save and apply" while Setup was read-only.
    renderTry(backend({ status: "suspended", hasUnpublishedChanges: true }));
    expect(screen.getByText(/^Phone agent is suspended for this store: test calls and applying changes are paused\./)).toBeVisible();
    expect(screen.queryByText(/Save and apply/)).not.toBeInTheDocument();
  });

  it("sends the try even with a temporary password, and links Security on 403", async () => {
    const user = userEvent.setup();
    // The shell already warns; the page lets the backend decide, so a password changed in another tab is not blocked.
    const { onChanged } = renderTry(backend({ passwordChangeRequired: true }));
    expect(button()).toBeEnabled();
    await user.click(button());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Change the temporary password we gave you under Security before editing or trying a call.",
    );
    expect(within(alert).getByRole("link", { name: "Security" })).toHaveAttribute("href", "/account/security");
    expect(open).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows store_suspended from M12 when the summary was stale", async () => {
    const user = userEvent.setup();
    const state = backend();
    renderTry(state);
    state.status = "suspended";
    await user.click(button());
    expect(await screen.findByRole("alert")).toHaveTextContent("Phone agent is suspended for this store; it is read-only.");
  });

  it("falls back to the portal copy for codes the page does not know", async () => {
    const user = userEvent.setup();
    renderTry(backend());
    vi.stubGlobal("fetch", vi.fn(async () => error(401, "auth_required")));
    await user.click(button());
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to continue, or sign in again to renew your session.");
  });

  it.each([
    ["a javascript: URL", { url: "javascript:alert(1)//", ticket: "abc.def" }],
    ["a URL with a query string", { url: "http://localhost:8097/?x=1", ticket: "abc.def" }],
    ["a URL with a fragment", { url: "http://localhost:8097/#a", ticket: "abc.def" }],
    ["a ticket that is not two base64url parts", { url: TRY_URL, ticket: "abc.def?x" }],
    ["no ticket", { url: TRY_URL }],
  ])("refuses an M12 answer with %s", async (_case, answer) => {
    const user = userEvent.setup();
    renderTry(backend({ override: () => ({ expiresAt: "2026-11-01T00:15:00Z", version: 2, remaining: 16, ...answer }) }));
    await user.click(button());
    expect(await screen.findByRole("alert")).toHaveTextContent("Test calls are unavailable right now.");
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /No new tab/ })).not.toBeInTheDocument();
  });
});

describe("try a call: ticket lifetime", () => {
  it("replaces the fallback link when the ticket's 15 minutes are up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTry(backend());
    await user.click(button());
    expect(await screen.findByRole("link", { name: /No new tab/ })).toBeVisible();
    await act(async () => vi.advanceTimersByTime(890_000));
    expect(screen.getByRole("link", { name: /No new tab/ })).toBeVisible();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole("link", { name: /No new tab/ })).not.toBeInTheDocument();
    expect(screen.getByText('This test link has expired (15 minutes). Press "Try a call" again.')).toBeVisible();
    expect(button()).toBeEnabled();
  });

  it("does not follow an expired link when timers stalled (laptop asleep)", async () => {
    const user = userEvent.setup();
    renderTry(backend());
    await user.click(button());
    const link = await screen.findByRole("link", { name: /No new tab/ });
    // The clock jumps 15 minutes without the expiry timer having fired.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 900_000);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByText(/This test link has expired/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /No new tab/ })).not.toBeInTheDocument();
  });

  it("follows the link while it is valid", async () => {
    const user = userEvent.setup();
    renderTry(backend());
    await user.click(button());
    const link = await screen.findByRole("link", { name: /No new tab/ });
    let cancelledByPage: boolean | null = null;
    // Runs after React's handler (window is the last stop of the bubble); then stops jsdom's own navigation.
    window.addEventListener(
      "click",
      (event) => {
        cancelledByPage = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(cancelledByPage).toBe(false);
    expect(screen.getByRole("link", { name: /No new tab/ })).toBeVisible();
  });
});

describe("try a call in Chinese", () => {
  beforeEach(() => {
    localStorage.setItem("pc-locale", "zh");
    // "/" is an English-only page; the saved locale applies on account pages.
    window.history.replaceState({}, "", "/account/voice/try");
  });

  it("uses the contract's Chinese copy through a successful try", async () => {
    const user = userEvent.setup();
    renderTry(backend({ hasUnpublishedChanges: true }));
    expect(screen.getByRole("heading", { level: 2, name: "試打一通" })).toBeVisible();
    expect(screen.getByText("按下按鈕會開一個新分頁。請允許使用麥克風，直接對著電腦說話；聽到的是電話音質。")).toBeVisible();
    expect(screen.getByText(/^試打會用：第 2 版（/)).toBeVisible();
    expect(screen.getByText(/^有尚未套用的變更，試打會用第 2 版。要試新內容，請先到「/)).toHaveTextContent(
      "有尚未套用的變更，試打會用第 2 版。要試新內容，請先到「設定」按「儲存並套用」。",
    );
    expect(screen.getByText("24 小時內還可以試打 17 次（上限 20 次）")).toBeVisible();
    expect(
      screen.getByText("試打不計費、不留存錄音。試打一律會用 AI 回答，讓你先聽聽看；正式來電要等我們開啟「AI 回答」。"),
    ).toBeVisible();
    await user.click(button("試打一通"));
    expect(await screen.findByText(/^已開啟試打分頁（15 分鐘內有效，只能用一次）。/)).toBeVisible();
    expect(screen.getByRole("link", { name: "沒有出現新分頁？按這裡開始試打" })).toBeVisible();
    expect(screen.getByText("24 小時內還可以試打 16 次（上限 20 次）")).toBeVisible();
  });

  it.each([
    ["429", { used: 20 }, "今天的試打次數用完了（24 小時內最多 20 次），請稍後再試。"],
    ["503", { available: false }, "試打暫時無法使用，請稍後再試或聯絡我們。"],
    ["store_suspended", { status: "suspended" }, "這家店的電話客服已暫停，目前只能查看。"],
    ["password_change_required", { passwordChangeRequired: true }, "請先到「安全性」變更我們發給你的臨時密碼，再修改設定或試打。"],
    ["not_published", { currentVersion: null }, "還沒有套用任何版本。請先到「設定」按「儲存並套用」。"],
  ] as const)("shows the Chinese copy for %s", async (_code, change, text) => {
    const user = userEvent.setup();
    const state = backend();
    renderTry(state);
    Object.assign(state, change);
    await user.click(button("試打一通"));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("explains an unapplied store and the expired link in Chinese", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(
      <LocaleProvider>
        <AccountVoiceTry summary={summaryOf(backend({ currentVersion: null }))} onChanged={vi.fn()} />
      </LocaleProvider>,
    );
    expect(screen.getByText(/^還沒有套用任何版本。請先到「/)).toHaveTextContent("還沒有套用任何版本。請先到「設定」按「儲存並套用」，再回來試打。");
    expect(button("試打一通")).toBeDisabled();
    unmount();
    renderTry(backend());
    await user.click(button("試打一通"));
    await screen.findByRole("link", { name: "沒有出現新分頁？按這裡開始試打" });
    await act(async () => vi.advanceTimersByTime(900_000));
    expect(screen.getByText("這個試打連結已過期（15 分鐘）。請重新按「試打一通」。")).toBeVisible();
  });
});

describe("tryLink", () => {
  const ticket = ticketFor(1, 2);
  it("puts the ticket after #t= on an http(s) origin", () => {
    expect(tryLink(TRY_URL, ticket)).toBe(`${TRY_URL}#t=${ticket}`);
    expect(tryLink("https://try.example.test/", ticket)).toBe(`https://try.example.test/#t=${ticket}`);
  });

  it.each([
    ["javascript:", "javascript:alert(1)//", ticket],
    ["data:", "data:text/html,x", ticket],
    ["a query", "https://try.example.test/?a=1", ticket],
    ["a fragment", "https://try.example.test/#x", ticket],
    ["not a URL", "localhost:8097", ticket],
    ["base64 padding", TRY_URL, "abc=.def"],
    ["three parts", TRY_URL, "a.b.c"],
    ["one part", TRY_URL, "abcdef"],
    ["a space", TRY_URL, "ab c.def"],
    ["over 128 KiB", TRY_URL, `${"a".repeat(131_072)}.b`],
    ["a non-string ticket", TRY_URL, 42],
    ["a non-string url", null, ticket],
  ])("refuses %s", (_case, url, value) => {
    expect(tryLink(url, value)).toBeNull();
  });

  it("accepts a ticket of exactly 128 KiB", () => {
    const max = `${"a".repeat(131_070)}.b`;
    expect(max).toHaveLength(131_072);
    expect(tryLink(TRY_URL, max)).toBe(`${TRY_URL}#t=${max}`);
  });
});
