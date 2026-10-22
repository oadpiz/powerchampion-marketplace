/** S3 review follow-ups: failed creates, dialogs, double clicks, polling edges, voices, downloads, media origin, admin grant. */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminStudioSection } from "../components/admin-studio-section";
import { LocaleProvider } from "../components/locale-provider";
import { StudioEditor } from "../components/studio-editor";
import { StudioHome } from "../components/studio-home";
import { StudioNew } from "../components/studio-new";
import { StudioFrame } from "../components/studio-shell";
import { useStudioProject } from "../components/use-studio-project";
import { fail, project, quote, studioFetch, template } from "./support/studio-fixtures";

const inFrame = (node: React.ReactNode) =>
  render(
    <LocaleProvider>
      <StudioFrame>{node}</StudioFrame>
    </LocaleProvider>,
  );

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  localStorage.setItem("pc-locale", "zh");
  window.history.replaceState({}, "", "/studio");
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ready = () =>
  project({
    status: "ready",
    shots: project().shots.map((shot) => ({ ...shot, stale: false, status: "ready" })),
    exports: { "9:16": { url: "https://studio-media.test/media/e/v.mp4?exp=1&sig=x", srt_url: "https://studio-media.test/media/e/v.srt?exp=1&sig=x" }, "16:9": null },
  });

async function tickRights() {
  const box = await screen.findByRole("checkbox", { name: /商品照片的使用權/ });
  if (!(box as HTMLInputElement).checked) await userEvent.click(box);
}

