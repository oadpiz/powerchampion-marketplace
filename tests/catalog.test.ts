import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_SNAPSHOT,
  CATALOG_SNAPSHOT_DATE,
  fetchCatalog,
  type CatalogPayload,
} from "../lib/catalog";

const livePayload: CatalogPayload = {
  updated: "2026-09-09T08:00:00Z",
  models: [
    {
      id: "glm-5.2-fp8",
      name: "GLM 5.2 FP8",
      description: "Frontier bilingual reasoning model.",
      modalities: { input: ["text"], output: ["text"] },
      context_length: 131072,
      max_output_length: 32768,
      pricing: { unit: "per_million_tokens", prompt_usd: 0.93, completion_usd: 3.0 },
      billing_note: null,
      ready: true,
      uptime: 0.998,
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchCatalog", () => {
  it("returns the live gateway models when the endpoint answers", async () => {
    const mock = vi.fn(async () => jsonResponse(livePayload));
    vi.stubGlobal("fetch", mock);

    const result = await fetchCatalog();

    expect(result.source).toBe("live");
    expect(result.updated).toBe("2026-09-09T08:00:00Z");
    expect(result.models.map((model) => model.id)).toEqual(["glm-5.2-fp8"]);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe("https://b300.powerchampion.ai/catalog.json");
  });

  it("passes an abort signal so a hung gateway cannot hang the page", async () => {
    const mock = vi.fn(async () => jsonResponse(livePayload));
    vi.stubGlobal("fetch", mock);

    await fetchCatalog();

    const init = mock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to the snapshot when the gateway answers non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 503)));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
    expect(result.updated).toBe(CATALOG_SNAPSHOT_DATE);
    expect(result.models).toEqual(CATALOG_SNAPSHOT);
  });

  it("falls back to the snapshot when the request times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    }));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
    expect(result.models).toEqual(CATALOG_SNAPSHOT);
  });

  it("falls back to the snapshot when the payload has no models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ updated: "x", models: [] })));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
  });

  it("falls back to the snapshot when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 200 })));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
  });
});

describe("CATALOG_SNAPSHOT", () => {
  it("holds the nine models the gateway currently enables", () => {
    expect(CATALOG_SNAPSHOT.map((model) => model.id)).toEqual([
      "glm-5.2-fp8",
      "glm-5.3-flash-uncensored",
      "qwen3-vl-30b",
      "flux-schnell",
      "chroma1-hd",
      "whisper-large-v3",
      "indextts2",
      "bge-m3",
      "bge-reranker-v2-m3",
    ]);
  });

  it("keeps every entry structurally complete", () => {
    for (const model of CATALOG_SNAPSHOT) {
      expect(model.name).toBeTruthy();
      expect(model.description).toBeTruthy();
      expect(model.pricing.unit).toBe("per_million_tokens");
      expect(model.pricing.prompt_usd).toBeGreaterThanOrEqual(0);
      expect(model.pricing.completion_usd).toBeGreaterThanOrEqual(0);
      expect(model.modalities.input.length).toBeGreaterThan(0);
      expect(model.modalities.output.length).toBeGreaterThan(0);
    }
  });

  it("carries a billing note on every media model", () => {
    const media = CATALOG_SNAPSHOT.filter(
      (model) =>
        model.modalities.output.includes("image") ||
        model.modalities.output.includes("audio") ||
        model.modalities.input.includes("audio"),
    );
    expect(media).toHaveLength(4);
    for (const model of media) {
      expect(model.billing_note).toBeTruthy();
    }
  });
});
