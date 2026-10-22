import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountPortal } from "../components/account-portal";
import { LocaleProvider } from "../components/locale-provider";
import { PlatformFrame, isPlatformPath } from "../components/platform-frame";
import { StudioCreditsPage } from "../components/studio-credits";
import { StudioHome } from "../components/studio-home";
import { StudioFrame } from "../components/studio-shell";
import { StudioTrash } from "../components/studio-trash";
import { fail, studioFetch } from "./support/studio-fixtures";

const inFrame = (node: React.ReactNode) =>
  render(
    <LocaleProvider>
      <StudioFrame>{node}</StudioFrame>
    </LocaleProvider>,
  );

const NOW = 1_800_000_000;
const cup = { id: "p1", title: "保溫杯開箱", template_id: "ecommerce", status: "ready", thumb_url: null, updated_at: NOW - 600 };
const lamp = { id: "p2", title: "桌燈", template_id: "ecommerce", status: "draft_ready", thumb_url: null, updated_at: NOW - 900 };

beforeEach(() => {
  localStorage.setItem("pc-locale", "zh");
  window.history.replaceState({}, "", "/studio");
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("rename from the list", () => {
  it("saves a trimmed title of at most 120 characters through the settings route", async () => {
    const calls = studioFetch({
      "GET /studio/projects?limit=20": { items: [cup, lamp], next: null },
      "POST /studio/projects/p1/settings": (body: unknown) => ({ id: "p1", title: (body as { title: string }).title }),
    });
    inFrame(<StudioHome />);
    const list = await screen.findByRole("list", { name: "影片列表" });
    await userEvent.click(within(list).getByRole("button", { name: "重新命名「保溫杯開箱」" }));
    const dialog = screen.getByRole("dialog", { name: "重新命名影片" });
    const input = within(dialog).getByLabelText("影片名稱");
    expect(input).toHaveValue("保溫杯開箱");
    expect(input).toHaveAttribute("maxLength", "120");
    await userEvent.clear(input);
    await userEvent.type(input, "  不鏽鋼保溫杯  ");
    await userEvent.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(await within(list).findByRole("link", { name: /不鏽鋼保溫杯/ })).toHaveAttribute("href", "/studio/p/p1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const post = calls.find((call) => call.method === "POST");
    expect(post?.path).toBe("/studio/projects/p1/settings");
    expect(post?.body).toEqual({ title: "不鏽鋼保溫杯" });
  });

  it("refuses an empty title and keeps the dialog open on a busy project", async () => {
    const calls = studioFetch({
      "GET /studio/projects?limit=20": { items: [cup], next: null },
      "POST /studio/projects/p1/settings": fail(409, "studio_busy"),
    });
    inFrame(<StudioHome />);
    await userEvent.click(await screen.findByRole("button", { name: "重新命名「保溫杯開箱」" }));
    const dialog = screen.getByRole("dialog", { name: "重新命名影片" });
    await userEvent.clear(within(dialog).getByLabelText("影片名稱"));
    await userEvent.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("請輸入 1 到 120 個字的名稱");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await userEvent.type(within(dialog).getByLabelText("影片名稱"), "新名稱");
    await userEvent.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("正在處理中");
    // The dialog hides the page from assistive tech while open; the card is still there behind it.
    expect(screen.getByRole("link", { name: /保溫杯開箱/, hidden: true })).toBeInTheDocument();
  });
});

describe("delete from the list", () => {
  it("warns that credits are not refunded, then moves the video to the trash", async () => {
    const calls = studioFetch({
      "GET /studio/projects?limit=20": { items: [cup, lamp], next: null },
      "POST /studio/projects/p1/delete": { id: "p1", deleted_at: NOW, restore_until: NOW + 30 * 86400 },
    });
    inFrame(<StudioHome />);
    const list = await screen.findByRole("list", { name: "影片列表" });
    await userEvent.click(within(list).getByRole("button", { name: "刪除「保溫杯開箱」" }));
    const dialog = screen.getByRole("dialog", { name: "刪除「保溫杯開箱」？" });
    expect(dialog).toHaveTextContent("刪除不會退回已使用的點數。30 天內可以從回收區復原。");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "刪除" }));
    await waitFor(() => expect(within(list).queryByRole("link", { name: /保溫杯開箱/ })).not.toBeInTheDocument());
    expect(within(list).getByRole("link", { name: /桌燈/ })).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("已移到回收區");
    expect(within(status).getByRole("link", { name: "回收區" })).toHaveAttribute("href", "/studio/trash");
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual(["/studio/projects/p1/delete"]);
  });

  it("explains in English too", async () => {
    localStorage.setItem("pc-locale", "en");
    studioFetch({ "GET /studio/projects?limit=20": { items: [cup], next: null } });
    inFrame(<StudioHome />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete “保溫杯開箱”" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Deleting does not refund credits already used. You can restore it from the trash within 30 days.",
    );
  });

  it("keeps the video and says why when it is busy", async () => {
    studioFetch({
      "GET /studio/projects?limit=20": { items: [cup], next: null },
      "POST /studio/projects/p1/delete": fail(409, "studio_busy"),
    });
    inFrame(<StudioHome />);
    await userEvent.click(await screen.findByRole("button", { name: "刪除「保溫杯開箱」" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "刪除" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("正在處理中");
    // The dialog hides the page from assistive tech while open; the card is still there behind it.
    expect(screen.getByRole("link", { name: /保溫杯開箱/, hidden: true })).toBeInTheDocument();
  });
});

describe("trash", () => {
  it("lists deleted videos with the days left and restores one", async () => {
    window.history.replaceState({}, "", "/studio/trash");
    const calls = studioFetch({
      "GET /studio/projects?limit=20&deleted=1": {
        items: [
          { ...cup, deleted_at: NOW - 86400, restore_until: NOW + 29 * 86400 },
          { ...lamp, deleted_at: NOW - 29.5 * 86400, restore_until: NOW + 0.5 * 86400 },
        ],
        next: null,
      },
      "POST /studio/projects/p1/restore": { id: "p1", deleted_at: null, restore_until: null },
    });
    inFrame(<StudioTrash />);
    expect(await screen.findByRole("heading", { name: "回收區" })).toBeInTheDocument();
    expect(screen.getByText(/30 天內可以復原/)).toBeInTheDocument();
    expect(screen.getByText(/點數不會退回/)).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "已刪除的影片" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("保溫杯開箱");
    expect(items[0]).toHaveTextContent("還可復原 29 天");
    expect(items[1]).toHaveTextContent("不到 1 天");
    // A deleted video cannot be opened.
    expect(within(list).queryByRole("link")).not.toBeInTheDocument();
    await userEvent.click(within(items[0]).getByRole("button", { name: "復原「保溫杯開箱」" }));
    await waitFor(() => expect(within(list).queryByText("保溫杯開箱")).not.toBeInTheDocument());
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("已復原「保溫杯開箱」");
    expect(within(status).getByRole("link", { name: "開啟" })).toHaveAttribute("href", "/studio/p/p1");
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual(["/studio/projects/p1/restore"]);
  });

  it("shows an empty trash", async () => {
    window.history.replaceState({}, "", "/studio/trash");
    studioFetch({ "GET /studio/projects?limit=20&deleted=1": { items: [], next: null } });
    inFrame(<StudioTrash />);
    expect(await screen.findByText("回收區是空的。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回收區", current: "page" })).toHaveAttribute("href", "/studio/trash");
  });

  it("names a restore that is too late", async () => {
    window.history.replaceState({}, "", "/studio/trash");
    studioFetch({
      "GET /studio/projects?limit=20&deleted=1": { items: [{ ...cup, deleted_at: NOW - 86400, restore_until: NOW + 86400 }], next: null },
      "POST /studio/projects/p1/restore": fail(404, "studio_not_found"),
    });
    inFrame(<StudioTrash />);
    await userEvent.click(await screen.findByRole("button", { name: "復原「保溫杯開箱」" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("找不到這支影片");
  });
});

describe("before the video agent is connected", () => {
  for (const [path, page] of [
    ["/studio", <StudioHome key="home" />],
    ["/studio/credits", <StudioCreditsPage key="credits" />],
    ["/studio/trash", <StudioTrash key="trash" />],
  ] as const) {
    it(`${path} says the studio is not open yet and asks for nothing else`, async () => {
      window.history.replaceState({}, "", path);
      const calls = studioFetch({ "GET /studio/credits": fail(503, "studio_unconfigured") });
      inFrame(page);
      expect(await screen.findByRole("heading", { name: "影片工作室尚未開放" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "聯絡我們" })).toHaveAttribute("href", "/contact");
      expect(screen.getByRole("link", { name: "回到帳戶" })).toHaveAttribute("href", "/account");
      // Only the session and one credits probe: the page itself never asks the missing agent.
      await waitFor(() => expect(calls.map((call) => call.path)).toEqual(["/session", "/studio/credits"]));
      expect(screen.queryByRole("link", { name: "可用點數" })).not.toBeInTheDocument();
    });
  }

  it("says so in English", async () => {
    localStorage.setItem("pc-locale", "en");
    studioFetch({ "GET /studio/credits": fail(503, "studio_unconfigured") });
    inFrame(<StudioHome />);
    expect(await screen.findByRole("heading", { name: "The video studio is not open yet" })).toBeInTheDocument();
  });

  it("still renders the pages when credits fail for another reason", async () => {
    studioFetch({ "GET /studio/credits": fail(503, "service_unavailable"), "GET /studio/projects?limit=20": { items: [], next: null } });
    inFrame(<StudioHome />);
    expect(await screen.findByRole("heading", { name: "還沒有影片" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "可用點數" })).toHaveTextContent("點數無法讀取");
  });
});

describe("where /studio is linked", () => {
  it("is not in the public platform sidebar, but /studio pages keep the platform layout", () => {
    for (const path of ["/models", "/pricing", "/docs/api", "/platform", "/studio"]) {
      const { container, unmount } = render(
        <LocaleProvider>
          <PlatformFrame pathname={path}>
            <p>page</p>
          </PlatformFrame>
        </LocaleProvider>,
      );
      expect(container.querySelector('a[href^="/studio"]'), path).toBeNull();
      // The mobile tool picker lists it only on a studio page itself (so the picker shows where you are).
      expect(container.querySelector('option[value="/studio"]') !== null, path).toBe(path === "/studio");
      unmount();
    }
    for (const path of ["/studio", "/studio/new", "/studio/trash", "/studio/p/p1"]) expect(isPlatformPath(path), path).toBe(true);
  });

  it("is in the signed-in account header only", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ error: "auth_required" }, { status: 401 }))));
    const signedOut = render(
      <LocaleProvider>
        <AccountPortal section="overview" />
      </LocaleProvider>,
    );
    await screen.findByRole("link", { name: "登入" });
    expect(signedOut.container.querySelector('a[href^="/studio"]')).toBeNull();
    signedOut.unmount();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url.endsWith("/session")
        ? Response.json({ user: { id: "u1", email: "a@example.com", name: "A", role: "customer" } })
        : Response.json({ month: "2026-09", rows: [], source: "unconfigured", updatedAt: null }))));
    render(
      <LocaleProvider>
        <AccountPortal section="usage" />
      </LocaleProvider>,
    );
    expect(await screen.findByRole("link", { name: /影片工作室/ })).toHaveAttribute("href", "/studio");
  });
});
