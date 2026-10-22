import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPortal } from "../components/admin-portal";
import {
  balanceLevel,
  filtersFromSearch,
  matchesFilters,
  relativeTimeLabel,
  searchWithFilters,
  statusCounts,
} from "../lib/admin-keys-view";
import { adminFetch, wrap } from "./support/admin-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const key = (gatewayKeyId: string, extra: Record<string, unknown> = {}) => ({
  gatewayKeyId,
  prefix: `pc-live-${gatewayKeyId}`,
  label: `Key ${gatewayKeyId}`,
  dailyTokenLimit: 0,
  rpm: 60,
  maxInflight: 0,
  balanceUsd: "12.5",
  createdAt: 1_760_000_000,
  expiresAt: null,
  disabledAt: null,
  lastUsedAt: null,
  modelIds: [],
  owner: { id: "cust-9", email: "owner@example.com", name: "Owner" },
  portalKeyId: `pk-${gatewayKeyId}`,
  portalStatus: "active",
  ...extra,
});

const acme = key("gk-1", { label: "Acme production", prefix: "pc-live-aaaa" });
const listing = {
  keys: [
    acme,
    key("gk-2", { label: "Beta staging", prefix: "pc-live-bbbb", balanceUsd: "1.2", owner: { id: "cust-7", email: "beta@example.com", name: "Beta Corp" } }),
    key("gk-3", { label: "Old trial", prefix: "pc-live-cccc", balanceUsd: "0", disabledAt: 1_760_000_100, portalStatus: "revoked" }),
    key("gk-4", { label: "Internal", prefix: "pc-live-dddd", balanceUsd: null, owner: null, portalKeyId: null, portalStatus: null }),
  ],
  envKeys: [key("env-1", { label: "Env key", prefix: "env-key", owner: null })],
  gatewayConfigured: true,
};

const rows = (name = "Customer API keys") => within(screen.getByRole("table", { name })).getAllByRole("row").slice(1);
const rowLabels = () => rows().map((row) => within(row).getAllByRole("cell")[1].textContent);

describe("admin keys view helpers", () => {
  it("matches search text against label, prefix, owner email and name", () => {
    const base = { query: "", customer: "", status: "all" as const };
    expect(matchesFilters(acme, { ...base, query: "acme" })).toBe(true);
    expect(matchesFilters(acme, { ...base, query: "PC-LIVE-AA" })).toBe(true);
    expect(matchesFilters(acme, { ...base, query: "owner@example" })).toBe(true);
    expect(matchesFilters(acme, { ...base, query: "owner" })).toBe(true);
    expect(matchesFilters(acme, { ...base, query: "beta" })).toBe(false);
    expect(matchesFilters(listing.keys[3], { ...base, customer: "none" })).toBe(true);
    expect(matchesFilters(acme, { ...base, customer: "none" })).toBe(false);
    expect(matchesFilters(acme, { ...base, customer: "cust-7" })).toBe(false);
  });

  it("flags low and empty prepaid balances but not postpaid keys", () => {
    expect(balanceLevel(null)).toBe("postpaid");
    expect(balanceLevel("0")).toBe("empty");
    expect(balanceLevel("4.99")).toBe("low");
    expect(balanceLevel("5")).toBe("ok");
    expect(statusCounts(listing.keys)).toEqual({ all: 4, active: 3, disabled: 1, low: 2 });
  });

  it("keeps filters in the query string alongside unrelated parameters", () => {
    const search = searchWithFilters("?tab=x", { query: "acme", customer: "cust-9", status: "low" });
    expect(new URLSearchParams(search).get("tab")).toBe("x");
    expect(filtersFromSearch(search)).toEqual({ query: "acme", customer: "cust-9", status: "low" });
    expect(searchWithFilters(search, { query: "", customer: "", status: "all" })).toBe("?tab=x");
    expect(filtersFromSearch("?status=bogus").status).toBe("all");
  });

  it("describes last use as a relative time", () => {
    const now = Date.UTC(2026, 9, 22, 12);
    expect(relativeTimeLabel(now / 1000 - 3 * 3600, true, now)).toBe("3 小時前");
    expect(relativeTimeLabel(now / 1000 - 3 * 3600, false, now)).toBe("3 hours ago");
    expect(relativeTimeLabel(now / 1000 - 20, true, now)).toBe("剛剛");
    expect(relativeTimeLabel(null, true, now)).toBe("從未使用");
    expect(relativeTimeLabel(new Date(now - 2 * 86400_000).toISOString(), false, now)).toBe("2 days ago");
  });
});

