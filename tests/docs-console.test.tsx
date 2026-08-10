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

    await user.click(screen.getByRole("button", { name: "繁中" }));
    await user.click(screen.getByRole("button", { name: "複製" }));

    expect(writeText).toHaveBeenCalledWith("pc_demo_YOUR_KEY");
    expect(screen.getByRole("status")).toHaveTextContent("無法複製");
    expect(screen.queryByText(/sk-[A-Za-z0-9]{12}/)).not.toBeInTheDocument();
  });
});
