import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CompanyContent } from "../components/company-content";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";
import { COMPANY_CONTENT, COMPANY_SOURCES } from "../lib/company";
import { COPY } from "../lib/content";

describe("company data", () => {
  it("renders qualified capacity information and verifiable sources", () => {
    render(
      <LocaleProvider>
        <CompanyContent />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /Infrastructure, made accountable/i }))
      .toBeInTheDocument();
    expect(screen.getByText("3.1 MW")).toBeVisible();
    expect(screen.getByText("US$27.9M")).toBeVisible();
    expect(screen.getByText("Potential; subject to conditions and not guaranteed."))
      .toBeVisible();
    expect(screen.getByRole("link", { name: /Azio AI Holdings, Exhibit 99.2/i }))
      .toHaveAttribute("href", expect.stringContaining("sec.gov"));
  });

  it("renders a third counterparty-reported deposit fact in the capacity sequence", () => {
    render(
      <LocaleProvider>
        <CompanyContent />
      </LocaleProvider>,
    );

    const capacity = screen.getByRole("region", { name: "Capacity context" });
    expect(within(capacity).getAllByRole("term")).toHaveLength(3);
    expect(within(capacity).getByText("Counterparty-reported initial deposit context"))
      .toBeVisible();
    expect(within(capacity).getByText(/this is not a statement that Power Champion received revenue/i))
      .toBeVisible();
  });

  it("localizes explanatory source kinds after switching to Traditional Chinese", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <CompanyContent />
        </SiteShell>
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));

    expect(screen.getByRole("link", { name: "Azio AI Holdings, Exhibit 99.2" }))
      .toBeVisible();
    expect(screen.getByText("交易對手向 SEC 提交的揭露")).toBeVisible();
    expect(screen.getByText("第三方公開公司目錄")).toBeVisible();
    expect(screen.queryByText("Counterparty SEC-filed disclosure")).not.toBeInTheDocument();
  });

  it("keeps the capacity reading sequence responsive at the required 760px breakpoint", async () => {
    const css = await readFile(resolve(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toMatch(/\.capacity-sequence\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*?\.company-timeline, \.capacity-sequence \{ grid-template-columns: 1fr; \}/);
  });

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
