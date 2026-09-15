import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../lib/models";
import { HOME_COPY } from "../lib/home-copy";
import { POLICY_CONTENT } from "../lib/trust";
import { faqPageJsonLd, modelServiceJsonLd } from "../lib/structured-data";

describe("FAQ structured data", () => {
  it("describes the questions of one page under that page's canonical URL", () => {
    const faq = faqPageJsonLd("/ja", HOME_COPY.ja.faqs.map(([question, answer]) => ({ question, answer })));
    expect(faq["@id"]).toBe("https://powerchampion.ai/ja#faq");
    expect(faq.url).toBe("https://powerchampion.ai/ja");
    expect(faq.mainEntity).toHaveLength(HOME_COPY.ja.faqs.length);
    expect(faq.mainEntity[0].name).toBe(HOME_COPY.ja.faqs[0][0]);
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe(HOME_COPY.ja.faqs[0][1]);
  });

  it("carries every published policy question without rewriting it", () => {
    const faq = faqPageJsonLd("/faq", POLICY_CONTENT.en.faq);
    expect(faq.mainEntity.map((entry) => entry.name)).toEqual(POLICY_CONTENT.en.faq.map((entry) => entry.question));
  });
});

describe("model structured data", () => {
  it("states the published catalog rate in the unit the model is billed in", () => {
    for (const model of MODEL_CATALOG) {
      const data = modelServiceJsonLd(model);
      const price = data.offers.priceSpecification;
      expect(data.url).toBe(`https://powerchampion.ai/models/${model.id}`);
      expect(price.price).toBe(model.inputPerMillion.toFixed(2));
      expect(price.priceCurrency).toBe("USD");
      expect(price.unitText).toBe(
        model.categories.includes("image") ? "image"
          : model.categories.includes("audio") ? "minute of audio"
            : "1M input tokens",
      );
      expect(data.offers.availability).toBe(
        model.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      );
    }
  });

  it("keeps the described model identity aligned with the catalog", () => {
    const model = MODEL_CATALOG[0];
    const data = modelServiceJsonLd(model);
    expect(data.name).toContain(model.name);
    expect(data.description).toBe(model.servingRole.en);
    expect(data.additionalProperty.map((entry) => entry.value)).toContain(model.modelId);
  });
});
