import { describe, expect, it } from "vitest";
import { COMPANY_CONTENT, COMPANY_SOURCES } from "../lib/company";

describe("company data", () => {
  it("stores the bounded public record with sourceable qualifications", () => {
    expect(COMPANY_CONTENT.en.capacity.initialMw).toBe("3.1 MW");
    expect(COMPANY_CONTENT.en.capacity.initialReservation).toBe("US$27.9M");
    expect(COMPANY_CONTENT.en.capacity.expansion).toContain("12 MW");
    expect(COMPANY_CONTENT.en.capacity.qualification)
      .toBe("Potential; subject to conditions and not guaranteed.");
    expect(COMPANY_SOURCES.map((source) => source.href)).toContain(
      "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986809.htm",
    );
  });
});
