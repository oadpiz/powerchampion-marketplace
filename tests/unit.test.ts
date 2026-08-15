import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, filterModels } from "../lib/models";
import { CREDIT_PACKS, calculateUsageCost } from "../lib/pricing";

describe("model catalog", () => {
  it("filters by category and query together", () => {
    const result = filterModels(MODEL_CATALOG, "glm", "coding");
    expect(result.map((model) => model.id)).toEqual(["glm-5.2-fp8"]);
  });

  it("returns no rows when no model matches", () => {
    expect(filterModels(MODEL_CATALOG, "not-a-model", "all")).toEqual([]);
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
