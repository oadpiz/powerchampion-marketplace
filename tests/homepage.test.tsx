import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("localizes its proof, model, credit, and compact console details", async () => {
    const user = userEvent.setup();
    renderInShell(<HomeContent />);

    await user.click(screen.getByRole("button", { name: "繁中" }));

    expect(
      screen.getByRole("region", { name: "市集成效數據" }),
    ).toBeInTheDocument();
    expect(screen.getByText("啟用中的模型路由")).toBeInTheDocument();
    expect(screen.getByText("可用上下文")).toBeInTheDocument();
    expect(screen.getByText("展示可用率")).toBeInTheDocument();
    expect(screen.getAllByText("快速")).toHaveLength(2);
    expect(screen.getByText("深度")).toBeInTheDocument();
    expect(screen.getByText("均衡")).toBeInTheDocument();
    expect(screen.getByText("$10 帳戶額度")).toBeInTheDocument();
    expect(screen.getByText("純額隨用隨付額度")).toBeInTheDocument();
    expect(screen.getByText("包含 5% 加碼額度")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "七日用量：18.7M 詞元" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "模型用量分布：Qwen 48%、DeepSeek 31%、Llama 21%",
      }),
    ).toBeInTheDocument();
  });

  it("localizes the full console request units", async () => {
    const user = userEvent.setup();
    renderInShell(<ConsoleView />);

    await user.click(screen.getByRole("button", { name: "繁中" }));

    const recent = screen.getByRole("region", { name: "近期請求" });
    expect(within(recent).getByText("2.8K 詞元")).toBeInTheDocument();
    expect(within(recent).getByText("6.1K 詞元")).toBeInTheDocument();
    expect(within(recent).getByText("1.4K 詞元")).toBeInTheDocument();
  });
});
