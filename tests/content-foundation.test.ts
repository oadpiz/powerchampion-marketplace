import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPANY_CAPACITY_MW, COMPANY_CONTENT } from "../lib/company";
import type { GatewayStatus } from "../lib/gateway-status";
import { MODEL_CATALOG } from "../lib/models";
import {
  POLICY_CONTENT,
  SERVICE_READINESS,
  TRUST_CONTENT,
  deriveGatewayReadiness,
  isReady,
} from "../lib/trust";

function gatewayWith(status: GatewayStatus["status"]): GatewayStatus {
  return {
    status,
    summary: status,
    updated: 0,
    uptime_window_days: 1,
    models: [{ id: "m", name: "m", ready: status === "ok", context_length: null, uptime: null }],
  };
}

describe("public truth foundation", () => {
  it("fails closed for every capability this site cannot vouch for statically", () => {
    // Only the marketplace itself and its own editorial state may be claimed
    // statically. Everything backend-facing starts "unknown" and must be
    // derived from the gateway's live status at render time.
    expect(SERVICE_READINESS.website).toBe("ready");
    expect(SERVICE_READINESS.enterpriseReview).toBe("preparation");
    for (const key of ["manifest", "inference", "usageAccounting", "payments"] as const) {
      expect(SERVICE_READINESS[key]).toBe("unknown");
    }
    expect(isReady(undefined)).toBe(false);
    expect(isReady("unknown")).toBe(false);
    expect(isReady("not-ready")).toBe(false);
    expect(isReady("ready")).toBe(true);
  });

  it("derives backend readiness from the gateway status feed, never statically", () => {
    expect(deriveGatewayReadiness(null)).toEqual({
      manifest: "unknown",
      inference: "unknown",
      usageAccounting: "unknown",
      payments: "unknown",
    });
    expect(deriveGatewayReadiness(gatewayWith("ok")).inference).toBe("ready");
    expect(deriveGatewayReadiness(gatewayWith("warn")).inference).toBe("degraded");
    // The gateway reporting a major outage must surface as not-ready —
    // never a blanket "ready" claim that survives an outage.
    expect(deriveGatewayReadiness(gatewayWith("down")).inference).toBe("not-ready");
    // /status.json has no probe for these; they stay unverified, not ready.
    for (const gateway of [null, gatewayWith("ok")] as const) {
      const derived = deriveGatewayReadiness(gateway);
      expect(derived.payments).toBe("unknown");
      expect(derived.usageAccounting).toBe("unknown");
      expect(derived.manifest).toBe("unknown");
    }
  });

  it("keeps readiness state labels complete and parallel across locales", () => {
    for (const locale of ["en", "zh"] as const) {
      for (const state of ["ready", "degraded", "unknown", "preview", "preparation", "not-ready"] as const) {
        expect(TRUST_CONTENT[locale].status.states[state]).toBeTruthy();
      }
    }
  });

  it("publishes complete decision fields with live provenance", () => {
    for (const model of MODEL_CATALOG) {
      expect(model.maxOutput).toBeTruthy();
      expect(model.features).toEqual({
        tools: expect.any(Boolean),
        structuredOutput: expect.any(Boolean),
        reasoning: expect.any(Boolean),
        streaming: expect.any(Boolean),
      });
      expect(model.provenance.status).toBe("live");
      expect(model.provenance.label.en).toBe("Live");
      expect(model.provenance.label.zh).toBe("已上線");
      expect(model.servingRole.en).toBeTruthy();
      expect(model.servingRole.zh).toBeTruthy();
      expect(model.region).toBeTruthy();
      expect(model.inputPerMillion).toBeGreaterThan(0);
      expect(model.outputPerMillion).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the catalog available for serving", () => {
    for (const model of MODEL_CATALOG) {
      expect(model.available).toBe(true);
      expect(model.modelId).toBe(model.id);
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
