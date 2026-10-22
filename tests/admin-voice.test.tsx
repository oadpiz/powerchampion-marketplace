import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPortal } from "../components/admin-portal";
import {
  STATUS_TARGETS,
  VOICE_CHANNELS,
  VOICE_INDUSTRIES,
  VOICE_NUMBER_PATTERN,
  VOICE_PURPOSES,
  VOICE_SIGN_IN_PATH,
  VOICE_STATUSES,
  voiceAdminErrorText,
} from "../components/admin-voice-dialogs";
import { PortalError, safeAccountReturn } from "../lib/portal-client";
import { adminFetch, customer, wrap, type Call } from "./support/admin-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

/** The locale provider keeps "/" in English, so Chinese tests sit on the admin path like the other admin tests. */
function speakChinese() {
  localStorage.setItem("pc-locale", "zh");
  window.history.replaceState({}, "", "/admin/voice");
}

/*
 * A small in-memory backend for A1-A8 that answers like phase1-contract §1.1, §4 and amendment A1 say T5 will:
 * the same validation order, status codes and error codes, the BFF allowlist (§7.1) in front of it, and a JSON
 * Content-Type required on every POST. The enum values are written out here from the contract on purpose (not
 * imported from the component), so a drift in the component makes these tests fail.
 */
const CONTRACT = {
  industries: ["clinic", "cram", "other"],
  statuses: ["draft", "testing", "live", "suspended"],
  purposes: ["customer", "demo", "test", "internal"],
  channels: ["online", "test_line", "pstn"],
  // §4.4, the ✓ cells (live is never a legal target in phase 1).
  transitions: { draft: ["testing", "suspended"], testing: ["draft", "suspended"], live: ["suspended"], suspended: ["testing"] } as Record<string, string[]>,
};
const BFF: Record<string, RegExp[]> = {
  GET: [/^\/admin\/voice\/(stores|numbers)$/, /^\/admin\/voice\/stores\/[a-f0-9]{32}$/],
  POST: [/^\/admin\/voice\/(stores|numbers)$/, /^\/admin\/voice\/stores\/[a-f0-9]{32}\/status$/, /^\/admin\/voice\/numbers\/[a-f0-9]{32}$/],
  DELETE: [/^\/admin\/voice\/numbers\/[a-f0-9]{32}$/],
};
const NOT_AVAILABLE = "This portal endpoint is not available for this request.";

