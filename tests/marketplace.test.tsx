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
    await user.type(screen.getByRole("searchbox", { name: "Search models" }), "Qwen");
    expect(screen.getByText("Qwen")).toBeInTheDocument();
    expect(screen.queryByText("Llama")).not.toBeInTheDocument();
  });

  it("expands details and exposes availability", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: /MiniMax/i }));
    expect(screen.getByText("pc/minimax-agents")).toBeInTheDocument();
    expect(screen.getByText("Temporarily unavailable")).toBeInTheDocument();
  });

  it("shows all decision facts for an expanded model", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Qwen" }));

    const details = screen.getByRole("region", { name: "Qwen details" });
    expect(details).toHaveTextContent("pc/qwen-coder");
    expect(details).toHaveTextContent("Max output");
    expect(details).toHaveTextContent("32K");
    expect(details).toHaveTextContent("Tool use");
    expect(details).toHaveTextContent("Structured output");
    expect(details).toHaveTextContent("Reasoning");
    expect(details).toHaveTextContent("Streaming");
    expect(details).toHaveTextContent("Provenance review required");
    expect(details).toHaveTextContent("Serving role");
    expect(details).toHaveTextContent("Region not published");
    expect(details).toHaveTextContent("Temporarily unavailable");
    expect(within(details).queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps summary facts visible before expansion", () => {
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    const qwen = screen.getByRole("article", { name: "Qwen" });

    expect(within(qwen).getByText("128K")).toBeVisible();
    expect(within(qwen).getByText((_, element) => normalizedText(element!) === "$0.18 per 1M input")).toBeVisible();
    expect(within(qwen).getByText((_, element) => normalizedText(element!) === "$0.72 per 1M output")).toBeVisible();
  });

  it("renders exact input and output units for every catalog model", () => {
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);

    for (const model of MODEL_CATALOG) {
      const row = screen.getByRole("article", { name: model.name });
      const inputRate = `$${model.inputPerMillion.toFixed(2)} per 1M input`;
      const outputRate = `$${model.outputPerMillion.toFixed(2)} per 1M output`;

      expect(within(row).getByText(model.context)).toBeVisible();
      expect(within(row).getByText((_, element) => normalizedText(element!) === inputRate)).toBeVisible();
      expect(within(row).getByText((_, element) => normalizedText(element!) === outputRate)).toBeVisible();
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
    const qwen = screen.getByRole("button", { name: "Qwen" });
    qwen.focus();
    await user.keyboard("{Enter}");

    expect(qwen).toHaveAttribute("aria-expanded", "true");
    const details = document.getElementById(qwen.getAttribute("aria-controls") ?? "");
    expect(details).not.toHaveAttribute("hidden");
    expect(details).toHaveTextContent("pc/qwen-coder");
  });

  it("keeps a collapsed expansion control connected to its details region", () => {
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    const qwen = screen.getByRole("button", { name: "Qwen" });
    const details = document.getElementById(qwen.getAttribute("aria-controls") ?? "");

    expect(details).toHaveAttribute("hidden");
    expect(details).toHaveAttribute("role", "region");
    expect(details).toHaveTextContent("pc/qwen-coder");
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
    expect(screen.getByText("Illustrative catalog entry for coding and multilingual evaluation.")).toBeVisible();
  });

  it("localizes the expanded details region", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><ModelMarketplace /></SiteShell>
      </LocaleProvider>,
    );
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    await user.click(screen.getByRole("button", { name: "Qwen" }));

    expect(screen.getByRole("region", { name: "Qwen 詳細資料" })).toBeInTheDocument();
  });

  it("clears an empty search result", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
    const search = screen.getByRole("searchbox", { name: "Search models" });
    await user.type(search, "no such model");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(search).toHaveValue("");
    expect(screen.getByText("Qwen")).toBeInTheDocument();
  });
});
