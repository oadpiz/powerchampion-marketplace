import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPANY_CAPACITY_MW, COMPANY_CONTENT } from "../lib/company";
import { MODEL_CATALOG } from "../lib/models";
import {
  POLICY_CONTENT,
  SERVICE_READINESS,
  TRUST_CONTENT,
  isReady,
} from "../lib/trust";

describe("public truth foundation", () => {
  it("fails closed for every unreleased commercial capability", () => {
    expect(SERVICE_READINESS.website).toBe("ready");
    expect(SERVICE_READINESS.manifest).toBe("ready");
    expect(SERVICE_READINESS.inference).toBe("ready");
    expect(SERVICE_READINESS.payments).toBe("ready");
    expect(SERVICE_READINESS.usageAccounting).toBe("ready");
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

  it("keeps capacity display and exact FAQ wording derived from one canonical token", () => {
    const englishCapacityFaq = POLICY_CONTENT.en.faq.find((entry) => entry.id === "capacity-deployed");
    const chineseCapacityFaq = POLICY_CONTENT.zh.faq.find((entry) => entry.id === "capacity-deployed");

    expect(COMPANY_CAPACITY_MW).toBe("3.1 MW");
    expect(COMPANY_CONTENT.en.capacity.initialMw).toBe(`Approximately ${COMPANY_CAPACITY_MW}`);
    expect(COMPANY_CONTENT.zh.capacity.initialMw).toBe(`約 ${COMPANY_CAPACITY_MW}`);
    expect(englishCapacityFaq?.question).toBe(`Is ${COMPANY_CAPACITY_MW} already deployed?`);
    expect(chineseCapacityFaq?.question).toBe(`${COMPANY_CAPACITY_MW} 已經部署了嗎？`);
  });

  it("defines the capacity token only in the canonical company source", async () => {
    const [companySource, trustSource] = await Promise.all([
      readFile(resolve(process.cwd(), "lib/company.ts"), "utf8"),
      readFile(resolve(process.cwd(), "lib/trust.ts"), "utf8"),
    ]);

    expect(companySource.match(/export const COMPANY_CAPACITY_MW = "3\.1 MW";/g)).toHaveLength(1);
    expect(trustSource).not.toContain('"3.1 MW"');
  });
});
