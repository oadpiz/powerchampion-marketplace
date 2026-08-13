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

  it("keeps every featured model decision field visible without an expansion control", () => {
    renderInShell(<HomeContent />);

    const expectedModels = [
      ["Qwen", "$0.18 per 1M input", "$0.72 per 1M output"],
      ["DeepSeek", "$0.27 per 1M input", "$1.10 per 1M output"],
      ["Llama", "$0.16 per 1M input", "$0.64 per 1M output"],
      ["Mistral", "$0.20 per 1M input", "$0.80 per 1M output"],
      ["GLM", "$0.22 per 1M input", "$0.88 per 1M output"],
      ["MiniMax", "$0.24 per 1M input", "$0.96 per 1M output"],
    ] as const;

    for (const [name, inputRate, outputRate] of expectedModels) {
      const row = screen.getByRole("article", { name });
      expect(within(row).getByText("128K")).toBeVisible();
      expect(within(row).getByText("32K")).toBeVisible();
      expect(within(row).getByText(inputRate)).toBeVisible();
      expect(within(row).getByText(outputRate)).toBeVisible();
      expect(within(row).getByText("Review required")).toBeVisible();
      expect(within(row).getByText("In preparation")).toBeVisible();
      expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    }
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
