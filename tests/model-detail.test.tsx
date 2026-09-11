import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { LanguagePicker } from "../components/language-picker";
import { ModelDetailContent } from "../components/model-detail-content";
import { MODEL_CATALOG } from "../lib/models";
import ModelPage, { generateMetadata } from "../app/models/[modelId]/page";

beforeEach(() => act(() => window.history.replaceState({}, "", "/models/glm-5.2-fp8")));
afterEach(() => {
  vi.restoreAllMocks();
  act(() => window.history.replaceState({}, "", "/"));
});

describe("Model detail pages", () => {
  it.each([
    ["glm-5.2-fp8", "/v1/chat/completions", "$0.93", "per 1M input tokens"],
    ["qwen3-vl-30b", "/v1/chat/completions", "$0.30", "per 1M input tokens"],
    ["flux-schnell", "/v1/images/generations", "$0.01", "per image"],
    ["chroma1-hd", "/v1/images/generations", "$0.01", "per image"],
    ["whisper-large-v3", "/v1/audio/transcriptions", "$0.01", "per minute of audio"],
    ["indextts2", "/v1/audio/speech", "$0.03", "per minute of audio"],
    ["bge-m3", "/v1/embeddings", "$0.02", "per 1M input tokens"],
    ["bge-reranker-v2-m3", "/v1/rerank", "$0.02", "per 1M input tokens"],
  ])("links %s to its documented endpoint and billing unit", (id, endpoint, rate, unit) => {
    const model = MODEL_CATALOG.find((entry) => entry.id === id)!;
    act(() => window.history.replaceState({}, "", `/models/${id}`));
    render(<LocaleProvider><ModelDetailContent model={model} /></LocaleProvider>);
    expect(screen.getByRole("heading", { level: 1, name: model.name })).toBeInTheDocument();
    expect(screen.getByText(endpoint)).toBeInTheDocument();
    expect(screen.getByText(rate)).toBeInTheDocument();
    expect(screen.getByText(unit)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Integrate this model" })).toHaveAttribute("href", `/integrations?model=${id}`);
    expect(screen.getByRole("link", { name: "Compare models" })).toHaveAttribute("href", `/compare?models=${id}`);
    expect(screen.getByRole("link", { name: "Check live status" })).toHaveAttribute("href", "/status");
    if (endpoint === "/v1/chat/completions") {
      expect(screen.getByRole("link", { name: "Open in playground" })).toHaveAttribute("href", `/playground?model=${id}`);
      expect(screen.getByText(`$${model.outputPerMillion.toFixed(2)}`)).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("link", { name: "Open in playground" })).not.toBeInTheDocument();
      expect(screen.queryByText("per 1M output tokens")).not.toBeInTheDocument();
    }
  });

  it("copies the actual request model ID", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><ModelDetailContent model={MODEL_CATALOG[0]} /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Copy model ID" }));
    expect(await navigator.clipboard.readText()).toBe("glm-5.2-fp8");
    expect(screen.getByRole("status")).toHaveTextContent("Model ID copied to clipboard.");
  });

  it("shows a useful fallback when clipboard permission is unavailable", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("blocked"));
    render(<LocaleProvider><ModelDetailContent model={MODEL_CATALOG[0]} /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Copy model ID" }));
    expect(screen.getByRole("status")).toHaveTextContent("Select the model ID above to copy it manually.");
    write.mockRestore();
  });

  it("switches product actions, endpoint descriptions, and billing units to Traditional Chinese", async () => {
    const user = userEvent.setup();
    act(() => window.history.replaceState({}, "", `/models/${MODEL_CATALOG[2].id}`));
    render(<LocaleProvider><LanguagePicker /><ModelDetailContent model={MODEL_CATALOG[2]} /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.click(screen.getByRole("button", { name: "繁體中文" }));
    expect(screen.getByRole("link", { name: "串接此模型" })).toBeInTheDocument();
    expect(screen.getByText("每張圖片")).toBeInTheDocument();
    expect(screen.getByText("1 張圖片")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "複製模型 ID" })).toBeInTheDocument();
  });

  it("resolves a catalog slug with model-specific metadata", async () => {
    const props = { params: Promise.resolve({ modelId: "bge-m3" }) };
    act(() => window.history.replaceState({}, "", "/models/bge-m3"));
    const page = await ModelPage(props);
    render(<LocaleProvider>{page}</LocaleProvider>);
    expect(screen.getByRole("heading", { level: 1, name: "BGE-M3" })).toBeInTheDocument();
    const metadata = await generateMetadata(props);
    expect(metadata.title).toContain("BGE-M3");
    expect(metadata.alternates?.canonical).toBe("https://powerchampion.ai/models/bge-m3");
  });

  it("rejects a slug outside the published catalog", async () => {
    await expect(ModelPage({ params: Promise.resolve({ modelId: "unpublished-model" }) })).rejects.toThrow();
  });
});