describe("admin keys search and filters", () => {
  it("narrows the list by search, customer and status, with a result count and the URL kept in sync", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/admin/keys");
    adminFetch({ "GET /admin/keys": listing });
    wrap(<AdminPortal section="keys" />);
    await screen.findByText("Acme production");
    expect(rowLabels()).toHaveLength(4);
    expect(screen.getByText("4 keys")).toBeVisible();

    await user.type(screen.getByLabelText("Search keys"), "beta@");
    expect(rowLabels()).toEqual(["Beta staging"]);
    expect(screen.getByText("Showing 1 of 4 keys")).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("beta@");

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rowLabels()).toHaveLength(4);
    expect(window.location.search).toBe("");

    await user.selectOptions(screen.getByLabelText("Customer"), "cust-9");
    expect(rowLabels()).toEqual(["Acme production", "Old trial"]);
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("cust-9");
    await user.selectOptions(screen.getByLabelText("Customer"), "none");
    expect(rowLabels()).toEqual(["Internal"]);
    await user.selectOptions(screen.getByLabelText("Customer"), "");

    const statuses = screen.getByRole("group", { name: "Filter by status" });
    await user.click(within(statuses).getByRole("button", { name: /Disabled/ }));
    expect(rowLabels()).toEqual(["Old trial"]);
    await user.click(within(statuses).getByRole("button", { name: /Low balance/ }));
    expect(within(statuses).getByRole("button", { name: /Low balance/ })).toHaveAttribute("aria-pressed", "true");
    expect(rowLabels()).toEqual(["Beta staging", "Old trial"]);
    expect(new URLSearchParams(window.location.search).get("status")).toBe("low");
    await user.click(within(statuses).getByRole("button", { name: /Active/ }));
    expect(rowLabels()).toEqual(["Acme production", "Beta staging", "Internal"]);
  });

  it("restores the filters from the URL on load and explains when nothing matches", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/admin/keys?q=acme&status=disabled");
    adminFetch({ "GET /admin/keys": listing });
    wrap(<AdminPortal section="keys" />);
    expect(await screen.findByText("No keys match these filters.")).toBeVisible();
    expect(screen.getByLabelText("Search keys")).toHaveValue("acme");
    expect(screen.getByText("Showing 0 of 4 keys")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(rowLabels()).toHaveLength(4);
  });
});

