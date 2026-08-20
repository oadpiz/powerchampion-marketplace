import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { ModelMarketplace } from "../components/model-marketplace";
import { SiteShell } from "../components/site-shell";
import { MODEL_CATALOG } from "../lib/models";

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
    expect(screen.getByText("Available")).toBeInTheDocument();
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
    expect(details).toHaveTextContent("Provenance live");
    expect(details).toHaveTextContent("Serving role");
    expect(details).toHaveTextContent("Region TH");
    expect(details).toHaveTextContent("Available");
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

  it("localizes the expanded details region", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><ModelMarketplace /></SiteShell>
      </LocaleProvider>,
    );
    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);
    await user.click(screen.getByRole("button", { name: "Qwen3-VL 30B" }));

    expect(screen.getByRole("region", { name: "Qwen3-VL 30B 詳細資料" })).toBeInTheDocument();
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
