import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiReferenceContent, renderInline } from "../components/api-reference-content";
import { DocsPageContent } from "../components/docs-page-content";
import { LocaleProvider } from "../components/locale-provider";
import { API_REFERENCE_COPY, API_REFERENCE_MODELS } from "../lib/api-reference";
import type { GatewayStatus } from "../lib/gateway-status";
import { metadata as apiReferenceMetadata } from "../app/docs/api/page";
import { PUBLIC_ROUTES } from "../lib/seo";

const MODEL_IDS = [
  "glm-5.2-fp8",
  "glm-5.3-flash-uncensored",
  "qwen3-vl-30b",
  "bge-m3",
  "bge-reranker-v2-m3",
  "flux-schnell",
  "chroma1-hd",
  "indextts2",
  "whisper-large-v3",
];

const SECTION_IDS = ["quick-start", "models", "auth", "endpoints", "billing", "errors", "support"];

// Text from the manual's internal-only section and its header note. None of it
// may ever reach the public page, in either language.
const INTERNAL_MARKERS = [
  /平台優化建議/,
  /勿對外/,
  /內部用/,
  /對外發布前要拿掉/,
  /max_inflight/,
  /api-audit/,
  /systemd/,
  /SSRF/,
  /b300-14/,
  /\bB1\b|\bB2\b|\bP1\b|\bS1\b/,
];

function renderPage(gateway: GatewayStatus | null = null) {
  return render(<LocaleProvider><ApiReferenceContent gateway={gateway} /></LocaleProvider>);
}

describe("API reference page", () => {
  beforeEach(() => window.history.replaceState({}, "", "/docs/api"));
  afterEach(() => localStorage.removeItem("pc-locale"));

  it("renders the English reference with every section, a table of contents, and all nine models", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "API reference" })).toBeVisible();
    for (const heading of [
      "Quick start",
      "Models and prices",
      "Authentication, keys and rate limits",
      "Endpoint reference",
      "Billing and balance",
      "Errors, retries and best practices",
      "Support",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }

    const toc = screen.getByRole("navigation", { name: "On this page" });
    expect(within(toc).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(
      SECTION_IDS.map((id) => `#${id}`),
    );
    for (const id of SECTION_IDS) expect(document.getElementById(id)).not.toBeNull();

    const modelsTable = screen.getByRole("region", { name: "Model price table" });
    const rowHeaders = within(modelsTable).getAllByRole("rowheader").map((cell) => cell.textContent);
    expect(rowHeaders).toEqual(MODEL_IDS);
    expect(API_REFERENCE_MODELS.map((model) => model.id)).toEqual(MODEL_IDS);
  });

  it("renders the Traditional Chinese reference from the saved locale", async () => {
    localStorage.setItem("pc-locale", "zh");
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "API 參考手冊" })).toBeVisible();
    for (const heading of ["快速開始", "模型與價格", "驗證、金鑰與限流", "端點參考", "計費與餘額", "錯誤碼、重試與最佳實務", "支援"]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
    expect(screen.getByRole("navigation", { name: "本頁內容" })).toBeVisible();
    const modelsTable = screen.getByRole("region", { name: "模型價格表" });
    expect(within(modelsTable).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(MODEL_IDS);
  });

  it("never contains internal-only manual content in either language", () => {
    for (const locale of ["en", "zh"] as const) {
      const serialized = JSON.stringify(API_REFERENCE_COPY[locale]);
      for (const marker of INTERNAL_MARKERS) expect(serialized).not.toMatch(marker);
    }
    const { container } = renderPage();
    for (const marker of INTERNAL_MARKERS) expect(container.textContent).not.toMatch(marker);
  });

  it("marks video as unavailable without publishing a video price", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 3, name: "Video — /v1/videos" })).toBeVisible();
    expect(screen.getByText(/Video generation is not available yet/)).toBeVisible();
    for (const locale of ["en", "zh"] as const) {
      const text = JSON.stringify(API_REFERENCE_COPY[locale]);
      expect(text).not.toMatch(/per (?:second|minute) of video|每(?:秒|分鐘)影片/);
    }
  });

  it("shows live readiness when the gateway status is available and falls back otherwise", () => {
    const gateway: GatewayStatus = {
      status: "warn",
      summary: "Partial availability",
      updated: 0,
      uptime_window_days: 30,
      models: [
        { id: "glm-5.2-fp8", name: null, ready: true, context_length: 131072, uptime: 1 },
        { id: "flux-schnell", name: null, ready: false, context_length: 512, uptime: 0 },
      ],
    };
    const { unmount } = renderPage(gateway);
    const table = screen.getByRole("region", { name: "Model price table" });
    const rowFor = (id: string) => within(table).getByRole("rowheader", { name: id }).closest("tr")!;
    expect(within(rowFor("glm-5.2-fp8")).getByText("Online")).toBeVisible();
    expect(within(rowFor("flux-schnell")).getByText("Offline")).toBeVisible();
    expect(within(rowFor("bge-m3")).getByText("Unknown")).toBeVisible();
    unmount();

    renderPage(null);
    expect(screen.getByText(/Live status could not be loaded/)).toBeVisible();
  });

  it("gives every code sample a copy button", () => {
    renderPage();
    const buttons = screen.getAllByRole("button", { name: /^Copy:/ });
    expect(buttons.length).toBe(document.querySelectorAll(".api-ref-code pre").length);
    expect(buttons.length).toBeGreaterThan(10);
  });

  it("renders inline code and links from copy strings", () => {
    const { container } = render(<p>{renderInline("Use `max_tokens` and see [Pricing](/pricing).")}</p>);
    expect(container.querySelector("code")?.textContent).toBe("max_tokens");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/pricing");
  });

  it("is linked from /docs and published as a public route with metadata", () => {
    window.history.replaceState({}, "", "/docs");
    render(<LocaleProvider><DocsPageContent gateway={null} /></LocaleProvider>);
    expect(screen.getByRole("link", { name: "Full API reference" })).toHaveAttribute("href", "/docs/api");

    expect(PUBLIC_ROUTES).toContain("/docs/api");
    expect(apiReferenceMetadata).toMatchObject({ title: "API Reference | Power Champion" });
  });
});
