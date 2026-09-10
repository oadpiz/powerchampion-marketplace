import { describe, expect, it } from "vitest";
import { CATALOG_SNAPSHOT, type CatalogModel } from "../lib/catalog";
import {
  MODEL_PRESENTATION,
  SNAPSHOT_CATALOG,
  billingUnitFor,
  filterModels,
  formatContextLength,
  mergeCatalog,
  unitPriceFor,
} from "../lib/models";
import { CREDIT_PACKS, calculateUsageCost } from "../lib/pricing";

function catalogModel(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: "test-model",
    name: "Test Model",
    description: "A model used only by this test.",
    modalities: { input: ["text"], output: ["text"] },
    context_length: 16384,
    max_output_length: 2048,
    pricing: { unit: "per_million_tokens", prompt_usd: 1, completion_usd: 2 },
    billing_note: null,
    ready: true,
    uptime: null,
    ...overrides,
  };
}

describe("formatContextLength", () => {
  it("renders thousands of tokens and an em dash for non-context models", () => {
    expect(formatContextLength(131072)).toBe("131K");
    expect(formatContextLength(32768)).toBe("33K");
    expect(formatContextLength(8192)).toBe("8K");
    expect(formatContextLength(512)).toBe("—");
    expect(formatContextLength(0)).toBe("—");
    expect(formatContextLength(null)).toBe("—");
  });
});

describe("billing units", () => {
  it("classifies image, audio and token models from their modalities", () => {
    expect(billingUnitFor(catalogModel({ modalities: { input: ["text"], output: ["image"] } }))).toBe("image");
    expect(billingUnitFor(catalogModel({ modalities: { input: ["audio"], output: ["text"] } }))).toBe("audio-minute");
    expect(billingUnitFor(catalogModel({ modalities: { input: ["text"], output: ["audio"] } }))).toBe("audio-minute");
    expect(billingUnitFor(catalogModel())).toBe("token");
  });

  it("converts the 1000-token equivalent meter into the displayed unit", () => {
    const image = catalogModel({
      modalities: { input: ["text"], output: ["image"] },
      pricing: { unit: "per_million_tokens", prompt_usd: 0, completion_usd: 10 },
    });
    expect(unitPriceFor(image, "image")).toBeCloseTo(0.01, 6);

    const audio = catalogModel({
      modalities: { input: ["text"], output: ["audio"] },
      pricing: { unit: "per_million_tokens", prompt_usd: 0, completion_usd: 10 },
    });
    expect(unitPriceFor(audio, "audio-minute")).toBeCloseTo(0.03, 6);

    expect(unitPriceFor(catalogModel(), "token")).toBeNull();
  });
});

describe("mergeCatalog", () => {
  it("renders only gateway models, never presentation-only entries", () => {
    const merged = mergeCatalog([catalogModel({ id: "glm-5.2-fp8", name: "ignored" })]);
    expect(merged.map((model) => model.id)).toEqual(["glm-5.2-fp8"]);
    // The presentation name wins over whatever the gateway calls it.
    expect(merged[0].name).toBe("GLM 5.2 FP8");
  });

  it("takes availability, price and context from the gateway", () => {
    const merged = mergeCatalog([
      catalogModel({ id: "glm-5.2-fp8", ready: false, context_length: 65536, uptime: 0.97 }),
    ]);
    expect(merged[0].available).toBe(false);
    expect(merged[0].context).toBe("66K");
    expect(merged[0].uptime).toBe(0.97);
    expect(merged[0].inputPerMillion).toBe(1);
    expect(merged[0].outputPerMillion).toBe(2);
  });

  it("gives an unknown model a safe default presentation instead of throwing", () => {
    const merged = mergeCatalog([
      catalogModel({ id: "brand-new-model", description: "Something the site has never seen." }),
    ]);
    expect(merged[0].name).toBe("Test Model");
    expect(merged[0].categories).toEqual(["general"]);
    expect(merged[0].speed).toBe("Balanced");
    expect(merged[0].features).toEqual({
      tools: false,
      structuredOutput: false,
      reasoning: false,
      streaming: false,
    });
    expect(merged[0].tagline.en).toBe("Something the site has never seen.");
    expect(merged[0].tagline.zh).toBe("Something the site has never seen.");
    expect(merged[0].notice).toBeNull();
    expect(merged[0].region).toBeNull();
  });

  it("defaults an unknown image model into the image category", () => {
    const merged = mergeCatalog([
      catalogModel({ id: "unknown-image", modalities: { input: ["text"], output: ["image"] } }),
    ]);
    expect(merged[0].categories).toEqual(["image"]);
    expect(merged[0].billingUnit).toBe("image");
  });

  it("defaults an unknown embedding model into the embedding category", () => {
    const merged = mergeCatalog([
      catalogModel({ id: "unknown-embed", modalities: { input: ["text"], output: ["embedding"] } }),
    ]);
    expect(merged[0].categories).toEqual(["embedding"]);
  });
});

