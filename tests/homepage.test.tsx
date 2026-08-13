import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
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
  it("routes the hero through token-rate comparison and deployment review", () => {
    renderInShell(<HomeContent />);

    const hero = screen.getByRole("region", { name: "Every model.One power core." });
    expect(within(hero).getByRole("link", { name: "Compare token rates" }))
      .toHaveAttribute("href", "/pricing");
    expect(within(hero).getByRole("link", { name: "Deployment review" }))
      .toHaveAttribute("href", "/contact");
    expect(screen.getByText("Token access launching soon")).toBeVisible();
  });

  it("shows derived catalog facts instead of an availability claim", () => {
    renderInShell(<HomeContent />);

    const proof = screen.getByRole("region", { name: "Marketplace facts" });
    expect(within(proof).queryByText("99.98%")).not.toBeInTheDocument();
    expect(within(proof).getByText("6")).toBeVisible();
    expect(within(proof).getByText("128K")).toBeVisible();
    expect(within(proof).getByText("$0.16")).toBeVisible();
  });

  it("uses each model's conservative serving role and unavailable state in both locales", async () => {
    const user = userEvent.setup();
    renderInShell(<HomeContent />);

    const expectedModels = [
      ["Qwen", "$0.18 per 1M input", "$0.72 per 1M output", "Illustrative catalog entry for coding and multilingual evaluation.", "供程式開發與多語言評估使用的示意目錄項目。"],
      ["DeepSeek", "$0.27 per 1M input", "$1.10 per 1M output", "Illustrative catalog entry for reasoning and coding evaluation.", "供推理與程式開發評估使用的示意目錄項目。"],
      ["Llama", "$0.16 per 1M input", "$0.64 per 1M output", "Illustrative catalog entry for general and multilingual evaluation.", "供通用與多語言評估使用的示意目錄項目。"],
      ["Mistral", "$0.20 per 1M input", "$0.80 per 1M output", "Illustrative catalog entry for general and coding evaluation.", "供通用與程式開發評估使用的示意目錄項目。"],
      ["GLM", "$0.22 per 1M input", "$0.88 per 1M output", "Illustrative catalog entry for reasoning and multilingual evaluation.", "供推理與多語言評估使用的示意目錄項目。"],
      ["MiniMax", "$0.24 per 1M input", "$0.96 per 1M output", "Illustrative catalog entry for reasoning and general evaluation.", "供推理與通用評估使用的示意目錄項目。"],
    ] as const;

    for (const [name, inputRate, outputRate, englishRole] of expectedModels) {
      const row = screen.getByRole("article", { name });
      expect(within(row).getByText("128K")).toBeVisible();
      expect(within(row).getByText("32K")).toBeVisible();
      expect(within(row).getByText(inputRate)).toBeVisible();
      expect(within(row).getByText(outputRate)).toBeVisible();
      expect(within(row).getByText("Review required")).toBeVisible();
      expect(within(row).getByText(englishRole)).toBeVisible();
      expect(within(row).getByText("Temporarily unavailable")).toBeVisible();
      expect(within(row).queryByText("In preparation")).not.toBeInTheDocument();
      expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    }

    expect(document.body).not.toHaveTextContent(/tool-enabled production workloads|Agent-ready intelligence/i);

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    for (const [name, , , , chineseRole] of expectedModels) {
      const row = screen.getByRole("article", { name });
      expect(within(row).getByText(chineseRole)).toBeVisible();
      expect(within(row).getByText("暫時無法使用")).toBeVisible();
      expect(within(row).queryByText("準備中")).not.toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(/高效率、支援工具的正式工作負載。|適合複雜產品的代理式智慧。/);
  });

  it("shows the three access steps in their approved order", () => {
    renderInShell(<HomeContent />);

    const access = screen.getByRole("region", { name: "How access works" });
    expect(within(access).getByRole("list").querySelectorAll("h3")).toHaveLength(3);
    expect(Array.from(within(access).getByRole("list").querySelectorAll("h3"), (heading) => heading.textContent))
      .toEqual(["Compare", "Estimate", "Request"]);
  });

  it("bridges enterprise and trust journeys to their public routes", () => {
    renderInShell(<HomeContent />);

    const enterprise = screen.getByRole("region", { name: "Enterprise planning" });
    expect(within(enterprise).getByRole("link", { name: "Review infrastructure context" }))
      .toHaveAttribute("href", "/infrastructure");
    expect(within(enterprise).getByRole("link", { name: "Deployment review" }))
      .toHaveAttribute("href", "/contact");

    const trust = screen.getByRole("region", { name: "Trust and readiness" });
    expect(within(trust).getByRole("link", { name: "Trust boundary" }))
      .toHaveAttribute("href", "/trust");
    expect(within(trust).getByRole("link", { name: "Service status" }))
      .toHaveAttribute("href", "/status");
  });

  it("uses one non-binding launch-access action for the editorial rate section", () => {
    renderInShell(<HomeContent />);

    const access = screen.getByRole("region", { name: "Indicative access" });
    expect(within(access).getAllByRole("button", { name: "Join launch access" })).toHaveLength(1);
    expect(within(access).getByText(
      "Illustrative package values only — requests are local to this demonstration and do not create orders, charges, or reservations.",
    )).toBeVisible();
  });

  it("repeats the primary catalog facts after switching to Traditional Chinese", async () => {
    const user = userEvent.setup();
    renderInShell(<HomeContent />);

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));

    const proof = screen.getByRole("region", { name: "市集事實" });
    expect(within(proof).getByText("6")).toBeVisible();
    expect(within(proof).getByText("128K")).toBeVisible();
    expect(within(proof).getByText("$0.16")).toBeVisible();
    expect(screen.getByText("Token 存取即將推出")).toBeVisible();
  });
});
