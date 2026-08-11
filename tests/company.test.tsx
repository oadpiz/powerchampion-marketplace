import { describe, expect, it } from "vitest";
import { COMPANY_CONTENT, COMPANY_SOURCES } from "../lib/company";
import { COPY } from "../lib/content";

describe("company data", () => {
  it("stores the bounded public record with sourceable qualifications", () => {
    expect(COMPANY_CONTENT.en.capacity.initialMw).toBe("3.1 MW");
    expect(COMPANY_CONTENT.en.capacity.initialReservation).toBe("US$27.9M");
    expect(COMPANY_CONTENT.en.capacity.initialLabel)
      .toBe("Counterparty-reported initial capacity and reservation context");
    expect(COMPANY_CONTENT.en.capacity.expansion).toContain("12 MW");
    expect(COMPANY_CONTENT.en.capacity.expansionLabel)
      .toBe("Counterparty-reported expansion context");
    expect(COMPANY_CONTENT.en.capacity.qualification)
      .toBe("Potential; subject to conditions and not guaranteed.");
    expect(COMPANY_SOURCES.map((source) => source.href)).toContain(
      "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986809.htm",
    );
    expect(COMPANY_SOURCES.find((source) => source.id === "bvi-directory")?.kind)
      .toBe("Third-party public directory");
    expect(COMPANY_CONTENT.en.record.directoryQualification)
      .toContain("public company-directory listing");
    expect(COMPANY_CONTENT.zh.record.directoryQualification)
      .toContain("公開公司目錄列表");
    expect(COMPANY_CONTENT.zh.capacity.initialLabel).toContain("交易對手報告");
    expect(COMPANY_CONTENT.zh.capacity.qualification)
      .toBe("具潛在性；須符合條件，且不予保證。");
  });

  it("supplies each new copy-dictionary field in both locales", () => {
    for (const locale of ["en", "zh"] as const) {
      expect(COPY[locale].nav.company).not.toBe("");
      expect(COPY[locale].home.infrastructureProof).not.toBe("");
      expect(COPY[locale].home.companyLink).not.toBe("");
      expect(COPY[locale].checkout.launchNotice).not.toBe("");
      expect(COPY[locale].checkout.requestComplete).not.toBe("");
    }
  });
});
