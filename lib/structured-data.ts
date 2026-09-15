/** Schema.org descriptions of content that already exists on the page. */
import type { ModelDefinition } from "./models";
import { SITE_ORIGIN } from "./seo";

export type FaqSource = { question: string; answer: string };

/** FAQPage for questions that are visible on that same page, in that page's language. */
export function faqPageJsonLd(path: string, entries: readonly FaqSource[]) {
  const url = new URL(path, SITE_ORIGIN).href;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${url}#faq`,
    url,
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

/** Published catalog rate for one model, stated in the unit it is billed in. */
function offer(model: ModelDefinition) {
  const perImage = model.categories.includes("image");
  const perMinute = model.categories.includes("audio");
  const unitText = perImage ? "image" : perMinute ? "minute of audio" : "1M input tokens";
  return {
    "@type": "Offer",
    url: `${SITE_ORIGIN}/models/${model.id}`,
    availability: `https://schema.org/${model.available ? "InStock" : "OutOfStock"}`,
    priceSpecification: {
      "@type": "UnitPriceSpecification",
      price: model.inputPerMillion.toFixed(2),
      priceCurrency: "USD",
      unitText,
      // Published catalog rate, not a quote or a live billing reading.
      valueAddedTaxIncluded: false,
    },
  };
}

/** The hosted model API as a described service, with its published input rate. */
export function modelServiceJsonLd(model: ModelDefinition) {
  const url = `${SITE_ORIGIN}/models/${model.id}`;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#model`,
    name: `${model.name} API`,
    description: model.servingRole.en,
    category: "Model API",
    url,
    brand: { "@type": "Brand", name: "Power Champion" },
    offers: offer(model),
    additionalProperty: [
      { "@type": "PropertyValue", name: "Model ID", value: model.modelId },
      { "@type": "PropertyValue", name: "Context window", value: model.context },
      { "@type": "PropertyValue", name: "Maximum output", value: model.maxOutput },
    ],
  };
}
