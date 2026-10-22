import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminStudioSection } from "../components/admin-studio-section";
import { LocaleProvider } from "../components/locale-provider";
import { StudioCreditsPage } from "../components/studio-credits";
import { StudioEditor } from "../components/studio-editor";
import { StudioHome } from "../components/studio-home";
import { StudioNew } from "../components/studio-new";
import { StudioFrame } from "../components/studio-shell";
import { credits, fail, project, quote, studioFetch } from "./support/studio-fixtures";

const inFrame = (node: React.ReactNode) =>
  render(
    <LocaleProvider>
      <StudioFrame>{node}</StudioFrame>
    </LocaleProvider>,
  );

beforeEach(() => {
  localStorage.setItem("pc-locale", "zh");
  window.history.replaceState({}, "", "/studio");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("studio frame", () => {
  it("shows a sign-in panel that returns to the studio page on 401", async () => {
    window.history.replaceState({}, "", "/studio/new");
    studioFetch({ "GET /session": fail(401, "auth_required") });
    inFrame(<StudioHome />);
    const link = await screen.findByRole("link", { name: "登入" });
    expect(link).toHaveAttribute("href", "/login?next=%2Fstudio%2Fnew");
    expect(screen.queryByRole("heading", { name: "我的影片" })).not.toBeInTheDocument();
  });

  it("shows the credits badge with the reserved amount", async () => {
    studioFetch({
      "GET /studio/credits": { ...credits, balance: 980, reserved: 20 },
      "GET /studio/projects?limit=20": { items: [], next: null },
    });
    inFrame(<StudioHome />);
    const badge = await screen.findByRole("link", { name: "可用點數" });
    await waitFor(() => expect(within(badge).getByTestId("studio-balance")).toHaveTextContent("980"));
    expect(badge).toHaveTextContent("預留 20");
    expect(badge).toHaveAttribute("href", "/studio/credits");
  });
});

describe("studio list", () => {
  it("lists projects as links with status, template title and a load-more cursor", async () => {
    const calls = studioFetch({
      "GET /studio/projects?limit=20": {
        items: [
          { id: "p1", title: "保溫杯開箱", template_id: "ecommerce", status: "ready", thumb_url: "https://m.test/media/a/t.png?exp=1&sig=x", updated_at: 1761100000 },
          { id: "p2", title: null, template_id: "ecommerce", status: "drafting", thumb_url: null, updated_at: 1761000000 },
        ],
        next: "1761000000_p2",
      },
      "GET /studio/projects?limit=20&cursor=1761000000_p2": {
        items: [{ id: "p3", title: "舊影片", template_id: "ecommerce", status: "failed_render", thumb_url: null, updated_at: 1760000000 }],
        next: null,
      },
    });
    inFrame(<StudioHome />);
    const list = await screen.findByRole("list", { name: "影片列表" });
    const first = within(list).getByRole("link", { name: /保溫杯開箱/ });
    expect(first).toHaveAttribute("href", "/studio/p/p1");
    expect(first).toHaveTextContent("完成");
    expect(first).toHaveTextContent("電商商品影片");
    expect(within(list).getByRole("link", { name: /未命名影片/ })).toHaveTextContent("分鏡產生中");
    await userEvent.click(screen.getByRole("button", { name: "載入更多" }));
    expect(await within(list).findByRole("link", { name: /舊影片/ })).toHaveTextContent("產生失敗");
    expect(calls.some((call) => call.path === "/studio/projects?limit=20&cursor=1761000000_p2")).toBe(true);
    expect(screen.queryByRole("button", { name: "載入更多" })).not.toBeInTheDocument();
  });

  it("shows an empty state with the draft price", async () => {
    studioFetch({ "GET /studio/projects?limit=20": { items: [], next: null } });
    inFrame(<StudioHome />);
    expect(await screen.findByRole("heading", { name: "還沒有影片" })).toBeInTheDocument();
    expect(screen.getByText(/產生分鏡免費/)).toBeInTheDocument();
  });

  it("maps an unreachable video service to its own message", async () => {
    studioFetch({ "GET /studio/projects?limit=20": fail(503, "service_unavailable") });
    inFrame(<StudioHome />);
    expect(await screen.findByRole("alert")).toHaveTextContent("影片服務暫時無法連線");
  });
});

describe("studio new", () => {
  it("renders the form from input_schema and enforces x-require-one-of", async () => {
    const calls = studioFetch({});
    inFrame(<StudioNew navigate={() => {}} />);
    expect(await screen.findByLabelText("主題")).toBeInTheDocument();
    expect(screen.getByLabelText("商品網址")).toHaveAttribute("type", "url");
    expect(screen.getByLabelText("風格")).toHaveValue("種草推薦");
    expect(screen.getByLabelText(/目標秒數/)).toHaveValue(45);
    expect(screen.getByRole("group", { name: /商品圖片/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^直式 9:16/ })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("請至少填寫其中一項：主題、商品網址、商品圖片");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("uploads images through put_url, then creates the project and opens the editor", async () => {
    const navigate = vi.fn();
    const calls = studioFetch({
      "POST /studio/uploads": () => Response.json({ upload_id: "u_img1", put_url: "https://studio-media.test/media/upload/tok1", expires_at: 1 }, { status: 201 }),
      "PUT https://studio-media.test/media/upload/tok1": () => Response.json({ upload_id: "u_img1", bytes: 4, sha256: "x" }, { status: 201 }),
      "POST /studio/projects": () => Response.json({ id: "pnew", op_id: "op1", status: "drafting", state: "submitted" }, { status: 201 }),
    });
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    inFrame(<StudioNew navigate={navigate} />);
    const input = await screen.findByLabelText("選擇圖片");
    const file = new File([new Uint8Array([137, 80, 78, 71])], "cup.png", { type: "image/png" });
    await userEvent.upload(input, file);
    expect(await screen.findByRole("img", { name: "已上傳的圖片 1" })).toHaveAttribute("src", "blob:preview");
    const ticket = calls.find((call) => call.path === "/studio/uploads");
    expect(ticket?.body).toEqual({ purpose: "input_image", content_type: "image/png", bytes: 4 });
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("https://studio-media.test/media/upload/tok1");
    expect(put?.init?.body).toBe(file);
    expect(new Headers(put?.init?.headers).get("Content-Type")).toBe("image/png");
    expect(put?.init?.credentials).toBe("omit");

    await userEvent.click(screen.getByRole("radio", { name: /^橫式 16:9/ }));
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/studio/p/pnew"));
    const created = calls.find((call) => call.method === "POST" && call.path === "/studio/projects");
    const body = created?.body as Record<string, unknown>;
    expect(body.template_id).toBe("ecommerce");
    expect(body.aspect).toBe("16:9");
    expect(body.inputs).toEqual({ style: "種草推薦", target_seconds: 45, image_ids: ["u_img1"] });
    expect(body.idempotency_key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("refuses an unsupported file before asking for an upload URL", async () => {
    const calls = studioFetch({});
    inFrame(<StudioNew navigate={() => {}} />);
    const input = await screen.findByLabelText("選擇圖片");
    // userEvent honours `accept`; fireEvent simulates a picker that ignores it.
    fireEvent.change(input, { target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("不支援這種檔案格式");
    expect(calls.some((call) => call.path === "/studio/uploads")).toBe(false);
  });

  it("explains insufficient credits with a link to the credits page", async () => {
    studioFetch({ "POST /studio/projects": fail(402, "studio_insufficient_credits") });
    inFrame(<StudioNew navigate={() => {}} />);
    await userEvent.type(await screen.findByLabelText("主題"), "保溫杯");
    await userEvent.click(screen.getByRole("button", { name: "產生分鏡（免費）" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("點數不足");
    expect(within(alert).getByRole("link", { name: "查看點數" })).toHaveAttribute("href", "/studio/credits");
  });
});

describe("studio editor", () => {
  it("renders the timeline with kind, seconds, badges and self-check, and the inspector from shot_schema", async () => {
    studioFetch({ "GET /studio/projects/p1": project() });
    inFrame(<StudioEditor projectId="p1" />);
    const timeline = await screen.findByRole("list", { name: "分鏡時間軸" });
    const shots = within(timeline).getAllByRole("button");
    expect(shots[0]).toHaveTextContent("#1");
    expect(shots[0]).toHaveTextContent("圖片");
    expect(shots[0]).toHaveTextContent("4 秒");
    expect(shots[0]).toHaveTextContent("需產生");
    expect(shots[1]).toHaveTextContent("動態");
    expect(within(shots[1]).getByLabelText("AI 自我檢查有提醒")).toBeInTheDocument();

    expect(screen.getByLabelText("畫面描述")).toHaveValue("杯子放在木桌上");
    expect(screen.getByTestId("narration-meter")).toHaveTextContent("15 字，約 3.3 秒／鏡頭 4 秒");
    expect(screen.getByRole("button", { name: "產生全部" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "匯出 9:16" })).toBeDisabled();

    await userEvent.click(shots[1]);
    expect(screen.getByLabelText(/秒數/)).toBeDisabled();
    expect(screen.getByText("動態鏡頭固定 5 秒")).toBeInTheDocument();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("畫面裡可能有亂碼文字");
    expect(note).toHaveTextContent("未驗證");
  });

  it("flags narration that is too long for the shot", async () => {
    studioFetch({ "GET /studio/projects/p1": project() });
    inFrame(<StudioEditor projectId="p1" />);
    const narration = await screen.findByLabelText("旁白");
    await userEvent.clear(narration);
    await userEvent.type(narration, "這是一段非常非常非常非常長而且一定講不完的旁白文字內容");
    expect(screen.getByTestId("narration-meter")).toHaveTextContent("太長");
  });

  it("saves only the changed fields of a shot, for free", async () => {
    const calls = studioFetch({
      "GET /studio/projects/p1": project(),
      "POST /studio/projects/p1/shots/1/edit": () =>
        project({ storyboard_rev: 4, shots: project().shots.map((shot) => (shot.index === 1 ? { ...shot, visual_prompt: "杯子在窗邊" } : shot)) }),
    });
    inFrame(<StudioEditor projectId="p1" />);
    const prompt = await screen.findByLabelText("畫面描述");
    await userEvent.clear(prompt);
    await userEvent.type(prompt, "杯子在窗邊");
    await userEvent.click(screen.getByRole("button", { name: "儲存變更（免費）" }));
    await screen.findByText(/已儲存/);
    const edit = calls.find((call) => call.path === "/studio/projects/p1/shots/1/edit");
    expect(edit?.body).toEqual({ visual_prompt: "杯子在窗邊" });
  });

  it("quotes, shows the price and only submits after confirmation, sending the quote back", async () => {
    let polled = 0;
    const calls = studioFetch({
      "GET /studio/projects/p1": () => {
        polled += 1;
        return polled > 1 ? project({ active_op: { op_id: "op9", type: "regenerate", state: "queued" }, queue: { position: 2 } }) : project();
      },
      "POST /studio/projects/p1/quote": (body: unknown) => {
        const { type, target } = body as { type: string; target?: string };
        return quote(type === "render" ? 4 : 2, type, target ?? null);
      },
      "POST /studio/projects/p1/ops": () => Response.json({ op_id: "op9", state: "submitted" }, { status: 202 }),
    });
    inFrame(<StudioEditor projectId="p1" />);
    await screen.findByLabelText("畫面描述");
    await waitFor(() => expect(screen.getByRole("button", { name: "產生全部（4 點）" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "重新產生這一鏡" }));
    const dialog = await screen.findByRole("dialog", { name: "確認：重新產生第 1 鏡" });
    expect(within(dialog).getByTestId("quote-total")).toHaveTextContent("2 點");
    expect(dialog).toHaveTextContent("目前可用 120 點，完成後約剩 118 點");
    expect(calls.some((call) => call.path === "/studio/projects/p1/ops")).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "確認（2 點）" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const submit = calls.find((call) => call.path === "/studio/projects/p1/ops");
    const body = submit?.body as Record<string, unknown>;
    expect(body).toMatchObject({ quote_id: "q_regenerate_2", type: "regenerate", target: "1", credits: 2, storyboard_rev: 3, exp: 9999999999, sig: "a".repeat(64) });
    expect(String(body.idempotency_key)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(await screen.findByText(/排隊中，第 2 位/)).toBeInTheDocument();
  });

  it("re-quotes once when the quote went stale and asks again", async () => {
    let quotes = 0;
    const calls = studioFetch({
      "GET /studio/projects/p1": project(),
      "POST /studio/projects/p1/quote": (body: unknown) => {
        if ((body as { type: string }).type !== "regenerate") return quote(4, "render", null);
        quotes += 1;
        return quote(quotes === 1 ? 2 : 3, "regenerate", "1", quotes === 1 ? 3 : 4);
      },
      "POST /studio/projects/p1/ops": fail(409, "studio_stale_quote"),
    });
    inFrame(<StudioEditor projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: "重新產生這一鏡" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "確認（2 點）" }));
    expect(await within(dialog).findByText("內容在報價後有變更，以下是更新後的價格。")).toBeInTheDocument();
    expect(within(dialog).getByTestId("quote-total")).toHaveTextContent("3 點");
    const submits = calls.filter((call) => call.path === "/studio/projects/p1/ops");
    expect(submits).toHaveLength(1);
  });

  it("hides the internal voice from customers and labels it for admins", async () => {
    studioFetch({ "GET /studio/projects/p1": project() });
    const view = inFrame(<StudioEditor projectId="p1" />);
    await userEvent.click(await screen.findByRole("tab", { name: "專案設定" }));
    const voice = screen.getByLabelText("配音");
    expect(within(voice).queryByRole("option", { name: /內部測試/ })).not.toBeInTheDocument();
    view.unmount();
    vi.unstubAllGlobals();

    studioFetch({ "GET /studio/projects/p1": project() }, "admin");
    inFrame(<StudioEditor projectId="p1" />);
    await userEvent.click(await screen.findByRole("tab", { name: "專案設定" }));
    expect(within(screen.getByLabelText("配音")).getByRole("option", { name: "內部測試" })).toBeInTheDocument();
  });

  it("requires the music rights checkbox before saving music", async () => {
    const calls = studioFetch({
      "GET /studio/projects/p1": project({ settings: { voice: "studio_female", subtitles: true, music_upload_id: "u_m1", music_rights_confirmed: false } }),
    });
    inFrame(<StudioEditor projectId="p1" />);
    await userEvent.click(await screen.findByRole("tab", { name: "專案設定" }));
    await userEvent.click(screen.getByLabelText("燒錄字幕"));
    await userEvent.click(screen.getByRole("button", { name: "儲存設定" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("請勾選確認你擁有這首音樂的使用權");
    expect(calls.some((call) => call.path === "/studio/projects/p1/settings")).toBe(false);
  });

  it("enables export only when nothing is stale and offers the download afterwards", async () => {
    const ready = project({
      status: "ready",
      shots: project().shots.map((shot) => ({ ...shot, stale: false, status: "ready" })),
      exports: { "9:16": { url: "https://studio-media.test/media/e/v.mp4?exp=1&sig=x", srt_url: "https://studio-media.test/media/e/v.srt?exp=1&sig=x" }, "16:9": null },
    });
    studioFetch({
      "GET /studio/projects/p1": ready,
      "POST /studio/projects/p1/quote": (body: unknown) => quote(4, (body as { type: string }).type, "16:9", 3),
    });
    inFrame(<StudioEditor projectId="p1" />);
    expect(await screen.findByRole("button", { name: "匯出 9:16" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "產生全部" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "加做 16:9（4 點）" })).toBeEnabled());
    expect(screen.getByRole("link", { name: "下載 MP4（9:16）" })).toHaveAttribute("href", "https://studio-media.test/media/e/v.mp4?exp=1&sig=x&dl=1");
  });

  it("reports what a finished op charged and refunded", async () => {
    let n = 0;
    studioFetch({
      "GET /studio/projects/p1": () => {
        n += 1;
        return n === 1 ? project({ active_op: { op_id: "op5", type: "render", state: "running" } }) : project({ last_op: { op_id: "op5", type: "render", state: "failed", error: { code: "gateway_error" } } });
      },
      "GET /studio/projects/p1/ops/op5": {
        op_id: "op5", project_id: "p1", type: "render", target: null, state: "settled_partial", credits: 12, credits_charged: 8, credits_refunded: 4, error: { code: "gateway_error" }, queue_position: null,
      },
    });
    inFrame(<StudioEditor projectId="p1" />);
    expect(await screen.findByText(/產生中/, { selector: ".studio-progress span" })).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText(/只完成一部分：扣 8 點，退還 4 點/)).toBeInTheDocument();
  });
});

describe("studio credits page", () => {
  it("shows balance, reserved, plan and the ledger in words", async () => {
    studioFetch({
      "GET /studio/credits": {
        balance: 976, reserved: 10, plan: "creator", period_end: null,
        recent: [
          { id: 4, op_id: "op2", kind: "refund", delta: 4, note: "gateway_error", created_at: 1761100300 },
          { id: 3, op_id: "op2", kind: "settle", delta: 0, note: "charged 8", created_at: 1761100200 },
          { id: 2, op_id: "op2", kind: "reserve", delta: -12, note: "render", created_at: 1761100100 },
          { id: 1, op_id: null, kind: "grant", delta: 1000, note: "Creator 10 月", created_at: 1761100000 },
        ],
      },
    });
    window.history.replaceState({}, "", "/studio/credits");
    inFrame(<StudioCreditsPage />);
    expect(await screen.findByTestId("credits-balance")).toHaveTextContent("976");
    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.getByText("每月 1,000 點")).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("退還");
    expect(rows[1]).toHaveTextContent("+4");
    expect(rows[2]).toHaveTextContent("實扣 8 點");
    expect(rows[3]).toHaveTextContent("產生全部");
    expect(rows[3]).toHaveTextContent("−12");
    expect(rows[4]).toHaveTextContent("Creator 10 月");
  });
});

describe("admin studio section", () => {
  it("grants credits to a chosen account and lists usage", async () => {
    const calls = studioFetch(
      {
        "GET /admin/customers": { customers: [{ id: "u7", email: "shop@example.com", name: "Shop", role: "customer", status: "active" }] },
        "POST /admin/studio/credits/grant": { account: { user_id: "u7", balance: 1000, reserved: 0, plan: "creator", period_end: null } },
        [`GET /admin/studio/usage?month=${new Date().toISOString().slice(0, 7)}`]: {
          month: "2026-10", agent_status: "ok", gpu_usd_per_hour: 2.08,
          users: [{ user_id: "u7", email: "shop@example.com", name: "Shop", ops: 3, active_ops: 1, credits_granted: 1000, credits_charged: 34, credits_refunded: 2, agent_ops: 3, credits_quoted: 36, credits_produced: 34, list_cost_usd: 0.62, gpu_seconds: 140, est_gpu_usd: 0.0809 }],
        },
      },
      "admin",
    );
    render(
      <LocaleProvider>
        <AdminStudioSection />
      </LocaleProvider>,
    );
    await userEvent.selectOptions(await screen.findByLabelText("帳號"), "u7");
    await userEvent.type(screen.getByLabelText("點數"), "1000");
    await userEvent.selectOptions(screen.getByLabelText("方案（選填）"), "creator");
    await userEvent.type(screen.getByLabelText(/備註/), "匯款 0412");
    await userEvent.click(screen.getByRole("button", { name: "確認發放" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "發放 1,000 點" }));
    expect(await screen.findByText(/已發放 1,000 點給 shop@example.com/)).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/admin/studio/credits/grant")?.body).toMatchObject({ user_id: "u7", credits: 1000, plan: "creator", note: "匯款 0412" });
    const table = await screen.findByRole("table");
    expect(table).toHaveTextContent("$0.6200");
    expect(table).toHaveTextContent("$0.0809");
    expect(table).toHaveTextContent("（1 進行中）");
  });
});
