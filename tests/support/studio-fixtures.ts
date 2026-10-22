/** Fixtures for the video studio UI tests: the ecommerce template's schemas as the agent describes them (S1). */
import { vi } from "vitest";
import type { StudioProject, StudioTemplate } from "../../lib/studio-client";

export const template: StudioTemplate = {
  id: "ecommerce",
  version: 1,
  title: { zh: "電商商品影片", en: "Product video" },
  aspects: ["9:16", "16:9"],
  ops: [],
  prices: { draft: 2, image: 1, speech: 1, clip: 8 },
  input_schema: {
    type: "object",
    properties: {
      topic: { type: "string", maxLength: 1000, title: { zh: "主題", en: "Topic" } },
      product_url: { type: "string", maxLength: 2000, format: "uri", title: { zh: "商品網址", en: "Product URL" } },
      style: { type: "string", enum: ["種草推薦", "痛點解方", "開箱快剪"], default: "種草推薦", title: { zh: "風格", en: "Style" } },
      target_seconds: { type: "integer", minimum: 30, maximum: 60, default: 45, title: { zh: "目標秒數", en: "Target seconds" } },
      image_ids: { type: "array", maxItems: 5, items: { type: "string" }, "x-upload-purpose": "input_image", title: { zh: "商品圖片", en: "Images" } },
    },
    "x-require-one-of": ["topic", "product_url", "image_ids"],
  },
  shot_schema: {
    type: "object",
    properties: {
      visual_prompt: { type: "string", minLength: 1, maxLength: 1000, title: { zh: "畫面描述", en: "Visual prompt" } },
      narration: { type: "string", minLength: 1, maxLength: 500, "x-chars-per-second": 4.5, title: { zh: "旁白", en: "Narration" } },
      kind: { type: "string", enum: ["image", "video"], title: { zh: "鏡頭類型", en: "Kind" } },
      seconds: { type: "number", minimum: 2, maximum: 8, "x-fixed-for-kind": { video: 5 }, title: { zh: "秒數", en: "Seconds" } },
      image_upload_id: { type: ["string", "null"], "x-upload-purpose": "shot_image", title: { zh: "換圖", en: "Image" } },
    },
  },
  project_schema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 200 },
      voice: { type: "string", enum: ["tw_ref", "studio_female"] },
      subtitles: { type: "boolean", default: true },
      music_upload_id: { type: ["string", "null"], "x-upload-purpose": "music" },
      music_rights_confirmed: { type: "boolean", default: false },
    },
  },
};

const media = (key: string) => `https://studio-media.test/media/a/${key}?exp=1&sig=${"0".repeat(64)}`;

export function project(overrides: Partial<StudioProject> = {}): StudioProject {
  return {
    id: "p1",
    template_id: "ecommerce",
    title: "保溫杯開箱",
    status: "draft_ready",
    aspect: "9:16",
    aspects: ["9:16"],
    storyboard_rev: 3,
    queue: null,
    active_op: null,
    last_op: null,
    total_seconds: 30,
    shots: [
      { index: 1, kind: "image", seconds: 4, visual_prompt: "杯子放在木桌上", narration: "早上一杯熱咖啡，整天都有精神。", image_upload_id: null, stale: true, status: "stale", thumb_url: null, preview_url: null, selfcheck: null },
      {
        index: 2,
        kind: "video",
        seconds: 5,
        visual_prompt: "倒熱水",
        narration: "保溫十二小時。",
        image_upload_id: null,
        stale: false,
        status: "ready",
        thumb_url: media("t2.png"),
        preview_url: media("c2.mp4"),
        selfcheck: { verdict: "review", garbled_text: true, deformity: false, logo_or_trademark: false, notes: "", validated: false },
      },
    ],
    settings: { voice: "studio_female", subtitles: true, music_upload_id: null, music_rights_confirmed: false },
    exports: { "9:16": null, "16:9": null },
    ...overrides,
  };
}

export const quote = (credits: number, type = "regenerate", target: string | null = "1", rev = 3) => ({
  quote_id: `q_${type}_${credits}`,
  type,
  target,
  credits,
  breakdown: [
    { part: "image", count: 1, credits: 1 },
    { part: "speech", count: 1, credits: credits - 1 },
  ],
  storyboard_rev: rev,
  exp: 9999999999,
  sig: "a".repeat(64),
});

export const credits = { balance: 120, reserved: 0, plan: "creator", period_end: null, recent: [] };

export type Call = { method: string; path: string; body: unknown; url: string; init?: RequestInit };
type Route = unknown | ((body: unknown, call: Call) => unknown);

/** Stubs fetch with "METHOD /path" routes under /api/portal, plus absolute URLs (the media host). */
export function studioFetch(routes: Record<string, Route>, role: "customer" | "admin" = "customer") {
  const calls: Call[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.startsWith("/api/portal") ? url.replace("/api/portal", "") : url;
    const method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else body = init?.body;
    const call = { method, path, body, url, init };
    calls.push(call);
    const key = `${method} ${path}`;
    if (!(key in routes)) {
      if (path === "/session") return Response.json({ user: { id: "u1", email: "a@example.com", name: "A", role } });
      if (path === "/studio/credits") return Response.json(credits);
      if (path === "/studio/templates") return Response.json({ items: [template] });
      return Response.json({ error: "not_found", detail: "no route" }, { status: 404 });
    }
    const route = routes[key];
    const value = await (typeof route === "function" ? (route as (body: unknown, call: Call) => unknown)(body, call) : route);
    return value instanceof Response ? value : Response.json(value);
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

export const fail = (status: number, error: string) => Response.json({ error, detail: "x" }, { status });