type MockStore = {
  id: string;
  name: string;
  industry: string;
  status: string;
  owner: { id: string; email: string; name: string };
  currentVersion: number | null;
  faqCount: number;
  kbChars: number;
  lastTryAt: string | null;
  aiAnswerEnabled: boolean;
  recordingMode: string;
  createdAt: string;
  updatedAt: string;
  greeting: string;
  afterHoursMode: string;
  askCallback: string;
  maxMessageSeconds: number;
  retentionDays: number;
  hoursSegments: number;
  closures: number;
  versions: { version: number; configSha256: string; createdAt: string; createdBy: { id: string; email: string } }[];
  used24h: number;
};
type MockNumber = {
  id: string;
  number: string;
  storeId: string | null;
  purpose: string;
  channel: string;
  activeFrom: string;
  activeUntil: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

const hex = (n: number) => n.toString(16).padStart(32, "0");
const ID = { cram: "b".repeat(32), clinic: "a".repeat(32), old: "c".repeat(32), live: "d".repeat(32) };
const NUM = { main: "e".repeat(32), demo: "f".repeat(32) };

function mockStore(overrides: Partial<MockStore> & Pick<MockStore, "id" | "name">): MockStore {
  return {
    industry: "other",
    status: "draft",
    owner: { id: hex(9000 + overrides.id.charCodeAt(0)), email: `${overrides.id.slice(0, 4)}@example.com`, name: "Owner" },
    currentVersion: null,
    faqCount: 0,
    kbChars: 0,
    lastTryAt: null,
    aiAnswerEnabled: false,
    recordingMode: "message_only",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    greeting: "",
    afterHoursMode: "answer_and_message",
    askCallback: "auto",
    maxMessageSeconds: 120,
    retentionDays: 90,
    hoursSegments: 0,
    closures: 0,
    versions: [],
    used24h: 0,
    ...overrides,
  };
}

const seedStores = (): MockStore[] => [
  mockStore({
    id: ID.clinic,
    name: "晴光牙醫診所",
    industry: "clinic",
    status: "testing",
    owner: { id: hex(1), email: "owner@clinic.example", name: "林小姐" },
    currentVersion: 3,
    faqCount: 12,
    kbChars: 1500,
    lastTryAt: "2026-10-21T02:00:00Z",
    createdAt: "2026-10-20T00:00:00Z",
    greeting: "您好，這裡是晴光牙醫",
    hoursSegments: 9,
    closures: 1,
    used24h: 3,
    versions: [
      { version: 3, configSha256: "0123abcd" + "9".repeat(56), createdAt: "2026-10-21T01:00:00Z", createdBy: { id: hex(1), email: "owner@clinic.example" } },
      { version: 2, configSha256: "fedc4321" + "8".repeat(56), createdAt: "2026-10-20T05:00:00Z", createdBy: { id: hex(1), email: "owner@clinic.example" } },
    ],
  }),
  mockStore({
    id: ID.cram,
    name: "明日補習班",
    industry: "cram",
    status: "draft",
    owner: { id: hex(2), email: "hello@cram.example", name: "王老師" },
    aiAnswerEnabled: true,
    createdAt: "2026-10-21T00:00:00Z",
  }),
  mockStore({
    id: ID.old,
    name: "舊店",
    status: "suspended",
    owner: { id: hex(3), email: "old@shop.example", name: "陳先生" },
    createdAt: "2026-10-19T00:00:00Z",
  }),
];
const seedNumbers = (): MockNumber[] => [
  { id: NUM.main, number: "+886227356688", storeId: ID.clinic, purpose: "customer", channel: "pstn", activeFrom: "2026-11-01", activeUntil: null, note: "主線", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z" },
  { id: NUM.demo, number: "ext-0001", storeId: null, purpose: "demo", channel: "online", activeFrom: "2026-10-01", activeUntil: "2026-10-31", note: "", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
];

const fail = (status: number, error: string, detail = "The request was rejected.") => Response.json({ error, detail }, { status });
const isDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
// eslint-disable-next-line no-control-regex
const singleLine = (value: string) => !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069]/.test(value);

function voiceBackend(seed: { stores?: MockStore[]; numbers?: MockNumber[]; emails?: string[]; enabled?: boolean } = {}) {
  const state = {
    stores: seed.stores ?? [],
    numbers: seed.numbers ?? [],
    emails: new Set([...(seed.emails ?? []), ...(seed.stores ?? []).map((store) => store.owner.email)]),
    enabled: seed.enabled ?? true,
    serial: 100,
    passwords: [] as string[],
    /** When set, every write waits for it (to hold a request in flight). */
    gate: null as Promise<void> | null,
    /** When set, the next write is answered with this error instead (then it is cleared). */
    rejectWrite: null as { status: number; error: string; detail: string } | null,
  };
  const calls: Call[] = [];
  const now = () => new Date(Date.UTC(2026, 9, 22, 0, 0, state.serial++)).toISOString();
  const item = (store: MockStore) => ({
    id: store.id, name: store.name, industry: store.industry, status: store.status, owner: store.owner,
    currentVersion: store.currentVersion, faqCount: store.faqCount, kbChars: store.kbChars, lastTryAt: store.lastTryAt,
    aiAnswerEnabled: store.aiAnswerEnabled, recordingMode: store.recordingMode, createdAt: store.createdAt, updatedAt: store.updatedAt,
  });
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const numberView = (entry: MockNumber) => ({
    ...entry,
    storeName: state.stores.find((store) => store.id === entry.storeId)?.name ?? null,
    activeNow: entry.activeFrom <= today && (entry.activeUntil === null || today <= entry.activeUntil),
  });
  const sortedNumbers = () => [...state.numbers].sort((a, b) => a.number.localeCompare(b.number) || a.activeFrom.localeCompare(b.activeFrom));

  function saveNumber(body: Record<string, unknown>, existing: MockNumber | null): Response {
    const { number, storeId, purpose, channel, activeFrom, activeUntil, note } = body;
    if (typeof number !== "string" || !/^(?:\+[1-9][0-9]{6,14}|ext-[0-9]{4})$/.test(number))
      return fail(400, "invalid_number", "Use +E.164 or ext-NNNN.");
    if (storeId !== null && (typeof storeId !== "string" || !/^[a-f0-9]{32}$/.test(storeId))) return fail(400, "invalid_input", "storeId must be a store id or null.");
    if (storeId !== null && !state.stores.some((store) => store.id === storeId)) return fail(404, "voice_store_not_found", "That store does not exist.");
    if (typeof purpose !== "string" || !CONTRACT.purposes.includes(purpose)) return fail(400, "invalid_input", "Unknown purpose.");
    if (typeof channel !== "string" || !CONTRACT.channels.includes(channel)) return fail(400, "invalid_input", "Unknown channel.");
    if (!isDate(activeFrom)) return fail(400, "invalid_input", "activeFrom must be YYYY-MM-DD.");
    if (activeUntil !== null && (!isDate(activeUntil) || activeUntil < activeFrom)) return fail(400, "invalid_input", "activeUntil must be on or after activeFrom.");
    if (typeof note !== "string" || [...note.trim()].length > 80 || !singleLine(note)) return fail(400, "invalid_input", "note must be one line of up to 80 characters.");
    const clash = state.numbers.find(
      (other) =>
        other.id !== existing?.id &&
        other.number === number &&
        other.activeFrom <= (activeUntil ?? "9999-12-31") &&
        activeFrom <= (other.activeUntil ?? "9999-12-31"),
    );
    if (clash)
      return fail(409, "number_overlap", `${number} is already active from ${clash.activeFrom}${clash.activeUntil === null ? " (no end date)" : ` to ${clash.activeUntil}`}.`);
    const stamp = now();
    const saved: MockNumber = {
      id: existing?.id ?? hex(state.serial++),
      number, storeId: storeId as string | null, purpose, channel, activeFrom, activeUntil: activeUntil as string | null, note: note.trim(),
      createdAt: existing?.createdAt ?? stamp, updatedAt: stamp,
    };
    state.numbers = existing ? state.numbers.map((other) => (other.id === existing.id ? saved : other)) : [...state.numbers, saved];
    return Response.json({ number: numberView(saved) }, { status: existing ? 200 : 201 });
  }

  function route(method: string, path: string, raw: string | undefined, headers: Headers): Response {
    if (!(BFF[method] ?? []).some((pattern) => pattern.test(path))) return fail(404, "not_found", NOT_AVAILABLE);
    if (!state.enabled) return fail(404, "not_found", NOT_AVAILABLE);
    let body: Record<string, unknown> = {};
    if (method === "POST") {
      // support.body_json: no JSON content type is 415, anything but a JSON object is 400.
      if (headers.get("Content-Type") !== "application/json") return fail(415, "invalid_input", "Send a JSON object.");
      try {
        body = JSON.parse(raw ?? "");
      } catch {
        return fail(400, "invalid_input", "Send a JSON object.");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) return fail(400, "invalid_input", "Send a JSON object.");
    }
    const [, , , kind, id, action] = path.split("/");
    if (kind === "stores" && method === "GET" && !id)
      return Response.json({ stores: [...state.stores].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item) });
    if (kind === "stores" && method === "POST" && !id) {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "invalid_input", "Enter a valid email address.");
      const name = body.displayName;
      // eslint-disable-next-line no-control-regex
      if (typeof name !== "string" || !name.trim() || [...name.trim()].length > 100 || /[\u0000-\u001f]/.test(name)) return fail(400, "invalid_input", "Enter a name of 1 to 100 characters.");
      const storeName = typeof body.storeName === "string" ? body.storeName.trim() : "";
      const counted = [...storeName.replace(/[ \t\n\r\u3000]/g, "")].length;
      if (!singleLine(storeName) || counted < 1 || counted > 20 || [...storeName].length > 40)
        return fail(400, "invalid_input", "storeName must be 1 to 20 characters, not counting spaces.");
      if (typeof body.industry !== "string" || !CONTRACT.industries.includes(body.industry)) return fail(400, "invalid_input", "Unknown industry.");
      if (state.emails.has(email)) return fail(409, "account_exists", "An account with this email already exists.");
      const stamp = now();
      const store = mockStore({
        id: hex(state.serial++),
        name: storeName,
        industry: body.industry,
        status: "draft",
        owner: { id: hex(state.serial++), email, name: name.trim() },
        createdAt: stamp,
        updatedAt: stamp,
      });
      const password = `Tmp-${String(state.serial).padStart(4, "0")}-AbCdEfGhIjKlMnO`;
      state.passwords.push(password);
      state.emails.add(email);
      state.stores = [...state.stores, store];
      return Response.json({ store: item(store), account: { userId: store.owner.id, email }, temporaryPassword: password }, { status: 201 });
    }
    if (kind === "stores" && id) {
      const store = state.stores.find((candidate) => candidate.id === id);
      if (!store) return fail(404, "voice_store_not_found", "That store does not exist.");
      if (method === "GET")
        return Response.json({
          store: { ...item(store), greeting: store.greeting, afterHoursMode: store.afterHoursMode, askCallback: store.askCallback, maxMessageSeconds: store.maxMessageSeconds, retentionDays: store.retentionDays, hoursSegments: store.hoursSegments, closures: store.closures },
          versions: store.versions,
          numbers: sortedNumbers().filter((entry) => entry.storeId === store.id).map(numberView),
          try: { used24h: store.used24h, lastIssuedAt: store.lastTryAt },
        });
      if (action === "status") {
        const target = body.status;
        if (typeof target !== "string" || !CONTRACT.statuses.includes(target)) return fail(400, "invalid_input", "Unknown status.");
        if (target === store.status) return Response.json({ changed: false, store: item(store) });
        if (target === "live") return fail(409, "live_requires_g2a", "Live needs the G2a launch gate.");
        if (!CONTRACT.transitions[store.status].includes(target)) return fail(409, "invalid_transition", `Cannot change ${store.status} to ${target}.`);
        store.status = target;
        store.updatedAt = now();
        return Response.json({ changed: true, store: item(store) });
      }
    }
    if (kind === "numbers" && method === "GET" && !id) return Response.json({ numbers: sortedNumbers().map(numberView) });
    if (kind === "numbers" && method === "POST" && !id) return saveNumber(body, null);
    if (kind === "numbers" && id) {
      const existing = state.numbers.find((entry) => entry.id === id);
      if (!existing) return fail(404, "number_not_found", "That number does not exist.");
      if (method === "POST") return saveNumber(body, existing);
      state.numbers = state.numbers.filter((entry) => entry.id !== id);
      return Response.json({ ok: true });
    }
    return fail(404, "not_found", NOT_AVAILABLE);
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("/api/portal", "");
      const method = init?.method ?? "GET";
      const raw = init?.body ? String(init.body) : undefined;
      calls.push({ method, path, body: raw ? JSON.parse(raw) : undefined });
      if (path === "/session") return Response.json({ user: { ...customer, role: "admin" } });
      if (method !== "GET" && state.gate) await state.gate;
      if (method !== "GET" && state.rejectWrite) {
        const { status, error, detail } = state.rejectWrite;
        state.rejectWrite = null;
        return fail(status, error, detail);
      }
      return route(method, path, raw, new Headers(init?.headers));
    }),
  );
  return { state, calls };
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");
const cellTexts = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent);
const bodyRows = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
const numberOf = (row: HTMLElement) => row.querySelector("th code")?.textContent;

