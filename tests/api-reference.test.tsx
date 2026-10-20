import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiReferenceContent, renderInline } from "../components/api-reference-content";
import { DocsPageContent } from "../components/docs-page-content";
import { LocaleProvider } from "../components/locale-provider";
import { API_REFERENCE_COPY, API_REFERENCE_MODEL_IDS } from "../lib/api-reference";
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

const SECTION_IDS = [
  "overview",
  "quick-start",
  "auth",
  "models",
  "chat",
  "text-apis",
  "images",
  "audio",
  "billing",
  "rate-limits",
  "errors",
  "best-practices",
  "appendix",
];

const HEADINGS = {
  en: [
    "1. Overview",
    "2. Quick start",
    "3. Authentication and key management",
    "4. Model catalog and pricing",
    "5. Chat API",
    "6. Completions, embeddings and reranking APIs",
    "7. Image generation API",
    "8. Text-to-speech and speech recognition APIs",
    "9. Billing: credit, balance and usage",
    "10. Rate limits and quotas",
    "11. Error handling",
    "12. Best practices and security",
    "13. Appendix",
  ],
  zh: [
    "1. 概覽",
    "2. 快速開始",
    "3. 驗證與金鑰管理",
    "4. 模型目錄與價格",
    "5. 對話 API",
    "6. 文字補全、向量與重排序 API",
    "7. 圖片生成 API",
    "8. 語音合成與語音辨識 API",
    "9. 帳務：儲值、餘額與用量",
    "10. 限流與配額",
    "11. 錯誤處理",
    "12. 最佳實務與安全建議",
    "13. 附錄",
  ],
} as const;

const MODEL_TABLES = {
  en: ["Language and vision models", "Retrieval models", "Generation and speech models"],
  zh: ["語言與視覺模型", "檢索模型", "生成與語音模型"],
} as const;

const CHECK_ORDER = [
  ["1", "401"],
  ["2", "400"],
  ["3", "403"],
  ["4", "404"],
  ["5", "503"],
  ["6", "429"],
  ["7", "402"],
  ["8", "429"],
  ["9", "429"],
  ["10", "429"],
  ["11", /^400 (or|或) 502$/],
] as const;

// Text from the manual's internal-only material. None of it may ever reach the
// public page, in either language.
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

const REVIEWER_MESSAGE = "Reviewer API key is not permitted for this endpoint or model.";

function renderPage(gateway: GatewayStatus | null = null) {
  return render(<LocaleProvider><ApiReferenceContent gateway={gateway} /></LocaleProvider>);
}

function modelRowHeaders(labels: readonly string[]) {
  return labels.flatMap((label) =>
    within(screen.getByRole("region", { name: label })).getAllByRole("rowheader").map((cell) => cell.textContent),
  );
}

function checkOrderRows(label: string) {
  const table = screen.getByRole("region", { name: label });
  return within(table).getAllByRole("row").slice(1).map((row) => {
    const cells = row.querySelectorAll("th, td");
    return [cells[0].textContent, cells[2].textContent];
  });
}

