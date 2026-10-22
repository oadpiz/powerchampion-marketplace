import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiReferenceContent } from "../components/api-reference-content";
import { IntegrationBuilder } from "../components/integration-builder";
import { InternationalSite } from "../components/international-site";
import { LocaleProvider } from "../components/locale-provider";
import { ModelComparison } from "../components/model-comparison";
import { ModelDetailContent } from "../components/model-detail-content";
import { ModelMarketplace } from "../components/model-marketplace";
import { PricingCalculator } from "../components/pricing-calculator";
import { buildIntegrationExample } from "../lib/integration-examples";
import { INTERNATIONAL_CONTENT } from "../lib/international-content";
import { INTERNATIONAL_LANGUAGES } from "../lib/languages";
import { estimateModelCost } from "../lib/model-comparison";
import { MODEL_CATALOG, filterModels } from "../lib/models";
import { modelServiceJsonLd } from "../lib/structured-data";

const VIDEO_ID = "wan2.2-ti2v-5b-720p";
const video = MODEL_CATALOG.find((model) => model.id === VIDEO_ID)!;

beforeEach(() => act(() => window.history.replaceState({}, "", "/models")));
afterEach(() => act(() => window.history.replaceState({}, "", "/")));

function normalizedText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim();
}

describe("video model listing", () => {
  it("is a video-category catalog entry priced at US$0.05 per output second", () => {
    expect(video).toBeDefined();
    expect(video.modelId).toBe(VIDEO_ID);
    expect(video.categories).toEqual(["video"]);
    expect(video.inputPerMillion).toBe(0.05);
    expect(video.outputPerMillion).toBe(0);
    expect(filterModels(MODEL_CATALOG, "", "video").map((model) => model.id)).toEqual([VIDEO_ID]);
    expect(filterModels(MODEL_CATALOG, "", "image").map((model) => model.id)).not.toContain(VIDEO_ID);
  });

  it("shows the per-second rate on the models page and filters by the Video category", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    const row = screen.getByRole("article", { name: video.name });
    expect(within(row).getByText((_, element) => normalizedText(element!) === "$0.05 per second of video")).toBeVisible();
    expect(within(row).queryByText(/per 1M/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Video" }));
    expect(screen.getByRole("article", { name: video.name })).toBeVisible();
    expect(screen.queryByRole("article", { name: "Flux Schnell" })).not.toBeInTheDocument();
  });

  it("describes the async job flow and per-second billing on the detail page", () => {
    act(() => window.history.replaceState({}, "", `/models/${VIDEO_ID}`));
    render(<LocaleProvider><ModelDetailContent model={video} /></LocaleProvider>);
    expect(screen.getByText("/v1/videos")).toBeVisible();
    expect(screen.getByText("$0.05")).toBeVisible();
    expect(screen.getByText("per second of video")).toBeVisible();
    expect(screen.getByText("10 seconds of video")).toBeVisible();
    expect(screen.getByText(/POST \/v1\/videos, poll GET \/v1\/videos\/\{id\}/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Open in playground" })).not.toBeInTheDocument();
    expect(screen.queryByText("per 1M output tokens")).not.toBeInTheDocument();
    expect(screen.getByText("Video", { selector: ".md-category-line span" })).toBeVisible();
  });

  it("shows the Traditional Chinese unit and category on the detail page", () => {
    localStorage.setItem("pc-locale", "zh");
    act(() => window.history.replaceState({}, "", `/models/${VIDEO_ID}`));
    render(<LocaleProvider><ModelDetailContent model={video} /></LocaleProvider>);
    localStorage.removeItem("pc-locale");
    expect(screen.getByText("每秒影片")).toBeVisible();
    expect(screen.getByText("10 秒影片")).toBeVisible();
    expect(screen.getByText("影片", { selector: ".md-category-line span" })).toBeVisible();
  });

  it("names the billing unit in the calculator note", async () => {
    const user = userEvent.setup();
    act(() => window.history.replaceState({}, "", "/pricing"));
    render(<LocaleProvider><PricingCalculator /></LocaleProvider>);
    await user.selectOptions(screen.getByLabelText("Select a model"), VIDEO_ID);
    expect(screen.getByText(/Wan 2.2 TI2V-5B 720p is billed per second of video at \$0\.05 each/)).toBeVisible();
  });

  it("estimates video cost from seconds and rejects invalid seconds", () => {
    const usage = { input: NaN, output: NaN, images: NaN, minutes: NaN, seconds: 5 };
    expect(estimateModelCost(video, usage)).toBeCloseTo(0.25, 10);
    expect(estimateModelCost(video, { ...usage, seconds: -1 })).toBeNull();
    expect(estimateModelCost(video, { ...usage, seconds: NaN })).toBeNull();
  });

  it("compares video by seconds of output with its own unit", async () => {
    const user = userEvent.setup();
    act(() => window.history.replaceState({}, "", "/compare"));
    render(<LocaleProvider><ModelComparison /></LocaleProvider>);
    await user.selectOptions(screen.getByLabelText("Model 3"), VIDEO_ID);
    expect(screen.getByLabelText("Seconds of video")).toHaveValue(60);
    expect(screen.getByText("per second of video")).toBeVisible();
    expect(screen.getByText("$3.00", { selector: "strong" })).toBeVisible();
    await user.clear(screen.getByLabelText("Seconds of video"));
    await user.type(screen.getByLabelText("Seconds of video"), "5");
    expect(screen.getByText("$0.25", { selector: "strong" })).toBeVisible();
  });

  it("generates submit-and-poll examples against /videos without the OpenAI SDK", () => {
    const curl = buildIntegrationExample(VIDEO_ID, "curl");
    expect(curl).toContain("https://b300.powerchampion.ai/v1/videos");
    expect(curl).toContain('"model": "wan2.2-ti2v-5b-720p"');
    expect(curl).toContain('"seconds": 5');
    expect(curl).toContain("GET /v1/videos/{id}");
    const python = buildIntegrationExample(VIDEO_ID, "python");
    expect(python).toContain("import httpx");
    expect(python).not.toContain("openai");
    expect(python).toContain('f"{base}/videos"');
    expect(python).toContain("/content");
    expect(python).toContain("time.sleep(5)");
    const javascript = buildIntegrationExample(VIDEO_ID, "javascript");
    expect(javascript).not.toContain('from "openai"');
    expect(javascript).toContain("`${base}/videos`");
    expect(javascript).toContain("/content");
  });

  it("offers the video model in the integration builder without an SDK install hint", async () => {
    const user = userEvent.setup();
    act(() => window.history.replaceState({}, "", `/integrations?model=${VIDEO_ID}`));
    render(<LocaleProvider><IntegrationBuilder initialModel={VIDEO_ID} /></LocaleProvider>);
    expect(screen.getByLabelText("Model")).toHaveValue(VIDEO_ID);
    expect(screen.getByText("/videos")).toBeVisible();
    expect(screen.getByText(/Video jobs are asynchronous/)).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "JavaScript" }));
    expect(screen.queryByText("npm install openai")).not.toBeInTheDocument();
  });

  it("describes the offer to search engines in seconds of video", () => {
    const data = modelServiceJsonLd(video);
    expect(data.offers.priceSpecification).toMatchObject({ price: "0.05", priceCurrency: "USD", unitText: "second of video" });
  });

  for (const language of INTERNATIONAL_LANGUAGES) {
    it(`prices the video model per second on the ${language} catalog`, () => {
      const copy = INTERNATIONAL_CONTENT[language];
      render(<LocaleProvider><InternationalSite language={language} section="models" /></LocaleProvider>);
      const card = screen.getByRole("article", { name: video.name });
      expect(card).toHaveTextContent("US$0.05");
      expect(card).toHaveTextContent(copy.catalog.second);
      expect(card).toHaveTextContent(copy.modelDescriptions[VIDEO_ID]);
    });
  }
});

describe("video section of the API developer guide", () => {
  beforeEach(() => act(() => window.history.replaceState({}, "", "/docs/api")));

  it("documents the endpoints, price and refund rule from the gateway docs", () => {
    render(<LocaleProvider><ApiReferenceContent gateway={null} /></LocaleProvider>);
    const heading = screen.getByRole("heading", { level: 2, name: "9. Video generation API" });
    expect(heading).toHaveAttribute("id", "video");
    const text = document.body.textContent ?? "";
    for (const expected of [
      "POST /v1/videos",
      "GET /v1/videos/{id}",
      "GET /v1/videos/{id}/content",
      "DELETE /v1/videos/{id}",
      "US$0.05",
      "1280×704",
      "24 fps",
      "1–10 seconds",
      "US$0.252",
      "nothing is charged",
      "6,000,000 bytes",
    ]) expect(text).toContain(expected);
    expect(document.querySelectorAll('a[href="#video"]').length).toBeGreaterThan(0);
  });
});