async function fillOpen(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  values: { email?: string; name?: string; store?: string; industry?: string } = {},
) {
  for (const [label, value] of [
    ["Sign-in email", values.email ?? "new@clinic.example"],
    ["Contact name", values.name ?? "陳醫師"],
    ["Store name", values.store ?? "新光診所"],
  ] as const) {
    const input = within(dialog).getByLabelText(label);
    await user.clear(input);
    if (value) await user.type(input, value);
  }
  await user.selectOptions(within(dialog).getByLabelText("Industry"), values.industry ?? "clinic");
}

async function openNumbersTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("tab", { name: "Numbers" }));
  return screen.findByRole("heading", { name: "Numbers", level: 2 });
}

describe("admin phone agent: stores", () => {
  it("lists stores newest first with the C2 columns and filters them on the page", async () => {
    const user = userEvent.setup();
    const { calls } = voiceBackend({ stores: seedStores() });
    wrap(<AdminPortal section="voice" />);
    const table = await screen.findByRole("table", { name: "Stores" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Store", "Account email", "Industry", "Status", "Version", "FAQs", "Last test call", "AI answers", "Actions",
    ]);
    let rows = bodyRows(table);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["明日補習班", "晴光牙醫診所", "舊店"]);
    // Narrow screens (verifier finding 2026-10-22, 375 px): every cell but the buttons is labelled for the card layout.
    expect(table).toHaveClass("voice-stack");
    expect(within(rows[0]).getAllByRole("cell").map((cell) => cell.getAttribute("data-label"))).toEqual([
      "Account email", "Industry", "Status", "Version", "FAQs", "Last test call", "AI answers", null,
    ]);
    expect(cellTexts(rows[0]).slice(0, 7)).toEqual(["hello@cram.example", "Cram school", "Draft", "Not applied", "0", "Never", "On"]);
    const clinic = cellTexts(rows[1]);
    expect(clinic.slice(0, 5)).toEqual(["owner@clinic.example", "Clinic", "Testing", "v3", "12"]);
    expect(clinic[5]).not.toBe("Never");
    expect(clinic[5]).toMatch(/2026/);
    expect(clinic[6]).toBe("Off");
    expect(cellTexts(rows[2]).slice(1, 3)).toEqual(["Other", "Suspended"]);
    expect(screen.getByText("Showing 3 of 3 stores")).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Status"), "suspended");
    rows = bodyRows(screen.getByRole("table", { name: "Stores" }));
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["舊店"]);
    expect(screen.getByText("Showing 1 of 3 stores")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Status"), "all");
    await user.selectOptions(screen.getByLabelText("Industry"), "cram");
    rows = bodyRows(screen.getByRole("table", { name: "Stores" }));
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["明日補習班"]);
    await user.selectOptions(screen.getByLabelText("Industry"), "all");
    await user.type(screen.getByLabelText("Search store or email"), "CLINIC.example");
    rows = bodyRows(screen.getByRole("table", { name: "Stores" }));
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["晴光牙醫診所"]);
    await user.clear(screen.getByLabelText("Search store or email"));
    await user.type(screen.getByLabelText("Search store or email"), "nobody");
    expect(screen.getByText("No stores match these filters.")).toBeVisible();
    expect(screen.queryByRole("table", { name: "Stores" })).not.toBeInTheDocument();
    // Filtering never goes back to the server: the contract routes take no query parameters.
    expect(calls.filter((call) => call.path.startsWith("/admin/voice")).map((call) => `${call.method} ${call.path}`)).toEqual(["GET /admin/voice/stores"]);
  });

  it("uses the Chinese copy from the contract", async () => {
    speakChinese();
    voiceBackend({ stores: seedStores() });
    wrap(<AdminPortal section="voice" />);
    const table = await screen.findByRole("table", { name: "店家" });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["店家", "號碼"]);
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "店名", "帳號 email", "產業", "狀態", "設定版本", "問答數", "最後試打", "AI 回答", "動作",
    ]);
    const rows = bodyRows(table);
    expect(cellTexts(rows[0]).slice(0, 7)).toEqual(["hello@cram.example", "補習班", "草稿", "未套用", "0", "沒有試打過", "開"]);
    expect(cellTexts(rows[1]).slice(0, 4)).toEqual(["owner@clinic.example", "診所", "測試中", "第 3 版"]);
    expect(cellTexts(rows[1])[6]).toBe("關");
    expect(cellTexts(rows[2]).slice(1, 3)).toEqual(["其他", "已停用"]);
    expect(screen.getByRole("button", { name: "開通店家" })).toBeVisible();
  });

  it("shows the empty state with the button that opens the first store", async () => {
    voiceBackend({});
    wrap(<AdminPortal section="voice" />);
    expect(await screen.findByText('No stores yet. Use "Open a store" to add the first one.')).toBeVisible();
    expect(screen.getByRole("button", { name: "Open a store" })).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says the feature is off when A1 answers 404 not_found, and nothing else is offered", async () => {
    const { calls } = voiceBackend({ stores: seedStores(), enabled: false });
    wrap(<AdminPortal section="voice" />);
    expect(await screen.findByText("The phone agent feature is off (PC_VOICE_ENABLED is not 1).")).toBeVisible();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open a store" })).not.toBeInTheDocument();
    expect(calls.map((call) => call.path)).toEqual(["/session", "/admin/voice/stores"]);
  });

  it("shows the access error when A1 answers 403 admin_required", async () => {
    adminFetch({ "GET /admin/voice/stores": Response.json({ error: "admin_required", detail: "Admin only." }, { status: 403 }) });
    wrap(<AdminPortal section="voice" />);
    expect(await screen.findByText("This account does not have administrator access.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Open a store" })).not.toBeInTheDocument();
  });
});

