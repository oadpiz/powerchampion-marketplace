import { describe, expect, it } from "vitest";
import { COMPANY_CONTENT } from "../lib/company";
import { MODEL_CATALOG } from "../lib/models";
import {
  POLICY_CONTENT,
  SERVICE_READINESS,
  TRUST_CONTENT,
  isReady,
} from "../lib/trust";

describe("public truth foundation", () => {
  it("fails closed for every unreleased commercial capability", () => {
    expect(SERVICE_READINESS.website).toBe("preview");
    expect(SERVICE_READINESS.manifest).toBe("not-ready");
    expect(SERVICE_READINESS.inference).toBe("not-ready");
    expect(SERVICE_READINESS.payments).toBe("not-ready");
    expect(isReady(undefined)).toBe(false);
    expect(isReady("not-ready")).toBe(false);
    expect(isReady("ready")).toBe(true);
  });

  it("publishes complete decision fields without inventing provenance", () => {
    for (const model of MODEL_CATALOG) {
      expect(model.maxOutput).toMatch(/^\d+K$/);
      expect(model.features).toEqual({
        tools: expect.any(Boolean),
        structuredOutput: expect.any(Boolean),
        reasoning: expect.any(Boolean),
        streaming: expect.any(Boolean),
      });
      expect(model.provenance.status).toBe("review-required");
      expect(model.servingRole.en).toMatch(/illustrative catalog/i);
      expect(model.region).toBeNull();
    }
  });

  it("keeps review-required catalog capabilities and availability fail closed", () => {
    for (const model of MODEL_CATALOG) {
      expect(model.available).toBe(false);
      expect(model.features).toEqual({
        tools: false,
        structuredOutput: false,
        reasoning: false,
        streaming: false,
      });
    }
  });

  it("keeps trust and policy content complete in both locales", () => {
    for (const locale of ["en", "zh"] as const) {
      expect(TRUST_CONTENT[locale].title).toBeTruthy();
      expect(TRUST_CONTENT[locale].releaseBoundary).toBeTruthy();
      expect(POLICY_CONTENT[locale].privacy.sections.length).toBeGreaterThan(1);
      expect(POLICY_CONTENT[locale].terms.sections.length).toBeGreaterThan(1);
      expect(POLICY_CONTENT[locale].faq.length).toBeGreaterThan(4);
    }
  });

  it("derives capacity FAQ questions from canonical company content", () => {
    const englishCapacityFaq = POLICY_CONTENT.en.faq.find((entry) => entry.id === "capacity-deployed");
    const chineseCapacityFaq = POLICY_CONTENT.zh.faq.find((entry) => entry.id === "capacity-deployed");

    expect(englishCapacityFaq?.question).toContain(COMPANY_CONTENT.en.capacity.initialMw);
    expect(chineseCapacityFaq?.question).toContain(COMPANY_CONTENT.zh.capacity.initialMw);
  });
});