describe("API developer guide page", () => {
  beforeEach(() => window.history.replaceState({}, "", "/docs/api"));
  afterEach(() => localStorage.removeItem("pc-locale"));

  it("renders the English guide with all 13 sections, a table of contents, and all nine models", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Power Champion API Developer Guide" })).toBeVisible();
    expect(screen.getByText("Version 1.0 · 2026-10-20")).toBeVisible();
    for (const heading of HEADINGS.en) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }

    const toc = screen.getByRole("navigation", { name: "On this page" });
    const tocLinks = within(toc).getAllByRole("link");
    expect(tocLinks.map((link) => link.getAttribute("href"))).toEqual(SECTION_IDS.map((id) => `#${id}`));
    expect(tocLinks.map((link) => link.textContent)).toEqual([...HEADINGS.en]);
    for (const id of SECTION_IDS) expect(document.getElementById(id)?.tagName).toBe("H2");

    expect(modelRowHeaders(MODEL_TABLES.en)).toEqual(MODEL_IDS);
    expect([...API_REFERENCE_MODEL_IDS]).toEqual(MODEL_IDS);
  });

  it("renders the Traditional Chinese guide from the saved locale", async () => {
    localStorage.setItem("pc-locale", "zh");
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Power Champion API 開發者手冊" })).toBeVisible();
    expect(screen.getByText("版本 1.0 · 2026-10-20")).toBeVisible();
    for (const heading of HEADINGS.zh) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
    const toc = screen.getByRole("navigation", { name: "本頁內容" });
    expect(within(toc).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(SECTION_IDS.map((id) => `#${id}`));
    expect(modelRowHeaders(MODEL_TABLES.zh)).toEqual(MODEL_IDS);
  });

  it("uses the same section and sub-heading anchors in both languages, with no duplicates", () => {
    const anchors = (locale: "en" | "zh") =>
      API_REFERENCE_COPY[locale].sections.flatMap((section) => [
        section.id,
        ...section.blocks.flatMap((block) => (block.kind === "h3" ? [block.id] : [])),
      ]);
    expect(anchors("zh")).toEqual(anchors("en"));
    expect(new Set(anchors("en")).size).toBe(anchors("en").length);
  });

  it("keeps the key facts from the manual in both languages", async () => {
    const { unmount } = renderPage();
    let text = document.body.textContent ?? "";
    expect(text).toMatch(/up to 25 MB/);
    expect(text).toContain("Retry-After");
    expect(text).toContain("Prepaid balance exhausted");
    expect(text).toContain("Daily token quota exhausted");
    expect(text).toContain("sk-b300-");
    expect(text).toContain("pip install openai");
    expect(text).toContain("npm install openai");
    expect(text).toMatch(/Node\.js 18 or later, running as ESM/);
    expect(screen.getByRole("heading", { level: 3, name: "Check order" })).toBeVisible();
    for (const [index, [order, status]] of checkOrderRows("Check order").entries()) {
      expect(order).toBe(CHECK_ORDER[index][0]);
      expect(status).toMatch(CHECK_ORDER[index][1]);
    }
    expect(checkOrderRows("Check order")).toHaveLength(11);
    unmount();

    localStorage.setItem("pc-locale", "zh");
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Power Champion API 開發者手冊" });
    text = document.body.textContent ?? "";
    expect(text).toContain("最大 25 MB");
    expect(text).toContain("Retry-After");
    expect(text).toContain("402 Prepaid balance exhausted");
    expect(text).toContain("pip install openai");
    expect(text).toMatch(/需 Node\.js 18 以上，並以 ESM 執行/);
    expect(screen.getByRole("heading", { level: 3, name: "檢查順序" })).toBeVisible();
    expect(checkOrderRows("檢查順序")).toHaveLength(11);
    for (const [index, [order, status]] of checkOrderRows("檢查順序").entries()) {
      expect(order).toBe(CHECK_ORDER[index][0]);
      expect(status).toMatch(CHECK_ORDER[index][1]);
    }
  });

  it("includes the retry snippet and response examples as copyable code", () => {
    renderPage();
    const blocks = [...document.querySelectorAll(".api-ref-code pre")].map((pre) => pre.textContent ?? "");
    expect(blocks.some((code) => code.includes("RETRYABLE = {429, 502, 503}") && code.includes("def with_retry(call, attempts=4):"))).toBe(true);
    expect(blocks.some((code) => code.includes('"object": "chat.completion"'))).toBe(true);
    expect(blocks.some((code) => code.includes('"relevance_score": 0.9821'))).toBe(true);
    expect(blocks.some((code) => code.includes('"type": "rate_limit_error"'))).toBe(true);
    const labels = [...document.querySelectorAll(".api-ref-code figcaption")].map((caption) => caption.textContent);
    expect(new Set(labels)).toEqual(new Set(["bash", "python", "javascript", "json", "http"]));
  });

  it("mentions Reviewer only inside the quoted 403 error message", () => {
    for (const locale of ["en", "zh"] as const) {
      const serialized = JSON.stringify(API_REFERENCE_COPY[locale]);
      expect(serialized.match(/Reviewer/g)).toHaveLength(1);
      expect(serialized).toContain(REVIEWER_MESSAGE);
    }
    renderPage();
    expect((document.body.textContent ?? "").split("Reviewer").length - 1).toBe(1);
    expect(screen.getByText(REVIEWER_MESSAGE).tagName).toBe("CODE");
  });

  it("never contains internal-only manual content in either language", () => {
    for (const locale of ["en", "zh"] as const) {
      const serialized = JSON.stringify(API_REFERENCE_COPY[locale]);
      for (const marker of INTERNAL_MARKERS) expect(serialized).not.toMatch(marker);
    }
    const { container } = renderPage();
    for (const marker of INTERNAL_MARKERS) expect(container.textContent).not.toMatch(marker);
  });

  it("lists video generation as unsupported without publishing a video price", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 3, name: "B. Not currently supported" })).toBeVisible();
    expect(screen.getByText("Video generation.")).toBeVisible();
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
    const rowFor = (table: string, id: string) =>
      within(screen.getByRole("region", { name: table })).getByRole("rowheader", { name: id }).closest("tr")!;
    expect(within(rowFor("Language and vision models", "glm-5.2-fp8")).getByText("Online")).toBeVisible();
    expect(within(rowFor("Generation and speech models", "flux-schnell")).getByText("Offline")).toBeVisible();
    expect(within(rowFor("Retrieval models", "bge-m3")).getByText("Unknown")).toBeVisible();
    expect(screen.getAllByRole("columnheader", { name: "Status now" })).toHaveLength(3);
    expect(screen.getByText(/comes from the live status feed/)).toBeVisible();
    unmount();

    renderPage(null);
    expect(screen.getByText(/Live status could not be loaded/)).toBeVisible();
  });

  it("gives every code sample a copy button", () => {
    renderPage();
    const buttons = screen.getAllByRole("button", { name: /^Copy:/ });
    expect(buttons.length).toBe(document.querySelectorAll(".api-ref-code pre").length);
    expect(buttons.length).toBeGreaterThan(25);
  });

  it("renders bold, inline code and links from copy strings", () => {
    const { container } = render(<p>{renderInline("**Set `max_tokens`** and see [Pricing](/pricing).")}</p>);
    expect(container.querySelector("strong")?.textContent).toBe("Set max_tokens");
    expect(container.querySelector("strong code")?.textContent).toBe("max_tokens");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/pricing");
    expect(container.textContent).not.toContain("**");
  });

  it("leaves no raw markdown markers in the rendered page", () => {
    const { container } = renderPage();
    const prose = container.cloneNode(true) as HTMLElement;
    prose.querySelectorAll("pre").forEach((pre) => pre.remove());
    expect(prose.textContent).not.toMatch(/\*\*|\]\(/);
  });

  it("is linked from /docs and published as a public route with metadata", () => {
    window.history.replaceState({}, "", "/docs");
    render(<LocaleProvider><DocsPageContent gateway={null} /></LocaleProvider>);
    expect(screen.getByRole("link", { name: "Full API reference" })).toHaveAttribute("href", "/docs/api");

    expect(PUBLIC_ROUTES).toContain("/docs/api");
    expect(apiReferenceMetadata).toMatchObject({ title: "API Reference | Power Champion" });
    expect(String(apiReferenceMetadata.description)).toMatch(/developer guide/);
  });
});