describe("admin phone agent: opening a store", () => {
  it("validates the form before sending, then shows the temporary password once", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const backend = voiceBackend({ stores: seedStores() });
    wrap(<AdminPortal section="voice" />);
    await user.click(await screen.findByRole("button", { name: "Open a store" }));
    const dialog = await screen.findByRole("dialog", { name: "Open a store" });
    expect(within(dialog).getByText(/signup does not verify email ownership/)).toBeVisible();

    const invalid: [Parameters<typeof fillOpen>[2], string][] = [
      [{ email: "not-an-email" }, "Enter a valid sign-in email."],
      [{ name: "" }, "Enter a contact name of 1 to 100 characters."],
      [{ store: "一二三四五六七八九十一二三四五六七八九十一" }, "Enter a store name of 1 to 20 characters (spaces not counted)."],
      [{ store: "晴光\u200b牙醫" }, "The store name contains a control or hidden character (such as a zero-width or direction-control character). Remove it and type it again."],
    ];
    for (const [values, message] of invalid) {
      await fillOpen(user, dialog, values);
      await user.click(within(dialog).getByRole("button", { name: "Open store" }));
      expect(within(dialog).getByRole("alert")).toHaveTextContent(message);
    }
    expect(writes(backend.calls)).toEqual([]);

    // 20 characters plus spaces is still within the limit: spaces are not counted (amendment A1).
    const longName = "一二三四五 六七八九十 一二三四五 六七八九十";
    await fillOpen(user, dialog, { email: "New@Clinic.example", name: "陳醫師", store: longName, industry: "cram" });
    expect(within(dialog).getByText("20 / 20 characters (spaces not counted)")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Open store" }));
    const opened = await screen.findByRole("dialog", { name: `"${longName}" is open` });
    expect(writes(backend.calls)).toEqual([
      { method: "POST", path: "/admin/voice/stores", body: { email: "New@Clinic.example", displayName: "陳醫師", storeName: longName, industry: "cram" } },
    ]);
    const password = backend.state.passwords[0];
    expect(password).toHaveLength(24);
    expect(within(opened).getByText(password)).toBeVisible();
    expect(within(opened).getByText(/^Sign-in email: new@clinic\.example\. The temporary password below is shown only once/)).toBeVisible();
    expect(within(opened).getByText(/Give it to the store privately/)).toBeVisible();
    // Verifier finding 2026-10-22: the store needs an address that leads to the phone agent, not the overview.
    const signIn = `${window.location.origin}/login?next=/account/voice`;
    expect(within(opened).getByText(signIn)).toBeVisible();
    expect(safeAccountReturn(new URL(VOICE_SIGN_IN_PATH, "https://portal.example").searchParams.get("next"))).toBe("/account/voice");
    expect(within(opened).getByText(/language switch at the top right changes it to 繁中/)).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: `"${longName}" is open` })).toBeVisible();
    await user.click(within(opened).getByRole("button", { name: "Copy password" }));
    expect(writeText).toHaveBeenCalledWith(password);
    expect(within(opened).getByRole("button", { name: "Copied" })).toBeVisible();
    await user.click(within(opened).getByRole("button", { name: "Copy sign-in address" }));
    expect(writeText).toHaveBeenLastCalledWith(signIn);
    expect(within(opened).getByRole("button", { name: "Address copied" })).toBeVisible();
    await user.click(within(opened).getByRole("button", { name: "I have given it to the store" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Focus returns to the button that started it, not to <body>.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open a store" })));

    const table = await screen.findByRole("table", { name: "Stores" });
    const newest = bodyRows(table)[0];
    expect(within(newest).getByRole("rowheader")).toHaveTextContent(longName);
    expect(cellTexts(newest).slice(0, 4)).toEqual(["new@clinic.example", "Cram school", "Draft", "Not applied"]);
    expect(document.body.textContent).not.toContain(password);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("explains 409 account_exists and keeps the form open without a password", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: seedStores(), emails: ["taken@example.com"] });
    wrap(<AdminPortal section="voice" />);
    await user.click(await screen.findByRole("button", { name: "Open a store" }));
    const dialog = await screen.findByRole("dialog", { name: "Open a store" });
    // The backend normalises the email, so a different case is still the same account.
    await fillOpen(user, dialog, { email: "TAKEN@example.com" });
    await user.click(within(dialog).getByRole("button", { name: "Open store" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This email already has an account and will not be linked. Use another email or look into that account first.",
    );
    expect(screen.getByRole("dialog", { name: "Open a store" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: /is open/ })).not.toBeInTheDocument();
    expect(backend.state.passwords).toEqual([]);
    expect(within(dialog).getByRole("button", { name: "Open store" })).toBeEnabled();
  });

  it("shows the backend's reason when it still answers 400 invalid_input", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: [] });
    // The backend is the authority (for example if it counts the store name differently from amendment A1).
    backend.state.rejectWrite = { status: 400, error: "invalid_input", detail: "storeName must be 1 to 20 characters." };
    wrap(<AdminPortal section="voice" />);
    await user.click(await screen.findByRole("button", { name: "Open a store" }));
    const dialog = await screen.findByRole("dialog", { name: "Open a store" });
    await fillOpen(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "Open store" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Check that the fields meet the requirements, then try again. (storeName must be 1 to 20 characters.)",
    );
    expect(writes(backend.calls)).toHaveLength(1);
    expect(backend.state.stores).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Open store" }));
    expect(await screen.findByRole("dialog", { name: '"新光診所" is open' })).toBeVisible();
  });

  it("sends one request when Open store is pressed twice, and shows Working… meanwhile", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: [] });
    let release = () => {};
    backend.state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    wrap(<AdminPortal section="voice" />);
    await user.click(await screen.findByRole("button", { name: "Open a store" }));
    const dialog = await screen.findByRole("dialog", { name: "Open a store" });
    await fillOpen(user, dialog);
    const form = dialog.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await within(dialog).findByRole("button", { name: "Working…" })).toBeDisabled();
    fireEvent.submit(form);
    release();
    await screen.findByRole("dialog", { name: '"新光診所" is open' });
    expect(writes(backend.calls)).toHaveLength(1);
    expect(backend.state.stores).toHaveLength(1);
  });
});