describe("admin keys labels and balances", () => {
  it("uses plain Traditional Chinese labels and keeps the environment keys collapsed", async () => {
    localStorage.setItem("pc-locale", "zh");
    window.history.replaceState({}, "", "/admin/keys");
    adminFetch({ "GET /admin/keys": { ...listing, keys: [{ ...acme, lastUsedAt: Math.floor(Date.now() / 1000) - 3 * 3600 }] } });
    wrap(<AdminPortal section="keys" />);
    const table = await screen.findByRole("table", { name: "客戶的 API 金鑰" });
    expect(within(table).getByRole("columnheader", { name: /金鑰開頭（用來辨認）/ })).toBeVisible();
    expect(within(table).getByRole("columnheader", { name: /剩餘餘額（USD）/ })).toBeVisible();
    expect(within(table).getByRole("columnheader", { name: /用量上限/ })).toBeVisible();
    const row = rows("客戶的 API 金鑰")[0];
    expect(within(row).getByText("每分鐘上限：60 次請求")).toBeVisible();
    expect(within(row).getByText("每日上限：不限")).toBeVisible();
    expect(within(row).getByText("3 小時前")).toBeVisible();
    expect(within(row).getByText("使用中")).toBeVisible();
    expect(screen.getByText("伺服器設定檔裡的金鑰，這裡只能看不能改。")).toBeVisible();
    expect(screen.getByText(/環境金鑰（唯讀，1 把）/).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Env key")).not.toBeVisible();
  });

  it("highlights low and empty balances in USD", async () => {
    adminFetch({ "GET /admin/keys": listing });
    wrap(<AdminPortal section="keys" />);
    await screen.findByText("Acme production");
    const [ok, low, empty, postpaid] = rows();
    expect(within(ok).getByText("$12.50")).toHaveAttribute("data-balance-level", "ok");
    expect(within(low).getByText("$1.20")).toHaveAttribute("data-balance-level", "low");
    expect(within(low).getByText("Low balance")).toBeVisible();
    expect(low).toHaveClass("admin-keys-row-low");
    expect(within(empty).getByText("$0.00")).toHaveAttribute("data-balance-level", "empty");
    expect(within(empty).getByText("Out of balance")).toBeVisible();
    expect(within(postpaid).getByText("Postpaid")).toBeVisible();
    expect(within(postpaid).queryByRole("button", { name: /Top up/ })).not.toBeInTheDocument();
    expect(within(ok).queryByText("Low balance")).not.toBeInTheDocument();
  });
});

describe("admin keys row actions", () => {
  it("asks before disabling, naming the key and customer, then reports success and reloads", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/keys": listing,
      "POST /admin/keys/gk-1/disable": { ok: true },
    });
    wrap(<AdminPortal section="keys" />);
    await user.click(await screen.findByRole("button", { name: "Disable “Acme production”" }));
    let dialog = await screen.findByRole("dialog", { name: "Disable the key “Acme production”?" });
    expect(dialog).toHaveTextContent("pc-live-aaaa");
    expect(dialog).toHaveTextContent("Owner (owner@example.com)");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.method === "POST")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Disable “Acme production”" }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Disable key" }));
    expect(await screen.findByText("Disabled “Acme production”.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")).toEqual({
      method: "POST",
      path: "/admin/keys/gk-1/disable",
      body: { disabled: true },
    });
    await waitFor(() => expect(calls.filter((call) => call.path === "/admin/keys").length).toBe(2));
    // The table stays on screen during the reload.
    expect(screen.getByText("Acme production")).toBeVisible();
  });

  it("enables a disabled key without a confirmation", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/keys": listing,
      "POST /admin/keys/gk-3/disable": { ok: true },
    });
    wrap(<AdminPortal section="keys" />);
    await user.click(await screen.findByRole("button", { name: "Enable “Old trial”" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("Enabled “Old trial”.")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ disabled: false });
  });

  it("shows a failure toast with the reason when an action fails", async () => {
    const user = userEvent.setup();
    adminFetch({
      "GET /admin/keys": listing,
      "POST /admin/keys/gk-1/disable": () => Response.json({ error: "gateway_unavailable" }, { status: 503 }),
    });
    wrap(<AdminPortal section="keys" />);
    await user.click(await screen.findByRole("button", { name: "Disable “Acme production”" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disable key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Could not disable “Acme production”: /);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tops up and edits limits through the right endpoints with success toasts", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/keys": listing,
      "POST /admin/keys/gk-2/balance": { ok: true, balanceUsd: "21.2" },
      "POST /admin/keys/gk-2/limits": { ok: true },
    });
    wrap(<AdminPortal section="keys" />);
    await user.click(await screen.findByRole("button", { name: "Top up “Beta staging”" }));
    let dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("beta@example.com");
    await user.type(within(dialog).getByLabelText("Amount (USD)"), "20");
    await user.click(within(dialog).getByRole("button", { name: "Add balance" }));
    expect(await screen.findByText("Topped up “Beta staging”; the balance is now $21.20.")).toBeVisible();
    expect(calls.find((call) => call.path === "/admin/keys/gk-2/balance")?.body).toEqual({ addUsd: 20 });

    await user.click(screen.getByRole("button", { name: "Edit limits of “Beta staging”" }));
    dialog = await screen.findByRole("dialog");
    const daily = within(dialog).getByLabelText("Daily token limit");
    await user.clear(daily);
    await user.type(daily, "500000");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Updated the limits of “Beta staging”.")).toBeVisible();
    expect(calls.find((call) => call.path === "/admin/keys/gk-2/limits")?.body).toEqual({
      dailyTokenLimit: 500000,
      rpm: 60,
      maxInflight: 0,
    });
  });

  it("issues a new key for the same customer with the customer already chosen", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/keys": listing,
      "GET /admin/customers": {
        customers: [
          { id: "cust-9", email: "owner@example.com", name: "Owner", role: "customer", status: "active", createdAt: 1, keyCount: 2 },
        ],
      },
      "POST /admin/customers/cust-9/keys": Response.json(
        { key: { id: "pk-8", label: "Acme production", prefix: "pc-live-eeee", gatewayKeyId: "gk-8" }, secret: "pc-live-new-secret", balanceUsd: "10" },
        { status: 201 },
      ),
    });
    wrap(<AdminPortal section="keys" />);
    await screen.findByText("Acme production");
    // Keys with no customer cannot be reissued this way.
    expect(within(rows()[3]).queryByRole("button", { name: /Issue a new key/ })).not.toBeInTheDocument();
    const acmeRow = rows()[0];
    await user.click(within(acmeRow).getByRole("button", { name: "Issue a new key for owner@example.com" }));
    const dialog = await screen.findByRole("dialog", { name: "Issue a new key for the same customer" });
    expect(dialog).toHaveTextContent("The old key “Acme production” stays active.");
    await within(dialog).findByRole("option", { name: /owner@example.com/ });
    expect(within(dialog).getByLabelText("Customer")).toHaveValue("cust-9");
    expect(within(dialog).getByLabelText("Label")).toHaveValue("Acme production");
    fireEvent.change(within(dialog).getByLabelText("Prepaid amount (USD)"), { target: { value: "10" } });
    await user.click(within(dialog).getByRole("button", { name: "Issue key" }));
    expect(await screen.findByText("pc-live-new-secret")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")).toEqual({
      method: "POST",
      path: "/admin/customers/cust-9/keys",
      body: { label: "Acme production", prepaidUsd: 10 },
    });
  });
});
