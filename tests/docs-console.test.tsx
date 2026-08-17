import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeSamples } from "../components/code-samples";
import { modelFeatureGateState } from "../components/docs-page-content";
import { ConsoleView } from "../components/console-view";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";
import DocsPage, { metadata as docsMetadata } from "../app/docs/page";
import ConsolePage, { metadata as consoleMetadata } from "../app/console/page";

describe("CodeSamples", () => {
  it("separates quick start from protected access and shows the live boundary notice", () => {
    render(<LocaleProvider><DocsPage /></LocaleProvider>);

    expect(screen.getAllByRole("region", { name: "Quick start" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Protected access" })).toBeVisible();
    expect(screen.getByText(/Live — the endpoint below is operational/i)).toBeVisible();
    expect(screen.getByText("API key")).toBeVisible();
    expect(screen.getByRole("link", { name: /request yours by email/i })).toHaveAttribute("href", "#protected-access-title");
  });

  it("shows all release gates with their readiness state", () => {
    render(<LocaleProvider><DocsPage /></LocaleProvider>);

    const gatesList = document.querySelector(".docs-release-gates ul");
    expect(gatesList).not.toBeNull();
    const items = Array.from(gatesList!.querySelectorAll("li"));
    expect(items).toHaveLength(6);
    for (const item of items) {
      const label = item.textContent?.replace(/\s+/g, " ").trim();
      expect(label).toMatch(/^(Streaming|Usage accounting|Tool use|Structured output|Provider manifest|Operational status): (Ready|Not ready)$/);
    }
  });

  it("fails closed when inference, model availability, or a feature prerequisite is missing", () => {
    const enabledModel = { available: true, features: { streaming: true, tools: true, structuredOutput: true, reasoning: true } };
    const unavailableModel = { ...enabledModel, available: false };
    const missingStreaming = { ...enabledModel, features: { ...enabledModel.features, streaming: false } };

    expect(modelFeatureGateState("not-ready", [enabledModel], "streaming")).toBe("not-ready");
    expect(modelFeatureGateState("ready", [unavailableModel], "tools")).toBe("not-ready");
    expect(modelFeatureGateState("ready", [missingStreaming], "streaming")).toBe("not-ready");
    expect(modelFeatureGateState("ready", [enabledModel], "structuredOutput")).toBe("ready");
  });

  it("has truthful docs metadata", () => {
    expect(docsMetadata).toMatchObject({
      title: "Documentation | Power Champion",
      description: "Quick start for the OpenAI-compatible API at b300.powerchampion.ai — cURL, Python, and JavaScript examples.",
    });
  });

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
  it("puts the live boundary notice first on the console page", () => {
    const { container } = render(<LocaleProvider><ConsolePage /></LocaleProvider>);
    const main = container.querySelector("main");

    expect(main?.firstElementChild).toHaveTextContent(/live balance check/i);
    expect(main?.firstElementChild).toHaveTextContent(/sent only to the gateway/i);
  });

  it("has truthful console metadata", () => {
    expect(consoleMetadata).toMatchObject({
      title: "Console | Power Champion",
      description: "Check your prepaid API balance with your key. Queries the gateway live; the key is never stored.",
    });
  });

  it("renders the live balance form with key never echoed in plain text", () => {
    render(<LocaleProvider><ConsoleView /></LocaleProvider>);

    expect(screen.getByText(/queries the gateway directly/i)).toBeVisible();
    const input = screen.getByPlaceholderText("sk-…");
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Check balance" })).toBeDisabled();
    expect(screen.queryByText("$184.20")).not.toBeInTheDocument();
  });

  it("submits the key to the balance proxy and renders the result", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ plan: { title: "prepaid", remaining_usd: 12.3456 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LocaleProvider><ConsoleView /></LocaleProvider>);

    await user.type(screen.getByPlaceholderText("sk-…"), "sk-test-key-123");
    await user.click(screen.getByRole("button", { name: "Check balance" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("prepaid");
      expect(screen.getByText("$12.3456")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/balance", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "sk-test-key-123" }),
    }));
    vi.unstubAllGlobals();
  });

  it("shows a localized error for an invalid key", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Invalid API key." }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LocaleProvider><ConsoleView /></LocaleProvider>);

    await user.type(screen.getByPlaceholderText("sk-…"), "sk-bad");
    await user.click(screen.getByRole("button", { name: "Check balance" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/not accepted/i);
    });
    vi.unstubAllGlobals();
  });

  it("switches the balance UI to Traditional Chinese", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><ConsoleView /></SiteShell>
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));

    expect(screen.getByRole("button", { name: "查詢餘額" })).toBeInTheDocument();
    expect(screen.getByText(/貼上你的 API Key/i)).toBeInTheDocument();
  });

  it("offers the access path next to the redeem hint", () => {
    render(<LocaleProvider><ConsoleView /></LocaleProvider>);

    expect(screen.getByText(/POST \/v1\/redeem/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Need a key?" })).toBeInTheDocument();
  });

  it("uses h2 for the balance section after the page h1", () => {
    render(<LocaleProvider><ConsoleView /></LocaleProvider>);

    expect(screen.getByRole("heading", { level: 2, name: "Check your balance" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });
});
