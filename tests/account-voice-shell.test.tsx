import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccountPage from "../app/account/[[...section]]/page";
import { AccountPortal } from "../components/account-portal";
import { AccountVoice, isVoiceSummary, useVoiceSummary } from "../components/account-voice";
import { LocaleProvider } from "../components/locale-provider";

const customer = { id: "cust-1", email: "clinic@example.test", name: "Clinic", role: "customer" };
const limits = {
  storeNameChars: 40, greetingChars: 40, openingNonSpaceMax: 67, openingSecondsMax: 15, charsPerSecond: 4.5,
  questionChars: 100, variantChars: 50, variantsMax: 10, faqChars: 400, kbCharsMax: 6000, faqMax: 120,
  csvBodyBytes: 196608, hoursSegmentsPerDay: 4, closuresMax: 60, closureNoteChars: 40, maxMessageSecondsMin: 60,
  maxMessageSecondsMax: 180, retentionDaysMax: 90, retentionDaysMaxFull: 30, tryLimit: 20, tryWindowHours: 24,
  ticketTtlSeconds: 900,
};
/** GET /me/voice as in contract §3.1. */
const summary = (store: Record<string, unknown> = {}, account: Record<string, unknown> = {}) => ({
  store: {
    id: "a".repeat(32), name: "晴光牙醫診所", industry: "clinic", templateId: "clinic", status: "draft",
    currentVersion: 2, publishedAt: "2026-11-01T02:00:00Z", hasUnpublishedChanges: false, faqCount: 12, kbChars: 2875,
    aiAnswerEnabled: false, updatedAt: "2026-11-01T01:58:00Z", ...store,
  },
  account: { passwordChangeRequired: false, ...account },
  try: { available: true, limit: 20, windowHours: 24, used: 3, remaining: 17, lastIssuedAt: "2026-11-01T02:05:00Z" },
  limits,
});
const overview = { user: customer, keyCount: 0, pendingCreditCount: 0, approvedCreditUsd: 0, gatewayConfigured: true };
const notFound = (error = "voice_store_not_found") => Response.json({ error, detail: "not here" }, { status: 404 });

