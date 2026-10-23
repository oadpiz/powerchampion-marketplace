import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pollDelay, useStudioProject } from "../components/use-studio-project";
import { PortalError, portalErrorText, safeAccountReturn } from "../lib/portal-client";
import { referrerPolicyFor, isPrivatePath } from "../lib/seo";
import {
  enumOptions,
  isVideoUrl,
  narrationFit,
  downloadUrl,
  isInternalVoice,
  mediaUrl,
  opIsActive,
  partLabel,
  setMediaOrigin,
  studioErrorText,
  uploadFile,
  UploadError,
  validateInputs,
} from "../lib/studio-client";
import { project, studioFetch, template } from "./support/studio-fixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("studio error text", () => {
  const codes: [string, number, string][] = [
    ["studio_unconfigured", 503, "影片工作室尚未開放"],
    ["studio_not_open", 403, "影片工作室尚未開放"],
    ["studio_insufficient_credits", 402, "點數不足"],
    ["studio_busy", 409, "正在處理中"],
    ["studio_needs_render", 409, "產生全部"],
    ["studio_needs_draft", 409, "請先產生分鏡"],
    ["studio_stale_quote", 409, "價格已更新"],
    ["studio_storage_full", 409, "儲存空間"],
    ["studio_conflict", 409, "編號已被使用"],
    ["studio_invalid_input", 400, "內容不符合要求"],
    ["studio_not_found", 404, "找不到這支影片"],
    ["studio_daily_cap", 429, "今日影片產生量已達上限"],
    ["studio_rate_limited", 429, "操作太頻繁"],
    ["studio_too_large", 413, "太大"],
    ["account_disabled", 403, "已被停用"],
    ["service_unavailable", 502, "影片服務暫時無法連線"],
    ["studio_unavailable", 503, "影片服務暫時無法連線"],
    ["studio_voice_not_allowed", 403, "只供內部測試"],
    ["studio_no_licensed_voice", 409, "目前沒有可對外使用的配音"],
  ];
  it.each(codes)("%s has its own text", (code, status, text) => {
    expect(studioErrorText(new PortalError(status, code, "detail"), "zh")).toContain(text);
  });
  it("puts studio codes into the shared portal error text, but not the BFF's generic service_unavailable", () => {
    expect(portalErrorText(new PortalError(402, "studio_insufficient_credits", ""), "en")).toBe("You do not have enough credits for this step.");
    expect(portalErrorText(new PortalError(503, "service_unavailable", ""), "zh")).not.toContain("影片");
  });
  it("names upload failures", () => {
    expect(studioErrorText(new UploadError("size", ""), "zh")).toContain("10 MB");
    expect(studioErrorText(new UploadError("put", ""), "en")).toContain("upload failed");
  });
});

describe("studio routing and headers", () => {
  it("lets sign-in return to studio pages only", () => {
    for (const path of ["/studio", "/studio/new", "/studio/credits", "/studio/p/p0123abc_-"]) expect(safeAccountReturn(path)).toBe(path);
    for (const path of ["/studio/p/", "/studio/p/a/b", "/studio/x", "/studio/p/a%2F..", "//evil.example/studio"]) expect(safeAccountReturn(path)).toBe("/account");
  });
  it("marks studio pages private with a same-origin referrer policy", () => {
    expect(isPrivatePath("/studio/p/p1")).toBe(true);
    expect(referrerPolicyFor("/studio")).toBe("same-origin");
    expect(referrerPolicyFor("/studio/p/p1")).toBe("same-origin");
    expect(referrerPolicyFor("/studios")).toBeNull();
    expect(referrerPolicyFor("/account")).toBeNull();
  });
});

describe("schema helpers", () => {
  it("requires one of the fields named in x-require-one-of and checks URLs", () => {
    const schema = template.input_schema;
    expect(validateInputs(schema, { style: "種草推薦" }, "en")._form).toBe("Fill in at least one of: Topic, Product URL, Images");
    expect(validateInputs(schema, { topic: "cup" }, "en")).toEqual({});
    expect(validateInputs(schema, { image_ids: ["u1"] }, "en")).toEqual({});
    expect(validateInputs(schema, { product_url: "shop.example/cup" }, "zh").product_url).toContain("https://");
    expect(validateInputs(schema, { topic: "x", target_seconds: 90 }, "zh").target_seconds).toContain("30–60");
  });
  it("meters narration against the shot length at the schema's reading speed", () => {
    expect(narrationFit("一二三四五六七八九", 4.5, 2)).toMatchObject({ characters: 9, needed: 2, state: "ok" });
    expect(narrationFit("一二三四五六七八九十", 4.5, 2).state).toBe("over");
    expect(narrationFit("一", 4.5, 4).state).toBe("short");
  });
  it("hides internal voices from customers", () => {
    const voice = template.project_schema.properties!.voice;
    expect(enumOptions("voice", voice, "zh", false).map((o) => o.value)).toEqual(["none", "studio_female"]);
    expect(enumOptions("voice", voice, "zh", true)).toContainEqual({ value: "tw_ref", label: "內部測試", internal: true });
    const annotated = { ...voice, "x-internal-values": ["studio_female"], "x-enum-labels": { studio_female: { zh: "女聲" } } };
    expect(enumOptions("voice", annotated, "zh", true).find((o) => o.value === "studio_female")?.label).toBe("女聲（內部測試）");
  });
  it("names quote lines per asset key", () => {
    const parts = ["image@9:16", "speech", "image", "clip"];
    expect(partLabel("image@9:16", "zh", parts)).toBe("畫面（9:16）");
    expect(partLabel("image", "zh", parts)).toBe("動態鏡頭底圖");
    expect(partLabel("image", "en", ["image", "speech"])).toBe("Picture");
    expect(partLabel("clip", "zh")).toBe("動態影片");
  });
  it("only uses http(s) media URLs on the configured media host", () => {
    setMediaOrigin(null);
    expect(mediaUrl("https://any.test/media/a.png?sig=1")).toBe("https://any.test/media/a.png?sig=1");
    expect(mediaUrl("javascript:alert(1)")).toBeNull();
    expect(mediaUrl("data:image/png;base64,AA")).toBeNull();
    setMediaOrigin("https://studio-media.test/");
    expect(mediaUrl("https://any.test/media/a.png")).toBeNull();
    expect(mediaUrl("https://studio-media.test/media/a.png")).toBe("https://studio-media.test/media/a.png");
    setMediaOrigin(null);
    expect(downloadUrl("https://m.test/e.mp4?exp=1&sig=2")).toBe("https://m.test/e.mp4?exp=1&sig=2&dl=1");
    expect(isInternalVoice({ "x-internal-values": ["v9"] }, "v9")).toBe(true);
    expect(isInternalVoice(undefined, "tw_ref")).toBe(true);
    expect(isInternalVoice(undefined, "studio_female")).toBe(false);
  });
  it("tells clips from stills by the signed URL's path", () => {
    expect(isVideoUrl("https://m.test/media/a/x/clip.mp4?exp=1&sig=a")).toBe(true);
    expect(isVideoUrl("https://m.test/media/a/x/img.png?exp=1&sig=mp4")).toBe(false);
    expect(opIsActive({ state: "unknown" })).toBe(true);
    expect(opIsActive({ state: "settled" })).toBe(false);
  });
});

