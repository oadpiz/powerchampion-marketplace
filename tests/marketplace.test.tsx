import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { ModelMarketplace } from "../components/model-marketplace";
import { SiteShell } from "../components/site-shell";

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
    const narrowRules = css.match(/@media \(max-width: 760px\) \{([\s\S]*?)\n\}/)?.[1];

    expect(narrowRules).toMatch(
      /\.marketplace-rate-unit\s*\{[^}]*display:\s*block;[^}]*font-size:\s*\.8125rem;/,
    );
  });

  it("localizes the expanded details region", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><ModelMarketplace /></SiteShell>
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "繁中" }));
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
