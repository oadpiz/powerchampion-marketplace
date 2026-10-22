import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminPage from "../app/admin/[[...section]]/page";
import { AdminPortal } from "../components/admin-portal";
import { AdminShell } from "../components/admin-shell";
import { adminFetch, customer, wrap } from "./support/admin-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("admin phone agent section", () => {
  it.each([
    ["en", "Phone agent", ["Overview", "Customers", "API keys", "Redeem codes", "Usage", "Gateway", "Personas", "Node allocation", "Engineers", "Phone agent", "Credit requests", "Audit log"]],
    ["zh", "電話客服", ["總覽", "客戶", "金鑰", "兌換碼", "用量", "閘道", "人設", "機台分配", "工程師", "電話客服", "儲值申請", "操作紀錄"]],
  ])("sits between Engineers and Credit requests in the %s navigation", async (locale, label, labels) => {
    localStorage.setItem("pc-locale", locale);
    window.history.replaceState({}, "", "/admin/voice");
    wrap(<AdminShell pathname="/admin/voice"><p>content</p></AdminShell>);
    const nav = screen.getByRole("navigation");
    await waitFor(() => expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(labels));
    expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", "/admin/voice");
    expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  });

  it("renders the page title and the placeholder for an administrator", async () => {
    const calls = adminFetch({});
    wrap(<AdminPortal section="voice" />);
    expect(await screen.findByText("Under construction")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Phone agent");
    expect(calls.map((call) => call.path)).toEqual(["/session"]);
  });

  it("does not show the section to a customer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user: customer })));
    wrap(<AdminPortal section="voice" />);
    expect(await screen.findByText("Administrator access required")).toBeVisible();
    expect(screen.queryByText("Under construction")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends a signed-out visitor to sign in and back to /admin/voice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "auth_required" }, { status: 401 })));
    wrap(<AdminPortal section="voice" />);
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fadmin%2Fvoice");
  });

  it("accepts /admin/voice and rejects deeper paths", async () => {
    const page = await AdminPage({ params: Promise.resolve({ section: ["voice"] }) });
    expect(page.props.section).toBe("voice");
    for (const section of [["voice", "x"], ["voice", "stores"], ["voice", "numbers"], ["voices"]]) {
      await expect(AdminPage({ params: Promise.resolve({ section }) }), section.join("/")).rejects.toThrow();
    }
  });
});
