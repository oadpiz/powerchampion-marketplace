import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelComparison } from "../components/model-comparison";
import { IntegrationBuilder } from "../components/integration-builder";
import { PlatformOverview } from "../components/platform-overview";
import { LocaleProvider } from "../components/locale-provider";
import { MODEL_CATALOG } from "../lib/models";
import { estimateModelCost } from "../lib/model-comparison";
import { buildIntegrationExample } from "../lib/integration-examples";

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

describe("working model platform", () => {
  it("connects configuration and task execution without assuming runtime availability", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<LocaleProvider><PlatformOverview gateway={null} /></LocaleProvider>);
    expect(screen.getByRole("link", { name: /Build your agent/ })).toHaveAttribute("href", "/agents/build");
    const tasks = screen.getByRole("link", { name: /Run an Agent task/ });
    expect(tasks).toHaveAttribute("href", "/tasks");
    expect(tasks).toHaveTextContent(/Availability is shown in the task console/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("compares token and audio workloads using their actual units", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelComparison /></LocaleProvider>);
    expect(screen.getByText("$1.68")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Model 3"), "indextts2");
    expect(screen.getByText("$1.80")).toBeVisible();
    expect(screen.getByText("per audio minute")).toBeVisible();
    await user.clear(screen.getByLabelText("Audio minutes"));
    await user.type(screen.getByLabelText("Audio minutes"), "10");
    expect(screen.getByText("$0.30", { selector: "strong" })).toBeVisible();
    await user.clear(screen.getByLabelText("Input tokens"));
    expect(screen.getAllByText("Enter valid usage")).toHaveLength(2);
    expect(screen.getByText("$0.30", { selector: "strong" })).toBeVisible();
  });

  it("creates a link that preserves the selected models", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelComparison /></LocaleProvider>);
    await user.selectOptions(screen.getByLabelText("Model 2"), "bge-m3");
    await user.click(screen.getByRole("button", { name: "Copy model selection link" }));
    const link = new URL(await navigator.clipboard.readText());
    expect(link.pathname).toBe("/compare");
    expect(link.searchParams.get("models")).toBe("glm-5.2-fp8,bge-m3");
  });

  it("estimates images separately and rejects invalid amounts", () => {
    const image = MODEL_CATALOG.find((model) => model.id === "flux-schnell")!;
    expect(estimateModelCost(image, { input: NaN, output: NaN, images: 100, minutes: NaN })).toBe(1);
    expect(estimateModelCost(image, { input: 0, output: 0, images: -1, minutes: 0 })).toBeNull();
  });

  it("shows an unavailable gateway honestly without blocking exploration", () => {
    render(<LocaleProvider><PlatformOverview gateway={{ status: "down", summary: "Major outage", updated: 0, uptime_window_days: 1, models: [] }} /></LocaleProvider>);
    expect(screen.getByRole("link", { name: "Service interruption" })).toHaveAttribute("href", "/status");
    expect(screen.getByRole("link", { name: /Make your first request/ })).toHaveAttribute("href", "/playground");
    expect(screen.queryByText("Operational")).not.toBeInTheDocument();
  });

  it("updates the integration endpoint and copies code for a selected model", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><IntegrationBuilder initialModel="chroma1-hd" /></LocaleProvider>);
    expect(screen.getByLabelText("Model")).toHaveValue("chroma1-hd");
    expect(screen.getByText("/images/generations")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Model"), "bge-reranker-v2-m3");
    await user.click(screen.getByRole("tab", { name: "cURL" }));
    await user.click(screen.getByRole("button", { name: /Copy code/ }));
    const text = await navigator.clipboard.readText();
    expect(text).toContain("/v1/rerank");
    expect(text).toContain("bge-reranker-v2-m3");
    expect(text).toContain("$POWERCHAMPION_API_KEY");
    expect(screen.queryByRole("link", { name: /playground/i })).not.toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 })).toBeVisible();
  });

  it("keeps shell metacharacters as literal prompt input and uses registered voices", () => {
    const code = buildIntegrationExample("glm-5.2-fp8", "curl", { prompt: "What's $(example) `literal`?", imageUrl: "", audioFile: "", documents: "" });
    expect(code).toContain("What'\\''s $(example) `literal`?");
    expect(buildIntegrationExample("indextts2", "python")).toContain('os.environ["POWERCHAMPION_VOICE_ID"]');
    expect(buildIntegrationExample("indextts2", "javascript")).not.toContain('voice: "alloy"');
  });
});