describe("admin phone agent: store status and details", () => {
  it("offers exactly the contract's allowed targets and never Live", async () => {
    const user = userEvent.setup();
    const stores = [...seedStores(), mockStore({ id: ID.live, name: "上線店", status: "live", createdAt: "2026-09-01T00:00:00Z" })];
    const backend = voiceBackend({ stores });
    wrap(<AdminPortal section="voice" />);
    await screen.findByRole("table", { name: "Stores" });
    for (const store of stores) {
      await user.click(screen.getByRole("button", { name: `Change status of ${store.name}` }));
      const dialog = await screen.findByRole("dialog", { name: `Change status: ${store.name}` });
      const options = within(dialog).getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
      expect(options, store.status).toEqual(CONTRACT.transitions[store.status]);
      expect(options).not.toContain("live");
      expect(within(dialog).getByText("Live is not allowed in phase 1; it needs the G2a launch gate.")).toBeVisible();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    }
    expect(writes(backend.calls)).toEqual([]);
  });

  it("asks before changing a status, then refreshes the list", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: seedStores() });
    wrap(<AdminPortal section="voice" />);
    await user.click(await screen.findByRole("button", { name: "Change status of 晴光牙醫診所" }));
    const dialog = await screen.findByRole("dialog", { name: "Change status: 晴光牙醫診所" });
    expect(within(dialog).getByText('Change "晴光牙醫診所" to "Draft"?')).toBeVisible();
    expect(within(dialog).queryByText(/When suspended/)).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("New status"), "suspended");
    expect(within(dialog).getByText('Change "晴光牙醫診所" to "Suspended"?')).toBeVisible();
    expect(within(dialog).getByText("When suspended, the store can only view its settings; it cannot edit or try calls.")).toBeVisible();
    expect(writes(backend.calls)).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Change status" }));
    expect(await screen.findByText('"晴光牙醫診所" is now "Suspended".')).toBeVisible();
    expect(writes(backend.calls)).toEqual([{ method: "POST", path: `/admin/voice/stores/${ID.clinic}/status`, body: { status: "suspended" } }]);
    const row = bodyRows(await screen.findByRole("table", { name: "Stores" }))[1];
    expect(cellTexts(row)[2]).toBe("Suspended");
  });

  it("explains 409 invalid_transition when another change got there first", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: seedStores() });
    wrap(<AdminPortal section="voice" />);
    await user.click(await screen.findByRole("button", { name: "Change status of 晴光牙醫診所" }));
    const dialog = await screen.findByRole("dialog", { name: "Change status: 晴光牙醫診所" });
    // Someone else suspended the store after this page loaded; suspended → draft is not allowed.
    backend.state.stores.find((store) => store.id === ID.clinic)!.status = "suspended";
    await user.click(within(dialog).getByRole("button", { name: "Change status" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This status change is not allowed.");
    expect(within(dialog).getByRole("button", { name: "Change status" })).toBeEnabled();
  });

  it("shows details: settings, version history and numbers (A3)", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: seedStores(), numbers: seedNumbers() });
    wrap(<AdminPortal section="voice" />);
    await user.click(await screen.findByRole("button", { name: "Details for 晴光牙醫診所" }));
    const panel = await screen.findByRole("region", { name: "晴光牙醫診所" });
    expect(within(panel).getByRole("heading", { name: "晴光牙醫診所" })).toHaveFocus();
    expect(await within(panel).findByText("您好，這裡是晴光牙醫")).toBeVisible();
    expect(backend.calls.some((call) => call.method === "GET" && call.path === `/admin/voice/stores/${ID.clinic}`)).toBe(true);
    const items = within(panel).getAllByRole("listitem").map((entry) => entry.textContent);
    expect(items[0]).toMatch(/^v3 · .*2026.* · owner@clinic\.example · sha 0123abcd$/);
    expect(items[1]).toMatch(/^v2 · .* · sha fedc4321$/);
    expect(items[2]).toBe("+886227356688 · Customer line · PSTN · 2026-11-01 – Ongoing");
    const pairs = Object.fromEntries([...panel.querySelectorAll("dt")].map((term) => [term.textContent, term.nextElementSibling?.textContent]));
    expect(pairs).toMatchObject({
      "Account email": "owner@clinic.example",
      Contact: "林小姐",
      "Knowledge base characters": "1,500",
      "Business hour segments": "9",
      "Special closures": "1",
      "Test calls in the last 24 hours": "3",
      Recording: "Record messages only",
      Retention: "90 days",
    });
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "晴光牙醫診所" })).not.toBeInTheDocument();
  });

  it("says when the store is gone (404 voice_store_not_found)", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: seedStores() });
    wrap(<AdminPortal section="voice" />);
    await screen.findByRole("table", { name: "Stores" });
    backend.state.stores = backend.state.stores.filter((store) => store.id !== ID.old);
    await user.click(screen.getByRole("button", { name: "Details for 舊店" }));
    const panel = await screen.findByRole("region", { name: "舊店" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent("This store was not found; it may no longer exist. Reload the page.");
  });
});