describe("upload flow", () => {
  it("asks for a ticket with the project, then PUTs the bytes without cookies", async () => {
    const calls = studioFetch({
      "POST /studio/uploads": { upload_id: "u_s1", put_url: "https://media.test/media/upload/t", expires_at: 1 },
      "PUT https://media.test/media/upload/t": () => new Response("{}", { status: 201 }),
    });
    const file = new File([new Uint8Array(10)], "m.wav", { type: "audio/x-wav" });
    await expect(uploadFile(file, "music", "p1")).resolves.toBe("u_s1");
    expect(calls[0].body).toEqual({ purpose: "music", content_type: "audio/wav", bytes: 10, project_id: "p1" });
    expect(calls[1].init).toMatchObject({ method: "PUT", body: file, credentials: "omit" });
  });
  it("fails on a rejected PUT and never asks for a ticket for an oversized file", async () => {
    const calls = studioFetch({
      "POST /studio/uploads": { upload_id: "u", put_url: "https://media.test/media/upload/t", expires_at: 1 },
      "PUT https://media.test/media/upload/t": () => new Response("no", { status: 403 }),
    });
    await expect(uploadFile(new File(["x"], "a.png", { type: "image/png" }), "input_image")).rejects.toMatchObject({ reason: "put" });
    const big = new File([new Uint8Array(10_000_001)], "big.png", { type: "image/png" });
    const before = calls.length;
    await expect(uploadFile(big, "shot_image", "p1")).rejects.toMatchObject({ reason: "size" });
    expect(calls.length).toBe(before);
  });
});

describe("project poll", () => {
  it("polls every 3 s while an op is active, slows to 10 s after 2 minutes, and stops when it settles", async () => {
    vi.useFakeTimers();
    let clock = 0;
    let n = 0;
    const running = project({ active_op: { op_id: "o1", type: "render", state: "running" } });
    const calls = studioFetch({
      "GET /studio/projects/p1": () => {
        n += 1;
        return n >= 50 ? project() : running;
      },
    });
    const gets = () => calls.filter((call) => call.path === "/studio/projects/p1").length;
    const { result } = renderHook(() => useStudioProject("p1", () => clock));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gets()).toBe(1);
    expect(pollDelay(0)).toBe(3000);
    await act(async () => {
      clock += 3000;
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(gets()).toBe(2);
    // The request after two minutes of activity schedules the next one 10 s out.
    await act(async () => {
      clock += 120_000;
      await vi.advanceTimersByTimeAsync(3000);
    });
    const afterLong = gets();
    expect(afterLong).toBe(3);
    await act(async () => {
      clock += 3000;
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(gets()).toBe(afterLong);
    await act(async () => {
      clock += 7000;
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(gets()).toBe(afterLong + 1);
    // Settle: the next document has no active op; polling stops for good.
    n = 49;
    await act(async () => {
      clock += 10_000;
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.project?.active_op).toBeNull();
    const settled = gets();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(gets()).toBe(settled);
  });

  it("keeps polling while the portal reports an unresolved (unknown) op, and stops on 404", async () => {
    vi.useFakeTimers();
    let missing = false;
    const calls = studioFetch({
      "GET /studio/projects/p1": () =>
        missing ? Response.json({ error: "studio_not_found" }, { status: 404 }) : project({ active_op: { op_id: "o1", type: "render", state: "unknown" } }),
    });
    const gets = () => calls.filter((call) => call.path === "/studio/projects/p1").length;
    renderHook(() => useStudioProject("p1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(gets()).toBe(2);
    missing = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(gets()).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(gets()).toBe(3);
  });

  it("does not poll an idle project but reloads it when the tab regains focus", async () => {
    vi.useFakeTimers();
    const calls = studioFetch({ "GET /studio/projects/p1": project() });
    const gets = () => calls.filter((call) => call.path === "/studio/projects/p1").length;
    renderHook(() => useStudioProject("p1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(gets()).toBe(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gets()).toBe(2);
  });
});
