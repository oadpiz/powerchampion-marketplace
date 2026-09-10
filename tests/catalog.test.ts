import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_SNAPSHOT,
  CATALOG_SNAPSHOT_DATE,
  FAILURE_MEMO_MS,
  fetchCatalog,
  resetCatalogFailureMemo,
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

beforeEach(() => {
  // The negative-result memo is module state: without this, one test's
  // simulated outage would make the next test skip the network entirely.
  resetCatalogFailureMemo();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetCatalogFailureMemo();
});

describe("fetchCatalog", () => {
  it("returns the live gateway models when the endpoint answers", async () => {
    const mock = vi.fn<typeof fetch>(async () => jsonResponse(livePayload));
    vi.stubGlobal("fetch", mock);

    const result = await fetchCatalog();

    expect(result.source).toBe("live");
    expect(result.updated).toBe("2026-09-09T08:00:00Z");
    expect(result.models.map((model) => model.id)).toEqual(["glm-5.2-fp8"]);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe("https://b300.powerchampion.ai/catalog.json");
  });

  it("passes an abort signal so a hung gateway cannot hang the page", async () => {
    const mock = vi.fn<typeof fetch>(async () => jsonResponse(livePayload));
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

  it("accepts a live payload whose nullable fields are actually null", async () => {
    const nullCarrying: CatalogPayload = {
      updated: "2026-09-10T00:00:00Z",
      models: [
        {
          ...livePayload.models[0],
          id: "whisper-large-v3",
          name: "Whisper Large v3",
          context_length: null,
          max_output_length: null,
          uptime: null,
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(nullCarrying)));

    const result = await fetchCatalog();

    expect(result.source).toBe("live");
    expect(result.models[0].context_length).toBeNull();
    expect(result.models[0].max_output_length).toBeNull();
    expect(result.models[0].uptime).toBeNull();
  });

  it.each([
    ["an empty object", {}],
    ["a non-array models field", { models: "x" }],
    ["a null models field", { updated: "x", models: null }],
    ["models that are not objects", { updated: "x", models: ["glm-5.2-fp8"] }],
    ["an entry with no fields at all", { updated: "x", models: [{}] }],
  ])("falls back to the snapshot for %s", async (_label, payload) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(payload)));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
    expect(result.models).toEqual(CATALOG_SNAPSHOT);
  });

  it("falls back to the snapshot when the only model has no pricing", async () => {
    const withoutPricing: Record<string, unknown> = { ...livePayload.models[0] };
    delete withoutPricing.pricing;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ updated: "x", models: [withoutPricing] })));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
  });

  it("drops only the invalid entries when some models are usable", async () => {
    const broken: Record<string, unknown> = { ...livePayload.models[0] };
    delete broken.pricing;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      updated: "2026-09-10",
      models: [{ ...broken, id: "broken" }, livePayload.models[0], { id: "no-modalities", name: "x", ready: true }],
    })));

    const result = await fetchCatalog();

    expect(result.source).toBe("live");
    expect(result.models.map((model) => model.id)).toEqual(["glm-5.2-fp8"]);
  });

  it("skips the network for a minute after a failure, then retries", async () => {
    vi.useFakeTimers();
    const mock = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });
    vi.stubGlobal("fetch", mock);

    expect((await fetchCatalog()).source).toBe("snapshot");
    expect(mock).toHaveBeenCalledTimes(1);

    // Second request during the outage: snapshot, no second round trip.
    expect((await fetchCatalog()).source).toBe("snapshot");
    expect(mock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FAILURE_MEMO_MS - 1);
    await fetchCatalog();
    expect(mock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await fetchCatalog();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("clears the memo once the gateway answers again", async () => {
    vi.useFakeTimers();
    let healthy = false;
    const mock = vi.fn<typeof fetch>(async () => {
      if (!healthy) throw new Error("gateway down");
      return jsonResponse(livePayload);
    });
    vi.stubGlobal("fetch", mock);

    expect((await fetchCatalog()).source).toBe("snapshot");
    healthy = true;
    vi.advanceTimersByTime(FAILURE_MEMO_MS + 1);
    expect((await fetchCatalog()).source).toBe("live");

    // Memo cleared: the very next request goes to the network again.
    await fetchCatalog();
    expect(mock).toHaveBeenCalledTimes(3);
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

  // Gateway contract change (2026-09-10, gateway final review I1/I2): a model
  // with no configured context window reports null, not 0; a model whose
  // output is not text reports max_output_length null, not 0. The hand-edited
  // snapshot must agree with that shape so the sync script's output and the
  // checked-in snapshot never disagree on null vs 0.
  it("reports null context_length for a model with no configured context window", () => {
    const whisper = CATALOG_SNAPSHOT.find((model) => model.id === "whisper-large-v3");
    expect(whisper).toBeDefined();
    expect(whisper!.context_length).toBeNull();
  });

  it("reports null max_output_length for every model whose output is not text", () => {
    const nonTextOutput = CATALOG_SNAPSHOT.filter((model) => !model.modalities.output.includes("text"));
    expect(nonTextOutput.map((model) => model.id)).toEqual([
      "flux-schnell",
      "chroma1-hd",
      "indextts2",
      "bge-m3",
      "bge-reranker-v2-m3",
    ]);
    for (const model of nonTextOutput) {
      expect(model.max_output_length, `${model.id} should be null`).toBeNull();
    }
  });

  it("never reports the OpenRouter manifest slug as a model name", () => {
    for (const model of CATALOG_SNAPSHOT) {
      expect(model.name).not.toMatch(/PowerChampion Thailand B300/);
    }
  });

  it("keeps prices and the model list unchanged by the null-shape edit", () => {
    const byId = Object.fromEntries(CATALOG_SNAPSHOT.map((model) => [model.id, model]));
    expect(byId["glm-5.2-fp8"].pricing).toEqual({ unit: "per_million_tokens", prompt_usd: 0.93, completion_usd: 3.0 });
    expect(byId["flux-schnell"].pricing).toEqual({ unit: "per_million_tokens", prompt_usd: 0.0, completion_usd: 10.0 });
    expect(byId["whisper-large-v3"].pricing).toEqual({ unit: "per_million_tokens", prompt_usd: 0.0, completion_usd: 3.33 });
    expect(byId["bge-m3"].pricing).toEqual({ unit: "per_million_tokens", prompt_usd: 0.02, completion_usd: 0.0 });
  });
});