type Call = { method: string; path: string };
/** "METHOD /path" routes; anything unknown is the backend's generic 404. */
function stubPortal(routes: Record<string, () => unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("/api/portal", "");
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      const route = routes[`${method} ${path}`];
      if (!route) return notFound("not_found");
      const value = route();
      return value instanceof Response ? value : Response.json(value);
    }),
  );
  return calls;
}
const wrap = (node: React.ReactNode) => render(<LocaleProvider>{node}</LocaleProvider>);
const navLabels = async () =>
  within(await screen.findByRole("navigation", { name: "Account navigation" }))
    .getAllByRole("link")
    .map((link) => link.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("account phone agent tab", () => {
  it.each([
    ["the account has no store", () => notFound()],
    ["the feature is off", () => notFound("not_found")],
    ["the service fails", () => Response.json({ error: "internal_error" }, { status: 500 })],
    ["the body is not a store summary", () => ({ keys: [] })],
  ])("is hidden when %s, without any alert on other pages", async (_case, voice) => {
    const calls = stubPortal({ "GET /session": () => ({ user: customer }), "GET /overview": () => overview, "GET /me/voice": voice });
    wrap(<AccountPortal section="overview" />);
    await waitFor(() => expect(calls.some((call) => call.path === "/me/voice")).toBe(true));
    await screen.findByText("API keys", { selector: "p" });
    expect(await navLabels()).toEqual(["Overview", "API keys", "Usage", "Credit requests", "Security"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("appears after Security and before SSH key when GET /me/voice answers 200", async () => {
    stubPortal({
      "GET /session": () => ({ user: customer }),
      "GET /overview": () => overview,
      "GET /me/voice": () => summary(),
      "GET /me/engineer": () => ({ username: "clinic", displayName: "clinic", active: true, nodes: [], key: null, keyPendingSync: false, keyUpdatedBy: null }),
    });
    wrap(<AccountPortal section="overview" />);
    const nav = await screen.findByRole("navigation", { name: "Account navigation" });
    await waitFor(() =>
      expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
        "Overview", "API keys", "Usage", "Credit requests", "Security", "Phone agent", "SSH key",
      ]),
    );
    expect(screen.getByRole("link", { name: "Phone agent" })).toHaveAttribute("href", "/account/voice");
  });

  it("is not requested before sign-in", async () => {
    const calls = stubPortal({ "GET /session": () => Response.json({ error: "auth_required" }, { status: 401 }) });
    wrap(<AccountPortal section="voice" voiceSub="faq" />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Faccount%2Fvoice%2Ffaq");
    expect(calls.map((call) => call.path)).toEqual(["/session"]);
  });

  it("uses the Chinese label", async () => {
    localStorage.setItem("pc-locale", "zh");
    // "/" is an English-only page; the saved locale applies on account pages.
    window.history.replaceState({}, "", "/account/voice");
    stubPortal({ "GET /session": () => ({ user: customer }), "GET /overview": () => overview, "GET /me/voice": () => summary() });
    wrap(<AccountPortal section="overview" />);
    const nav = await screen.findByRole("navigation", { name: "帳號導覽" });
    expect(await within(nav).findByRole("link", { name: "電話客服" })).toHaveAttribute("href", "/account/voice");
  });
});

describe("account phone agent shell", () => {
  it.each([
    [undefined, "Setup"],
    ["setup", "Setup"],
    ["faq", "FAQ"],
    ["try", "Try a call"],
  ] as const)("renders sub-page %s inside the shell", async (sub, title) => {
    const calls = stubPortal({ "GET /session": () => ({ user: customer }), "GET /me/voice": () => summary() });
    wrap(<AccountPortal section="voice" voiceSub={sub} />);
    expect(await screen.findByRole("heading", { level: 2, name: title })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Phone agent");
    expect(screen.getByRole("heading", { level: 2, name: /晴光牙醫診所/ })).toHaveTextContent("Draft");
    expect(screen.getByText(/^Applied: version 2 \(/)).toBeVisible();
    expect(screen.getByText("Under construction")).toBeVisible();
    const pages = screen.getByRole("navigation", { name: "Phone agent pages" });
    const links = within(pages).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Setup", "/account/voice/setup"],
      ["FAQ", "/account/voice/faq"],
      ["Try a call", "/account/voice/try"],
    ]);
    expect(within(pages).getByRole("link", { name: title })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "Account navigation" })).getByRole("link", { name: "Phone agent" }))
      .toHaveAttribute("aria-current", "page");
    // The shell reads only M1; the section load does not call a "/voice" list endpoint.
    expect(calls.map((call) => call.path).filter((path) => path !== "/me/engineer")).toEqual(["/session", "/me/voice"]);
  });

  it("explains a direct visit by an account without a store", async () => {
    stubPortal({ "GET /session": () => ({ user: customer }), "GET /me/voice": () => notFound() });
    wrap(<AccountPortal section="voice" voiceSub="try" />);
    expect(await screen.findByText(/Phone agent is not set up for this account\. We set up phone agent accounts/)).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Phone agent pages" })).not.toBeInTheDocument();
    expect(screen.queryByText("Under construction")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Phone agent" })).not.toBeInTheDocument();
  });

  it("shows a retry for a failed load", async () => {
    const user = userEvent.setup();
    const answers = [Response.json({ error: "service_unavailable" }, { status: 503 }), summary()];
    stubPortal({ "GET /session": () => ({ user: customer }), "GET /me/voice": () => answers.shift() });
    wrap(<AccountPortal section="voice" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Setup" })).toBeVisible();
  });

  it("shows the temporary-password, suspended and unapplied-changes reminders", async () => {
    stubPortal({
      "GET /session": () => ({ user: customer }),
      "GET /me/voice": () =>
        summary({ status: "suspended", currentVersion: null, publishedAt: null, hasUnpublishedChanges: true }, { passwordChangeRequired: true }),
    });
    wrap(<AccountPortal section="voice" voiceSub="setup" />);
    expect(await screen.findByText("No version applied yet")).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: /晴光牙醫診所/ })).toHaveTextContent("Suspended");
    expect(screen.getByText(/You have changes that are not applied yet/)).toBeVisible();
    expect(screen.getByText(/settings are read-only/)).toBeVisible();
    expect(screen.getByText(/Your current password was issued by us/)).toBeVisible();
    const security = screen.getAllByRole("link", { name: "Security" }).find((link) => link.closest("p"));
    expect(security).toHaveAttribute("href", "/account/security");
  });

  it("hides the reminders that do not apply", async () => {
    stubPortal({ "GET /session": () => ({ user: customer }), "GET /me/voice": () => summary({ status: "testing" }) });
    wrap(<AccountPortal section="voice" voiceSub="faq" />);
    expect(await screen.findByRole("heading", { level: 2, name: /晴光牙醫診所/ })).toHaveTextContent("Testing");
    expect(screen.queryByText(/not applied yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
    expect(screen.queryByText(/issued by us/)).not.toBeInTheDocument();
  });

  it("renders the Chinese shell", async () => {
    localStorage.setItem("pc-locale", "zh");
    // "/" is an English-only page; the saved locale applies on account pages.
    window.history.replaceState({}, "", "/account/voice");
    stubPortal({ "GET /session": () => ({ user: customer }), "GET /me/voice": () => summary() });
    wrap(<AccountPortal section="voice" voiceSub="try" />);
    expect(await screen.findByRole("heading", { level: 2, name: "試打一通" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("電話客服");
    expect(screen.getByText(/^目前套用：第 2 版（/)).toBeVisible();
    expect(screen.getByText("建置中")).toBeVisible();
    const pages = screen.getByRole("navigation", { name: "電話客服頁面" });
    expect(within(pages).getAllByRole("link").map((link) => link.textContent)).toEqual(["設定", "常見問答", "試打一通"]);
  });
});

/** A sub-page calls onChanged after a write; the shell re-reads M1 without unmounting it. */
function Harness() {
  const voice = useVoiceSummary("cust-1", 0);
  return (
    <>
      <button type="button" onClick={voice.reload}>refresh</button>
      <AccountVoice sub="faq" state={voice} onReload={voice.reload} />
    </>
  );
}

describe("phone agent summary refresh", () => {
  it("updates the shell in place and keeps the last summary when a refresh fails", async () => {
    const user = userEvent.setup();
    const answers: unknown[] = [summary(), summary({ currentVersion: 3, hasUnpublishedChanges: false }), Response.json({ error: "x" }, { status: 503 })];
    stubPortal({ "GET /me/voice": () => answers.shift() });
    wrap(<Harness />);
    expect(await screen.findByText(/^Applied: version 2 \(/)).toBeVisible();
    const page = screen.getByRole("heading", { level: 2, name: "FAQ" });
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(await screen.findByText(/^Applied: version 3 \(/)).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "FAQ" })).toBe(page);
    await user.click(screen.getByRole("button", { name: "refresh" }));
    await waitFor(() => expect(answers).toHaveLength(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByText(/^Applied: version 3 \(/)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts only a real M1 body", () => {
    expect(isVoiceSummary(summary())).toBe(true);
    expect(isVoiceSummary({ keys: [] })).toBe(false);
    expect(isVoiceSummary({ ...summary(), store: { name: "x" } })).toBe(false);
    expect(isVoiceSummary({ ...summary(), account: {} })).toBe(false);
    expect(isVoiceSummary(null)).toBe(false);
  });
});

describe("account voice routes", () => {
  it.each([[["voice"]], [["voice", "setup"]], [["voice", "faq"]], [["voice", "try"]]])("accepts /account/%s", async (section) => {
    const page = await AccountPage({ params: Promise.resolve({ section }) });
    expect(page.props.section).toBe("voice");
    expect(page.props.voiceSub).toBe(section[1]);
  });

  it.each([[["voice", "x"]], [["voice", "faqs"]], [["voice", "setup", "x"]], [["security", "setup"]], [["ssh-key", "faq"]], [["voices"]]])(
    "rejects /account/%s",
    async (section) => {
      await expect(AccountPage({ params: Promise.resolve({ section }) })).rejects.toThrow();
    },
  );
});