describe("SNAPSHOT_CATALOG", () => {
  it("covers every snapshot id with a presentation entry", () => {
    for (const model of CATALOG_SNAPSHOT) {
      expect(MODEL_PRESENTATION[model.id], `no presentation for ${model.id}`).toBeTruthy();
    }
    expect(SNAPSHOT_CATALOG).toHaveLength(CATALOG_SNAPSHOT.length);
  });

  it("publishes the uncensored model with a usage notice in both locales", () => {
    const model = SNAPSHOT_CATALOG.find((entry) => entry.id === "glm-5.3-flash-uncensored");
    expect(model).toBeDefined();
    expect(model!.notice?.en).toBe("No content filtering; you are responsible for compliant use.");
    expect(model!.notice?.zh).toBe("不套用內容過濾；合規使用由你負責。");
    expect(model!.inputPerMillion).toBe(0.3);
    expect(model!.outputPerMillion).toBe(1.0);
    expect(model!.context).toBe("33K");
  });

  it("keeps the published media unit prices unchanged", () => {
    const byId = Object.fromEntries(SNAPSHOT_CATALOG.map((model) => [model.id, model]));
    expect(byId["flux-schnell"].unitPrice!.toFixed(2)).toBe("0.01");
    expect(byId["chroma1-hd"].unitPrice!.toFixed(2)).toBe("0.01");
    expect(byId["whisper-large-v3"].unitPrice!.toFixed(2)).toBe("0.01");
    expect(byId["indextts2"].unitPrice!.toFixed(2)).toBe("0.03");
  });
});

describe("model catalog", () => {
  it("filters by category and query together", () => {
    const result = filterModels(SNAPSHOT_CATALOG, "glm-5.2", "coding");
    expect(result.map((model) => model.id)).toEqual(["glm-5.2-fp8"]);
  });

  it("returns no rows when no model matches", () => {
    expect(filterModels(SNAPSHOT_CATALOG, "not-a-model", "all")).toEqual([]);
  });
});

describe("pricing", () => {
  it("calculates input and output cost per million tokens", () => {
    expect(
      calculateUsageCost(1_000_000, 500_000, {
        inputPerMillion: 0.18,
        outputPerMillion: 0.72,
      }),
    ).toBeCloseTo(0.54, 6);
  });

  it("rejects invalid token amounts", () => {
    expect(() =>
      calculateUsageCost(-1, 0, {
        inputPerMillion: 0.18,
        outputPerMillion: 0.72,
      }),
    ).toThrow(RangeError);
  });

  it("keeps the approved credit-pack economics", () => {
    expect(CREDIT_PACKS.map(({ id, price, credit }) => ({ id, price, credit })))
      .toEqual([
        { id: "starter", price: 10, credit: 10 },
        { id: "builder", price: 50, credit: 52.5 },
        { id: "scale", price: 200, credit: 224 },
      ]);
  });
});
