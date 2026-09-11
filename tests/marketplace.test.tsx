import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InternationalSite } from "../components/international-site";
import { LocaleProvider } from "../components/locale-provider";
import { ModelMarketplace } from "../components/model-marketplace";
import { SiteShell } from "../components/site-shell";
import { MODEL_CATALOG } from "../lib/models";

beforeEach(() => act(() => window.history.replaceState({}, "", "/models")));
afterEach(() => act(() => window.history.replaceState({}, "", "/")));

function normalizedText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim();
}

describe("ModelMarketplace", () => {
  it("filters by category and search query", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Coding" }));
    await user.type(screen.getByRole("searchbox", { name: "Search models" }), "GLM");
    expect(screen.getByText("GLM 5.2 FP8")).toBeInTheDocument();
    expect(screen.queryByText("Qwen3-VL 30B")).not.toBeInTheDocument();
  });

  it("expands details and exposes availability", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Whisper Large v3" }));
    expect(screen.getByText("whisper-large-v3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check live status" })).toBeInTheDocument();
  });

  it("shows all decision facts for an expanded model", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Qwen3-VL 30B" }));

    const details = screen.getByRole("region", { name: "Qwen3-VL 30B details" });
    expect(details).toHaveTextContent("qwen3-vl-30b");
    expect(details).toHaveTextContent("Max output");
    expect(details).toHaveTextContent("4K");
    expect(details).toHaveTextContent("Tool use");
    expect(details).toHaveTextContent("not published");
    expect(details).toHaveTextContent("Structured output");
    expect(details).toHaveTextContent("Enabled");
    expect(details).toHaveTextContent("Streaming");
    expect(details).toHaveTextContent("Provenance published catalog");
    expect(details).toHaveTextContent("Serving role");
    expect(details).toHaveTextContent("Region TH");
    expect(details).toHaveTextContent("Check live status");
    expect(within(details).getByText("qwen3-vl-30b").closest("code")).toHaveAttribute("translate", "no");
  });

  it("names the search field, disables autofill, and uses an example cue", () => {
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);

    const search = screen.getByRole("searchbox", { name: "Search models" });
    expect(search).toHaveAttribute("name", "model-query");
    expect(search).toHaveAttribute("autocomplete", "off");
    expect(search).toHaveAttribute("placeholder", "Search models…");
  });

  it("keeps summary facts visible before expansion", () => {
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    const qwen = screen.getByRole("article", { name: "Qwen3-VL 30B" });

    expect(within(qwen).getByText("33K")).toBeVisible();
    expect(within(qwen).getByText((_, element) => normalizedText(element!) === "$0.30 per 1M input")).toBeVisible();
    expect(within(qwen).getByText((_, element) => normalizedText(element!) === "$1.20 per 1M output")).toBeVisible();
  });

  it("renders exact input and output units for every catalog model", () => {
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);

    for (const model of MODEL_CATALOG) {
      const row = screen.getByRole("article", { name: model.name });

      expect(within(row).getByText(model.context)).toBeVisible();

      const isImage = model.categories.includes("image");
      const isAudio = model.categories.includes("audio") || model.id.includes("whisper") || model.id.includes("indextts2");

      if (isImage) {
        const inputRate = `$${model.inputPerMillion.toFixed(2)} per image`;
        expect(within(row).getByText((_, element) => normalizedText(element!) === inputRate)).toBeVisible();
      } else if (isAudio) {
        const inputRate = `$${model.inputPerMillion.toFixed(2)} per minute of audio`;
        expect(within(row).getByText((_, element) => normalizedText(element!) === inputRate)).toBeVisible();
      } else {
        const inputRate = `$${model.inputPerMillion.toFixed(2)} per 1M input`;
        const outputRate = `$${model.outputPerMillion.toFixed(2)} per 1M output`;
        expect(within(row).getByText((_, element) => normalizedText(element!) === inputRate)).toBeVisible();
        expect(within(row).getByText((_, element) => normalizedText(element!) === outputRate)).toBeVisible();
      }
    }
  });

  it("shows a useful empty result", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    await user.type(screen.getByRole("searchbox", { name: "Search models" }), "no such model");
    expect(screen.getByText(/No models match/i)).toBeInTheDocument();
  });

  it("lets keyboard users expand a model details region", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    const qwen = screen.getByRole("button", { name: "Qwen3-VL 30B" });
    qwen.focus();
    await user.keyboard("{Enter}");

    expect(qwen).toHaveAttribute("aria-expanded", "true");
    const details = document.getElementById(qwen.getAttribute("aria-controls") ?? "");
    expect(details).not.toHaveAttribute("hidden");
    expect(details).toHaveTextContent("qwen3-vl-30b");
  });

  it("keeps a collapsed expansion control connected to its details region", () => {
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    const qwen = screen.getByRole("button", { name: "Qwen3-VL 30B" });
    const details = document.getElementById(qwen.getAttribute("aria-controls") ?? "");

    expect(details).toHaveAttribute("hidden");
    expect(details).toHaveAttribute("role", "region");
    expect(details).toHaveTextContent("qwen3-vl-30b");
  });

  it("keeps localized rate units visible at narrow widths", async () => {
    const css = await readFile(resolve(process.cwd(), "app/globals.css"), "utf8");
    const narrowRules = css.match(/@media \(max-width: 820px\) \{([\s\S]*?)\n\}/)?.[1];

    expect(narrowRules).toMatch(
      /\.marketplace-rate-unit\s*\{[^}]*display:\s*block;[^}]*font-size:\s*\.8125rem;/,
    );
  });

  it("keeps the model summary visible in compact rows", async () => {
    const css = await readFile(resolve(process.cwd(), "app/globals.css"), "utf8");
    const narrowRules = css.match(/@media \(max-width: 820px\) \{([\s\S]*?)\n\}/)?.[1];

    expect(narrowRules).toMatch(/\.marketplace-tagline\s*\{[^}]*display:\s*block;/);

    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    expect(screen.getByText("Vision and OCR inference for document and image understanding.")).toBeVisible();
  });

  it("links to the Traditional Chinese catalog and preserves model prices and detail links", async () => {
    const user = userEvent.setup();
    const english = render(
      <LocaleProvider>
        <SiteShell><ModelMarketplace /></SiteShell>
      </LocaleProvider>,
    );
    const header = within(screen.getByRole("banner"));
    await user.click(header.getByRole("button", { name: "Language: English" }));
    expect(header.getByRole("link", { name: "繁體中文" })).toHaveAttribute("href", "/zh-Hant/models");
    expect(header.queryByRole("button", { name: "繁體中文" })).not.toBeInTheDocument();
    english.unmount();

    // A regional choice navigates to a new URL and renders its own document.
    act(() => window.history.replaceState({}, "", "/zh-Hant/models"));
    render(<LocaleProvider><InternationalSite language="zh-Hant" section="models" /></LocaleProvider>);

    expect(screen.getByRole("heading", { level: 1, name: "為每個任務，找到合適模型。" })).toBeVisible();
    const qwen = within(screen.getByRole("article", { name: "Qwen3-VL 30B" }));
    expect(qwen.getByText("US$0.30")).toBeVisible();
    expect(qwen.getByText("US$1.20")).toBeVisible();
    expect(qwen.getByText("每百萬詞元")).toBeVisible();
    expect(qwen.getByRole("link", { name: /模型詳情.*Qwen3-VL 30B/ })).toHaveAttribute("href", "/models/qwen3-vl-30b");
    expect(screen.getByText(/可用性請以服務狀態及實際 API 回應為準/)).toBeVisible();
  });

  it("clears an empty search result", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    const search = screen.getByRole("searchbox", { name: "Search models" });
    await user.type(search, "no such model");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(search).toHaveValue("");
    expect(screen.getByText("Qwen3-VL 30B")).toBeInTheDocument();
  });
});
