import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "../app/page";
import { HomeContent } from "../components/home-content";
import { LocaleProvider } from "../components/locale-provider";
import {
  DEFAULT_FEATURED_TEXT_MODEL_ID,
  FEATURED_TEXT_MODEL_PREFERENCE,
  pickFeaturedTextModel,
} from "../lib/featured-model";
import type { GatewayStatus } from "../lib/gateway-status";

function statusWith(ready: Record<string, boolean>): GatewayStatus {
  return {
    status: "warn",
    summary: "test",
    updated: 0,
    uptime_window_days: 30,
    models: Object.entries(ready).map(([id, isReady]) => ({
      id,
      name: null,
      ready: isReady,
      context_length: null,
      uptime: null,
    })),
  };
}

describe("pickFeaturedTextModel", () => {
  it("prefers glm-5.2-fp8 when it is ready", () => {
    const status = statusWith({ "glm-5.2-fp8": true, "glm-5.3-flash-uncensored": true, "qwen3-vl-30b": true });
    expect(pickFeaturedTextModel(status, FEATURED_TEXT_MODEL_PREFERENCE)).toBe("glm-5.2-fp8");
  });

  it("falls to the second preference when the first is down", () => {
    const status = statusWith({ "glm-5.2-fp8": false, "glm-5.3-flash-uncensored": true, "qwen3-vl-30b": true });
    expect(pickFeaturedTextModel(status, FEATURED_TEXT_MODEL_PREFERENCE)).toBe("glm-5.3-flash-uncensored");
  });

  it("reaches the third preference when only it is ready", () => {
    const status = statusWith({ "glm-5.2-fp8": false, "glm-5.3-flash-uncensored": false, "qwen3-vl-30b": true });
    expect(pickFeaturedTextModel(status)).toBe("qwen3-vl-30b");
  });

  it("returns the first preference, not a blank, when none is ready", () => {
    const status = statusWith({ "glm-5.2-fp8": false, "glm-5.3-flash-uncensored": false, "qwen3-vl-30b": false, "bge-m3": true });
    expect(pickFeaturedTextModel(status, FEATURED_TEXT_MODEL_PREFERENCE)).toBe("glm-5.2-fp8");
    expect(pickFeaturedTextModel(statusWith({}), ["glm-5.3-flash-uncensored", "qwen3-vl-30b"])).toBe("glm-5.3-flash-uncensored");
  });

  it("uses the default model when the status feed is missing", () => {
    expect(DEFAULT_FEATURED_TEXT_MODEL_ID).toBe("glm-5.2-fp8");
    expect(pickFeaturedTextModel(null)).toBe("glm-5.2-fp8");
    expect(pickFeaturedTextModel(undefined, ["glm-5.3-flash-uncensored"])).toBe("glm-5.2-fp8");
    expect(pickFeaturedTextModel({} as GatewayStatus)).toBe("glm-5.2-fp8");
  });
});

describe("homepage featured text model", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("features the online model in the hero, the featured grid, and the code sample", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><HomeContent featuredTextModelId="glm-5.3-flash-uncensored" /></LocaleProvider>);

    expect(within(document.getElementById("hero-model-panel")!).getByText("GLM 5.3 Flash")).toBeInTheDocument();
    const grid = document.querySelector(".pc-model-grid")!;
    expect(within(grid as HTMLElement).getByRole("article", { name: "GLM 5.3 Flash Uncensored" })).toBeInTheDocument();
    expect(within(grid as HTMLElement).queryByRole("article", { name: "GLM 5.2 FP8" })).not.toBeInTheDocument();
    // Vision, image and audio featured cards are unchanged.
    for (const name of ["Qwen3-VL 30B", "Flux Schnell", "Whisper Large v3"]) {
      expect(within(grid as HTMLElement).getByRole("article", { name })).toBeInTheDocument();
    }
    expect(document.body.textContent).toContain('model="glm-5.3-flash-uncensored"');
    expect(document.body.textContent).not.toContain("glm-5.2-fp8");
    await user.click(screen.getByRole("button", { name: "cURL" }));
    expect(screen.getByRole("region", { name: "cURL integration example" })).toHaveTextContent('"model": "glm-5.3-flash-uncensored"');
  });

  it("reads gateway status on the server to choose the featured model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(statusWith({ "glm-5.2-fp8": false, "glm-5.3-flash-uncensored": true })), { status: 200 }),
      ),
    );
    const page = await Home();
    vi.unstubAllGlobals();
    render(<LocaleProvider>{page}</LocaleProvider>);
    expect(within(document.getElementById("hero-model-panel")!).getByText("GLM 5.3 Flash")).toBeInTheDocument();
  });

  it("keeps the default model when the gateway is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const page = await Home();
    vi.unstubAllGlobals();
    render(<LocaleProvider>{page}</LocaleProvider>);
    expect(within(document.getElementById("hero-model-panel")!).getByText("GLM 5.2")).toBeInTheDocument();
  });
});
