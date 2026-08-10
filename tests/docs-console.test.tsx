import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeSamples } from "../components/code-samples";
import { ConsoleView } from "../components/console-view";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

describe("CodeSamples", () => {
  it("switches languages and confirms local copy", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<LocaleProvider><CodeSamples /></LocaleProvider>);

    await user.click(screen.getByRole("tab", { name: "Python" }));
    expect(screen.getByText(/from openai import OpenAI/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("does not reveal another key when copying is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<LocaleProvider><CodeSamples /></LocaleProvider>);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByText("Copy unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/sk-[A-Za-z0-9]{12}/)).not.toBeInTheDocument();
  });

  it("moves between code tabs with arrow keys", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><CodeSamples /></LocaleProvider>);

    const curl = screen.getByRole("tab", { name: "cURL" });
    curl.focus();
    await user.keyboard("{ArrowRight}");

    const python = screen.getByRole("tab", { name: "Python" });
    expect(python).toHaveAttribute("aria-selected", "true");
    expect(python).toHaveFocus();
    expect(screen.getByText(/from openai import OpenAI/)).toBeInTheDocument();
  });

  it("keeps a corresponding panel for every code tab", () => {
    render(<LocaleProvider><CodeSamples /></LocaleProvider>);

    for (const tab of screen.getAllByRole("tab")) {
      const panelId = tab.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;

      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
      if (tab.getAttribute("aria-selected") === "true") {
        expect(panel).not.toHaveAttribute("hidden");
      } else {
        expect(panel).toHaveAttribute("hidden");
      }
    }
  });
});

describe("ConsoleView", () => {
  it("labels the full view as a demo and masks the key", () => {
    render(<LocaleProvider><ConsoleView /></LocaleProvider>);

    expect(screen.getByText("Demo console")).toBeInTheDocument();
    expect(screen.getByText("$184.20")).toBeInTheDocument();
    expect(screen.getByText(/pc_demo_••••••••••••7X4Q/)).toBeInTheDocument();
    expect(screen.queryByText(/sk-[A-Za-z0-9]{12}/)).not.toBeInTheDocument();
  });

  it("renders the explanatory empty state", () => {
    render(<LocaleProvider><ConsoleView empty /></LocaleProvider>);

    expect(screen.getByText(/No usage yet/i)).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Recent requests" })).getByText(/No recent requests yet/i),
    ).toBeInTheDocument();
  });

  it("copies only the demo placeholder and confirms success", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<LocaleProvider><ConsoleView /></LocaleProvider>);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("pc_demo_YOUR_KEY");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("reports Traditional Chinese copy failure without revealing another value", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <LocaleProvider>
        <SiteShell><ConsoleView /></SiteShell>
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    await user.click(screen.getByRole("button", { name: "複製" }));

    expect(writeText).toHaveBeenCalledWith("pc_demo_YOUR_KEY");
    expect(screen.getByRole("status")).toHaveTextContent("無法複製");
    expect(screen.queryByText(/sk-[A-Za-z0-9]{12}/)).not.toBeInTheDocument();
  });

  it("uses one exact model split in compact and full views", () => {
    const { rerender } = render(<LocaleProvider><ConsoleView compact /></LocaleProvider>);

    expect(screen.getByRole("img", {
      name: "Model usage split: Qwen 48 percent, DeepSeek 32 percent, Llama 20 percent",
    })).toBeInTheDocument();
    expect(screen.getByText("48%")).toBeInTheDocument();
    expect(screen.getByText("32%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.queryByText("31%")).not.toBeInTheDocument();
    expect(screen.queryByText("21%")).not.toBeInTheDocument();

    rerender(<LocaleProvider><ConsoleView /></LocaleProvider>);
    expect(screen.getByRole("img", {
      name: "Model usage split: Qwen 48 percent, DeepSeek 32 percent, Llama 20 percent",
    })).toBeInTheDocument();
  });

  it("shows exact localized seven-day token and illustrative spend data", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><ConsoleView compact /></SiteShell>
      </LocaleProvider>,
    );

    expect(screen.getByText("Illustrative spend: $13.46")).toBeVisible();
    expect(screen.getByRole("img", {
      name: "Seven-day illustrative usage: 18.7 million tokens; illustrative spend $13.46. Daily trend: Mon 2.1M tokens / $1.36, Tue 2.4M tokens / $1.58, Wed 2.3M tokens / $1.49, Thu 2.8M tokens / $2.01, Fri 2.5M tokens / $1.74, Sat 3.1M tokens / $2.43, Sun 3.5M tokens / $2.85",
    })).toBeInTheDocument();

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));

    expect(screen.getByText("展示支出：US$13.46")).toBeVisible();
    expect(screen.getByRole("img", {
      name: "七日展示用量：18.7M 詞元；展示支出 US$13.46。每日趨勢：週一 2.1M 詞元 / US$1.36、週二 2.4M 詞元 / US$1.58、週三 2.3M 詞元 / US$1.49、週四 2.8M 詞元 / US$2.01、週五 2.5M 詞元 / US$1.74、週六 3.1M 詞元 / US$2.43、週日 3.5M 詞元 / US$2.85",
    })).toBeInTheDocument();
  });

  it("uses h2 for every full console subsection after the page h1", () => {
    render(<LocaleProvider><ConsoleView /></LocaleProvider>);

    for (const heading of ["Available balance", "Seven-day usage", "Model split", "Recent requests", "Demo API key"]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });
});