describe("admin phone agent: numbers", () => {
  it("lists numbers with the contract columns and marks the ones active today", async () => {
    const user = userEvent.setup();
    const always: MockNumber = { ...seedNumbers()[1], id: hex(7001), number: "ext-0002", activeFrom: "2000-01-01", activeUntil: null };
    const ended: MockNumber = { ...seedNumbers()[1], id: hex(7002), number: "ext-0003", activeFrom: "2000-01-01", activeUntil: "2000-12-31" };
    voiceBackend({ stores: seedStores(), numbers: [...seedNumbers(), always, ended] });
    wrap(<AdminPortal section="voice" />);
    await openNumbersTab(user);
    const table = await screen.findByRole("table", { name: "Numbers" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Number", "Store", "Purpose", "Channel", "From", "Until", "Note", "Actions",
    ]);
    const rows = bodyRows(table);
    expect(table).toHaveClass("voice-stack");
    expect(within(rows[0]).getAllByRole("cell").map((cell) => cell.getAttribute("data-label"))).toEqual([
      "Store", "Purpose", "Channel", "From", "Until", "Note", null,
    ]);
    expect(numberOf(rows[0])).toBe("+886227356688");
    expect(cellTexts(rows[0]).slice(0, 6)).toEqual(["晴光牙醫診所", "Customer line", "PSTN", "2026-11-01", "Ongoing", "主線"]);
    expect(numberOf(rows[1])).toBe("ext-0001");
    expect(cellTexts(rows[1]).slice(0, 6)).toEqual(["No store", "Demo", "Online", "2026-10-01", "2026-10-31", "—"]);
    expect(within(rows[2]).getByRole("rowheader")).toHaveTextContent("ext-0002 Active now");
    expect(within(rows[3]).getByRole("rowheader").textContent).toBe("ext-0003");
  });

  it("shows the empty number table in Chinese", async () => {
    speakChinese();
    const user = userEvent.setup();
    voiceBackend({ stores: seedStores() });
    wrap(<AdminPortal section="voice" />);
    await user.click(await screen.findByRole("tab", { name: "號碼" }));
    expect(await screen.findByText("還沒有號碼。這張表是之後產生邊緣主機設定與號碼對照的唯一來源。")).toBeVisible();
    expect(screen.getByRole("button", { name: "新增號碼" })).toBeVisible();
  });

  it("moves between the tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    voiceBackend({ stores: seedStores() });
    wrap(<AdminPortal section="voice" />);
    const stores = await screen.findByRole("tab", { name: "Stores" });
    expect(stores).toHaveAttribute("aria-selected", "true");
    stores.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Numbers" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Numbers" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tabpanel", { name: "Numbers" })).toBeVisible();
  });

  it("validates a number before sending, shows 409 number_overlap, then adds it", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: seedStores(), numbers: seedNumbers() });
    wrap(<AdminPortal section="voice" />);
    await openNumbersTab(user);
    await user.click(await screen.findByRole("button", { name: "Add a number" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a number" });
    const number = within(dialog).getByLabelText("Number");
    for (const bad of ["0227356688", "+0886227356688", "+123456", "+1234567890123456", "ext-001", "EXT-0001", "ext-00012"]) {
      await user.clear(number);
      await user.type(number, bad);
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(within(dialog).getByRole("alert"), bad).toHaveTextContent("Use international format (e.g. +886227356688) or extension ext-0001.");
    }
    await user.clear(number);
    await user.type(number, "+886 2 2735 6688");
    fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-12-01" } });
    fireEvent.change(within(dialog).getByLabelText("Until"), { target: { value: "2026-11-30" } });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The end date cannot be before the start date.");
    expect(writes(backend.calls)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText("Until"), { target: { value: "" } });
    await user.selectOptions(within(dialog).getByLabelText("Store"), "晴光牙醫診所");
    await user.selectOptions(within(dialog).getByLabelText("Purpose"), "customer");
    await user.selectOptions(within(dialog).getByLabelText("Channel"), "pstn");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This number already has an active entry in this period; change that entry's end date first. (+886227356688 is already active from 2026-11-01 (no end date).)",
    );
    expect(writes(backend.calls)).toEqual([
      {
        method: "POST",
        path: "/admin/voice/numbers",
        body: { number: "+886227356688", storeId: ID.clinic, purpose: "customer", channel: "pstn", activeFrom: "2026-12-01", activeUntil: null, note: "" },
      },
    ]);

    await user.clear(number);
    await user.type(number, "+886287654321");
    await user.type(within(dialog).getByLabelText("Note"), "第二線");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Saved number +886287654321.")).toBeVisible();
    const added = bodyRows(await screen.findByRole("table", { name: "Numbers" })).find((row) => numberOf(row) === "+886287654321");
    expect(added && cellTexts(added).slice(0, 6)).toEqual(["晴光牙醫診所", "Customer line", "PSTN", "2026-12-01", "Ongoing", "第二線"]);
  });

  it("edits a number by sending the whole entry (A7)", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: seedStores(), numbers: seedNumbers() });
    wrap(<AdminPortal section="voice" />);
    await openNumbersTab(user);
    await user.click(await screen.findByRole("button", { name: "Edit ext-0001 (2026-10-01)" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit number ext-0001" });
    expect(within(dialog).getByLabelText("Number")).toHaveValue("ext-0001");
    expect(within(dialog).getByLabelText("From")).toHaveValue("2026-10-01");
    expect(within(dialog).getByLabelText("Until")).toHaveValue("2026-10-31");
    fireEvent.change(within(dialog).getByLabelText("Until"), { target: { value: "" } });
    await user.type(within(dialog).getByLabelText("Note"), "展示用");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes(backend.calls)).toEqual([
      {
        method: "POST",
        path: `/admin/voice/numbers/${NUM.demo}`,
        body: { number: "ext-0001", storeId: null, purpose: "demo", channel: "online", activeFrom: "2026-10-01", activeUntil: null, note: "展示用" },
      },
    ]);
    const row = bodyRows(await screen.findByRole("table", { name: "Numbers" }))[1];
    expect(cellTexts(row).slice(3, 6)).toEqual(["2026-10-01", "Ongoing", "展示用"]);
  });

  it("deletes a number only after confirming (A8)", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: seedStores(), numbers: seedNumbers() });
    wrap(<AdminPortal section="voice" />);
    await openNumbersTab(user);
    await user.click(await screen.findByRole("button", { name: "Delete +886227356688 (2026-11-01)" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete number +886227356688?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(writes(backend.calls)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Delete +886227356688 (2026-11-01)" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Delete number +886227356688?" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deleted number +886227356688.")).toBeVisible();
    expect(writes(backend.calls)).toEqual([{ method: "DELETE", path: `/admin/voice/numbers/${NUM.main}`, body: undefined }]);
    const rows = bodyRows(await screen.findByRole("table", { name: "Numbers" }));
    expect(rows.map(numberOf)).toEqual(["ext-0001"]);
  });

  it("says when a number was removed elsewhere (404 number_not_found) and reloads the list", async () => {
    const user = userEvent.setup();
    const backend = voiceBackend({ stores: seedStores(), numbers: seedNumbers() });
    wrap(<AdminPortal section="voice" />);
    await openNumbersTab(user);
    await screen.findByRole("table", { name: "Numbers" });
    backend.state.numbers = backend.state.numbers.filter((entry) => entry.id !== NUM.demo);
    await user.click(screen.getByRole("button", { name: "Delete ext-0001 (2026-10-01)" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete number ext-0001?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This number no longer exists. Reload the page.");
    await waitFor(() => expect(backend.calls.filter((call) => call.path === "/admin/voice/numbers")).toHaveLength(2));
  });
});

describe("admin phone agent: error copy (phase1-contract §9)", () => {
  const text = (status: number, code: string, detail: string, locale: "en" | "zh" = "en") => voiceAdminErrorText(new PortalError(status, code, detail), locale);

  it("maps each operator error code to its own message", () => {
    expect(text(409, "live_requires_g2a", "x")).toBe("Live is not allowed in phase 1; it needs the G2a launch gate.");
    expect(text(409, "live_requires_g2a", "x", "zh")).toBe("第 1 期不能改成「已上線」，要等上線門檻（G2a）通過。");
    expect(text(409, "account_exists", "x", "zh")).toBe("這個 email 已經有帳號，基於安全不會連結。請改用另一個 email，或先查明那個帳號。");
    expect(text(409, "invalid_transition", "x", "zh")).toBe("不能從目前的狀態改成這個狀態。");
    expect(text(400, "invalid_number", "x", "zh")).toBe("號碼要用國際格式（例如 +886227356688）或分機 ext-0001。");
    expect(text(409, "number_overlap", "+886227356688 is already active from 2026-11-01 (no end date).", "zh")).toBe(
      "這個號碼在這段期間已經有一筆有效紀錄，請先調整那一筆的迄日。（+886227356688 is already active from 2026-11-01 (no end date).）",
    );
    expect(text(404, "number_not_found", "x", "zh")).toBe("這筆號碼已經不存在，請重新整理。");
    expect(text(404, "not_found", "x", "zh")).toBe("電話客服功能未開啟（PC_VOICE_ENABLED 不是 1）。");
    expect(text(413, "invalid_input", "Body too large.")).toBe("The content is too large.");
    expect(text(400, "invalid_input", "Unknown purpose.")).toBe("Check that the fields meet the requirements, then try again. (Unknown purpose.)");
    expect(text(502, "service_unavailable", "x")).toBe("This service is unavailable or has not been configured yet. Try again later or contact support.");
  });
});

describe("admin phone agent: values shared with the backend", () => {
  const samples = ["+886227356688", "+1234567", "+123456", "+123456789012345", "+1234567890123456", "+0886227356688", "886227356688", "ext-0001", "ext-001", "ext-00012", "EXT-0001", "+886 227356688", ""];

  it("uses the contract's values (phase1-contract §4)", () => {
    expect([...VOICE_INDUSTRIES]).toEqual(CONTRACT.industries);
    expect([...VOICE_STATUSES]).toEqual(CONTRACT.statuses);
    expect([...VOICE_PURPOSES]).toEqual(CONTRACT.purposes);
    expect([...VOICE_CHANNELS]).toEqual(CONTRACT.channels);
    expect(STATUS_TARGETS).toEqual(CONTRACT.transitions);
    expect(samples.filter((sample) => VOICE_NUMBER_PATTERN.test(sample))).toEqual(["+886227356688", "+1234567", "+123456789012345", "ext-0001"]);
  });

  // The backend file is not on the T10 branch; after the frontend and backend branches are merged it is, and this
  // runs. VOICE_STORE_PY points it at another checkout (e.g. the backend worktree) before the merge.
  const backendFile = process.env.VOICE_STORE_PY ?? "server/voice_store.py";
  const present = existsSync(backendFile);
  const source = present ? readFileSync(backendFile, "utf8") : "";
  const tuple = (name: string) => {
    const match = source.match(new RegExp(`^${name} = \\(([^)]*)\\)`, "m"));
    if (!match) throw new Error(`${name} not found in ${backendFile}`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map((value) => value[1]);
  };

  it.skipIf(!present)("matches server/voice_store.py: industries, statuses, purposes, channels", () => {
    expect([...VOICE_INDUSTRIES]).toEqual(tuple("INDUSTRIES"));
    expect([...VOICE_STATUSES]).toEqual(tuple("STATUSES"));
    expect([...VOICE_PURPOSES]).toEqual(tuple("PURPOSES"));
    expect([...VOICE_CHANNELS]).toEqual(tuple("CHANNELS"));
  });

  it.skipIf(!present)("accepts and rejects the same numbers as server/voice_store.py NUMBER (fullmatch)", () => {
    const match = source.match(/^NUMBER = re\.compile\(r"([^"]+)"\)/m);
    expect(match, "NUMBER pattern").not.toBeNull();
    const backend = new RegExp(`^(?:${match![1]})$`);
    for (const sample of samples) expect(VOICE_NUMBER_PATTERN.test(sample), sample).toBe(backend.test(sample));
  });
});
