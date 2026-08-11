import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ConsoleView } from "../components/console-view";
import { HomeContent } from "../components/home-content";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

function renderInShell(content: ReactNode) {
  return render(
    <LocaleProvider>
      <SiteShell>{content}</SiteShell>
    </LocaleProvider>,
  );
}

describe("Power Champion homepage", () => {
  it("labels the package CTAs as launch access", () => {
    renderInShell(<HomeContent />);

    const packages = screen.getByRole("region", { name: "Explore indicative launch packages." });
    expect(within(packages).getAllByRole("button", { name: "Join launch access" })).toHaveLength(3);
    expect(within(packages).queryByRole("button", { name: /^(buy|pay|checkout)/i })).not.toBeInTheDocument();
  });

  it("keeps section headings at least 48px in every responsive rule", async () => {
    const css = await readFile(
      resolve(process.cwd(), "app/globals.css"),
      "utf8",
    );
    const rules = css.matchAll(
      /\.section-intro h2,\s*\.closing-cta h2\s*\{[^}]*font-size:\s*([^;]+);/g,
    );
    const floors = Array.from(rules, ([, value]) => {
      const lengths = Array.from(
        value.matchAll(/([\d.]+)(rem|px)/g),
        ([, amount, unit]) => Number(amount) * (unit === "rem" ? 16 : 1),
      );
      return Math.min(...lengths);
    });

    expect(floors.length).toBeGreaterThan(0);
    expect(floors.every((floor) => floor >= 48)).toBe(true);
  });

  it("localizes its proof, model, credit, and compact console details", async () => {
    const user = userEvent.setup();
    renderInShell(<HomeContent />);

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));

    expect(
      screen.getByRole("region", { name: "市集成效數據" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "交易對手揭露的基礎設施脈絡" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3.1 MW")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看公司脈絡" })).toHaveAttribute("href", "/company");
    expect(screen.getByText("啟用中的模型路由")).toBeInTheDocument();
    expect(screen.getByText("可用上下文")).toBeInTheDocument();
    expect(screen.getByText("展示可用率")).toBeInTheDocument();
    expect(screen.getAllByText("快速")).toHaveLength(2);
    expect(screen.getByText("深度")).toBeInTheDocument();
    expect(screen.getByText("均衡")).toBeInTheDocument();
    expect(screen.getAllByText("展示起始輸入費率")).toHaveLength(4);
    expect(screen.getByText("$0.18 每百萬輸入 Token")).toBeVisible();
    expect(screen.getByText("$10 指示性帳戶額度")).toBeInTheDocument();
    expect(screen.getByText("指示性啟動方案")).toBeInTheDocument();
    expect(screen.getByText("包含 5% 指示性啟動加碼")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /七日展示用量：18\.7M 詞元；展示支出 US\$13\.46。每日趨勢/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "模型用量分布：Qwen 48%、DeepSeek 32%、Llama 20%",
      }),
    ).toBeInTheDocument();
  });

  it("associates one visible illustrative-data disclosure with every proof metric", () => {
    renderInShell(<HomeContent />);

    const proofStrip = screen.getByRole("region", { name: "Marketplace proof points" });
    const disclosureId = proofStrip.getAttribute("aria-describedby");

    expect(disclosureId).toBeTruthy();
    expect(within(proofStrip).getByText("Illustrative data")).toHaveAttribute("id", disclosureId);
    expect(within(proofStrip).getByText("28")).toBeInTheDocument();
    expect(within(proofStrip).getByText("128K+")).toBeInTheDocument();
    expect(within(proofStrip).getByText("99.98%")).toBeInTheDocument();
  });

  it("links the factual home infrastructure brief to Company", () => {
    renderInShell(<HomeContent />);

    const brief = screen.getByRole("region", {
      name: "Infrastructure context from counterparty disclosure",
    });
    const disclosureId = brief.getAttribute("aria-describedby");

    expect(screen.getByText("3.1 MW")).toBeVisible();
    expect(within(brief).getByRole("link", { name: "View company context" }))
      .toHaveAttribute("href", "/company");
    expect(disclosureId).toBeTruthy();
    expect(within(brief).getByText(/Counterparty-reported/)).toHaveAttribute("id", disclosureId);
  });

  it("keeps illustrative starting input rates visible for all four featured models", () => {
    renderInShell(<HomeContent />);

    const expectedRates = [
      ["Qwen", "$0.18 per 1M input"],
      ["DeepSeek", "$0.27 per 1M input"],
      ["Llama", "$0.16 per 1M input"],
      ["Mistral", "$0.20 per 1M input"],
    ] as const;

    for (const [model, rate] of expectedRates) {
      const row = screen.getByRole("article", { name: model });
      expect(within(row).getByText("Illustrative starting input rate")).toBeVisible();
      expect(within(row).getByText(rate)).toBeVisible();
    }
  });

  it("uses the design-specified closing action without changing the Docs heading", () => {
    renderInShell(<HomeContent />);

    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/docs");
    expect(screen.queryByRole("link", { name: "Quick start" })).not.toBeInTheDocument();
    expect(document.getElementById("about")).toBeInstanceOf(HTMLElement);
  });

  it("uses route-appropriate h3 headings in the compact console", () => {
    renderInShell(<HomeContent />);

    expect(screen.getByRole("heading", { level: 3, name: "Available balance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Seven-day usage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Model split" })).toBeInTheDocument();
  });

  it("localizes the full console demo request units", async () => {
    const user = userEvent.setup();
    renderInShell(<ConsoleView />);

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));

    const recent = screen.getByRole("region", { name: "近期請求" });
    expect(within(recent).getByText("Qwen · 18.4K 詞元")).toBeInTheDocument();
    expect(within(recent).getByText("DeepSeek · 42.1K 詞元")).toBeInTheDocument();
    expect(within(recent).getByText("Llama · 9.8K 詞元")).toBeInTheDocument();
  });
});