describe("M1: a failed create with images", () => {
  it.each([
    [402, "studio_insufficient_credits", "點數不足"],
    [404, "studio_not_found", "請重新上傳商品圖片"],
    [503, "service_unavailable", "影片服務暫時無法連線"],
  ])("clears the images, asks for a re-upload and uses a new key (%s %s)", async (status, code, text) => {
    let uploads = 0;
    const calls = studioFetch({
      "POST /studio/uploads": () => {
        uploads += 1;
        return Response.json({ upload_id: `u_${uploads}`, put_url: `https://studio-media.test/media/upload/t${uploads}`, expires_at: 1 }, { status: 201 });
      },
      "PUT https://studio-media.test/media/upload/t1": () => new Response("{}", { status: 201 }),
      "PUT https://studio-media.test/media/upload/t2": () => new Response("{}", { status: 201 }),
      "POST /studio/projects": () => fail(status, code),
    });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    inFrame(<StudioNew navigate={() => {}} />);
    await tickRights();
    await userEvent.upload(await screen.findByLabelText("選擇圖片"), new File([new Uint8Array(4)], "a.png", { type: "image/png" }));
    await screen.findByRole("img", { name: "已上傳的圖片 1" });
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(alert).toHaveTextContent("請重新上傳商品圖片");
    expect(screen.queryByRole("img", { name: "已上傳的圖片 1" })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/studio/credits").length).toBeGreaterThanOrEqual(2);
    await tickRights();
    await userEvent.upload(screen.getByLabelText("選擇圖片"), new File([new Uint8Array(4)], "b.png", { type: "image/png" }));
    await screen.findByRole("img", { name: "已上傳的圖片 1" });
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/studio/projects" && c.method === "POST")).toHaveLength(2));
    const [first, second] = calls.filter((c) => c.path === "/studio/projects" && c.method === "POST").map((c) => c.body as Record<string, unknown>);
    expect((first.inputs as Record<string, unknown>).image_ids).toEqual(["u_1"]);
    expect((second.inputs as Record<string, unknown>).image_ids).toEqual(["u_2"]);
    expect(second.idempotency_key).not.toBe(first.idempotency_key);
  });

  it("keeps the key for a plain retry without images, so a lost response is not created twice", async () => {
    const calls = studioFetch({ "POST /studio/projects": fail(503, "service_unavailable") });
    inFrame(<StudioNew navigate={() => {}} />);
    await userEvent.type(await screen.findByLabelText("主題"), "杯子");
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/studio/projects")).toHaveLength(2));
    const keys = calls.filter((c) => c.path === "/studio/projects").map((c) => (c.body as Record<string, unknown>).idempotency_key);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe("editor actions", () => {
  it("submits a free step (export) without a dialog", async () => {
    const calls = studioFetch({
      "GET /studio/projects/p1": ready(),
      "POST /studio/projects/p1/quote": (body: unknown) => ({ ...quote(0, (body as { type: string }).type, "9:16"), breakdown: [] }),
      "POST /studio/projects/p1/ops": () => Response.json({ op_id: "op1", state: "submitted" }, { status: 202 }),
    });
    inFrame(<StudioEditor projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: "匯出 9:16" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/studio/projects/p1/ops")).toBe(true));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect((calls.find((c) => c.path === "/studio/projects/p1/ops")?.body as Record<string, unknown>).type).toBe("export");
  });

  it("shows 402 inside the dialog with a credits link, and refreshes credits and the project", async () => {
    const calls = studioFetch({
      "GET /studio/projects/p1": project(),
      "POST /studio/projects/p1/quote": (body: unknown) => quote(2, (body as { type: string }).type, "1"),
      "POST /studio/projects/p1/ops": fail(402, "studio_insufficient_credits"),
    });
    inFrame(<StudioEditor projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: "重新產生這一鏡" }));
    const dialog = await screen.findByRole("dialog");
    const before = { credits: calls.filter((c) => c.path === "/studio/credits").length, project: calls.filter((c) => c.path === "/studio/projects/p1").length };
    await userEvent.click(within(dialog).getByRole("button", { name: "確認（2 點）" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("點數不足");
    expect(within(alert).getByRole("link", { name: "查看點數" })).toHaveAttribute("href", "/studio/credits");
    await waitFor(() => expect(calls.filter((c) => c.path === "/studio/credits").length).toBeGreaterThan(before.credits));
    expect(calls.filter((c) => c.path === "/studio/projects/p1").length).toBeGreaterThan(before.project);
  });

  it("shows 409 busy inside the dialog and reloads the project", async () => {
    const calls = studioFetch({
      "GET /studio/projects/p1": project(),
      "POST /studio/projects/p1/quote": (body: unknown) => quote(2, (body as { type: string }).type, "1"),
      "POST /studio/projects/p1/ops": fail(409, "studio_busy"),
    });
    inFrame(<StudioEditor projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: "重新產生這一鏡" }));
    const dialog = await screen.findByRole("dialog");
    const gets = calls.filter((c) => c.path === "/studio/projects/p1").length;
    await userEvent.click(within(dialog).getByRole("button", { name: "確認（2 點）" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("正在處理中");
    await waitFor(() => expect(calls.filter((c) => c.path === "/studio/projects/p1").length).toBeGreaterThan(gets));
  });

  it("submits once on a double click and keeps the actions disabled until the op shows up", async () => {
    let release: (() => void) | null = null;
    const calls = studioFetch({
      "GET /studio/projects/p1": project(),
      "POST /studio/projects/p1/quote": (body: unknown) => quote(2, (body as { type: string }).type, "1"),
      "POST /studio/projects/p1/ops": () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json({ op_id: "op7", state: "submitted" }, { status: 202 }));
        }),
    });
    inFrame(<StudioEditor projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: "重新產生這一鏡" }));
    const confirm = within(await screen.findByRole("dialog")).getByRole("button", { name: "確認（2 點）" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(release).not.toBeNull());
    await act(async () => release?.());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.filter((c) => c.path === "/studio/projects/p1/ops")).toHaveLength(1);
    // The reload still shows no active op (the agent has not picked it up): the actions stay disabled.
    expect(screen.getByRole("button", { name: "重新產生這一鏡" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /產生全部/ })).toBeDisabled();
  });

  it("downloads the export with the media host's attachment flag in a new tab", async () => {
    studioFetch({ "GET /studio/projects/p1": ready(), "POST /studio/projects/p1/quote": quote(4, "add_aspect", "16:9") });
    inFrame(<StudioEditor projectId="p1" />);
    const link = await screen.findByRole("link", { name: "下載 MP4（9:16）" });
    expect(link).toHaveAttribute("href", "https://studio-media.test/media/e/v.mp4?exp=1&sig=x&dl=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("drops media URLs from any origin other than the configured media host", async () => {
    const foreign = project({
      shots: project().shots.map((shot) => ({ ...shot, thumb_url: "https://evil.test/x.png", preview_url: "https://evil.test/x.png" })),
    });
    studioFetch({ "GET /studio/projects/p1": foreign, "GET /studio/templates": { items: [template], media_origin: "https://studio-media.test" } });
    const view = inFrame(<StudioEditor projectId="p1" />);
    await screen.findByRole("list", { name: "分鏡時間軸" });
    await waitFor(() => expect(view.container.querySelector("img[src^='https://evil.test']")).toBeNull());
    expect(screen.getByText("這一鏡還沒有畫面")).toBeInTheDocument();
  });

  it("says customers have no licensed voice yet and disables steps that would narrate", async () => {
    const internal = { ...template, project_schema: { ...template.project_schema, properties: { ...template.project_schema.properties, voice: { type: "string", enum: ["tw_ref"], "x-internal-values": ["tw_ref", "test"] } } } };
    const calls = studioFetch({ "GET /studio/projects/p1": project({ settings: { voice: "tw_ref", subtitles: true } }), "GET /studio/templates": { items: [internal] } });
    inFrame(<StudioEditor projectId="p1" />);
    expect(await screen.findByText(/目前沒有可對外使用的配音/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/studio/projects/p1/quote")).toBe(false);
    expect(screen.getByRole("button", { name: /產生全部/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新產生這一鏡" })).toBeDisabled();
  });

  it("does not promise an automatic retry when polling has stopped", async () => {
    studioFetch({ "GET /studio/projects/p1": fail(404, "studio_not_found") });
    inFrame(<StudioEditor projectId="p1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("找不到這支影片");
    expect(screen.queryByText(/自動重試/)).not.toBeInTheDocument();
  });

  it("uses tab semantics with arrow keys for the inspector", async () => {
    studioFetch({ "GET /studio/projects/p1": project() });
    inFrame(<StudioEditor projectId="p1" />);
    const shotTab = await screen.findByRole("tab", { name: "鏡頭" });
    expect(shotTab).toHaveAttribute("aria-controls");
    expect(document.getElementById(shotTab.getAttribute("aria-controls") ?? "")).toHaveAttribute("role", "tabpanel");
    shotTab.focus();
    await userEvent.keyboard("{ArrowRight}");
    const settings = screen.getByRole("tab", { name: "專案設定" });
    expect(settings).toHaveAttribute("aria-selected", "true");
    expect(settings).toHaveFocus();
  });
});

describe("polling edges", () => {
  const running = () => project({ active_op: { op_id: "o1", type: "render", state: "running" } });

  it("stops its timer on unmount", async () => {
    vi.useFakeTimers();
    const calls = studioFetch({ "GET /studio/projects/p1": running() });
    const hook = renderHook(() => useStudioProject("p1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    hook.unmount();
    const gets = calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(calls.length).toBe(gets);
  });

  it("pauses while the tab is hidden and reloads when it is shown", async () => {
    vi.useFakeTimers();
    const calls = studioFetch({ "GET /studio/projects/p1": running() });
    renderHook(() => useStudioProject("p1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    visibility = "hidden";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(calls.length).toBe(1);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.length).toBe(2);
  });

  it("reloads again when asked to refresh during a load, so a submit is not missed", async () => {
    let resolveFirst: ((r: Response) => void) | null = null;
    let n = 0;
    studioFetch({
      "GET /studio/projects/p1": () => {
        n += 1;
        if (n === 1) return new Promise<Response>((resolve) => (resolveFirst = resolve));
        return running();
      },
    });
    const { result } = renderHook(() => useStudioProject("p1"));
    await waitFor(() => expect(resolveFirst).not.toBeNull());
    act(() => result.current.refresh());
    await act(async () => resolveFirst?.(Response.json(project())));
    await waitFor(() => expect(result.current.project?.active_op?.op_id).toBe("o1"));
  });

  it("recovers from a remount while a load is in flight", async () => {
    studioFetch({ "GET /studio/projects/p1": project() });
    const first = renderHook(() => useStudioProject("p1"));
    first.unmount();
    const second = renderHook(() => useStudioProject("p1"));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.project?.id).toBe("p1");
  });

  it("does not refresh the project list while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = studioFetch({
      "GET /studio/projects?limit=20": { items: [{ id: "p2", title: "x", template_id: "ecommerce", status: "rendering", thumb_url: null, updated_at: 1 }], next: null },
    });
    inFrame(<StudioHome />);
    await screen.findByRole("list", { name: "影片列表" });
    visibility = "hidden";
    const lists = () => calls.filter((c) => c.path === "/studio/projects?limit=20").length;
    const before = lists();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });
    expect(lists()).toBe(before);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(lists()).toBe(before + 1);
  });
});

describe("admin grant", () => {
  it("asks for confirmation and retries with the same idempotency key", async () => {
    let attempt = 0;
    const calls = studioFetch(
      {
        "GET /admin/customers": { customers: [{ id: "u7", email: "shop@example.com", name: "Shop", role: "customer", status: "active" }] },
        "POST /admin/studio/credits/grant": () => {
          attempt += 1;
          return attempt === 1 ? fail(503, "service_unavailable") : { account: { user_id: "u7", balance: 500, reserved: 0, plan: "creator", period_end: null }, replayed: false };
        },
        [`GET /admin/studio/usage?month=${new Date().toISOString().slice(0, 7)}`]: { month: "x", agent_status: "ok", gpu_usd_per_hour: 2.08, users: [] },
      },
      "admin",
    );
    render(
      <LocaleProvider>
        <AdminStudioSection />
      </LocaleProvider>,
    );
    await userEvent.selectOptions(await screen.findByLabelText("帳號"), "u7");
    await userEvent.type(screen.getByLabelText("點數"), "500");
    await userEvent.click(screen.getByRole("button", { name: "確認發放" }));
    const dialog = await screen.findByRole("dialog", { name: "確認發放點數" });
    expect(dialog).toHaveTextContent("shop@example.com");
    expect(dialog).toHaveTextContent("500");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "發放 500 點" }));
    await within(dialog).findByRole("alert");
    await userEvent.click(within(dialog).getByRole("button", { name: "發放 500 點" }));
    expect(await screen.findByText(/已發放 500 點給 shop@example.com/)).toBeInTheDocument();
    const keys = calls.filter((c) => c.method === "POST").map((c) => (c.body as Record<string, unknown>).idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(keys[1]).toBe(keys[0]);
  });
});
