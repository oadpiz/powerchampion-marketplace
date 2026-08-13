import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CompanyContent } from "../components/company-content";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";
import { COMPANY_CAPACITY_MW, COMPANY_CONTENT, COMPANY_SOURCES } from "../lib/company";
import { COPY } from "../lib/content";

describe("company data", () => {
  it("derives localized capacity display values from the canonical capacity token", () => {
    expect(COMPANY_CAPACITY_MW).toBe("3.1 MW");
    expect(COMPANY_CONTENT.en.capacity.initialMw).toBe(`Approximately ${COMPANY_CAPACITY_MW}`);
    expect(COMPANY_CONTENT.zh.capacity.initialMw).toBe(`約 ${COMPANY_CAPACITY_MW}`);
  });

  it("renders qualified capacity information and verifiable sources", () => {
    render(
      <LocaleProvider>
        <CompanyContent />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /Infrastructure, made accountable/i }))
      .toBeInTheDocument();
    expect(screen.getByText("Approximately 3.1 MW")).toBeVisible();
    expect(screen.getByText("Approximately US$27.9M over the initial contract term"))
      .toBeVisible();
    expect(screen.getByText("Up to 12 MW if expansion rights are exercised")).toBeVisible();
    expect(screen.getByText("Approximately US$100M potential total contract value")).toBeVisible();
    expect(screen.getByText(/Counterparty-reported expectations and estimates/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Azio AI Holdings, Exhibit 99.1" }))
      .toHaveAttribute(
        "href",
        "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986209.htm",
      );
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

    expect(screen.getByRole("link", { name: "Azio AI Holdings，附件 99.1" }))
      .toBeVisible();
    expect(screen.getByText("交易對手向 SEC 提交的揭露")).toBeVisible();
    expect(screen.getByText("第三方公開公司目錄")).toBeVisible();
    expect(screen.getAllByText("來源類型", { selector: "dt" })).toHaveLength(2);
    expect(screen.getByText("發布日期", { selector: "dt" })).toBeVisible();
    expect(screen.getByText("目錄所列登記日期", { selector: "dt" })).toBeVisible();
    expect(screen.getByRole("link", { name: "i-BVI 公開公司目錄列表" })).toBeVisible();
    expect(screen.queryByText("Counterparty SEC-filed disclosure")).not.toBeInTheDocument();
  });

  it("labels source dates by their actual semantics", () => {
    render(
      <LocaleProvider>
        <CompanyContent />
      </LocaleProvider>,
    );

    const secSource = screen.getByRole("listitem", { name: /Azio AI Holdings, Exhibit 99.1/ });
    expect(within(secSource).getByText("Publication date", { selector: "dt" })).toBeVisible();
    expect(within(secSource).getByText("July 9, 2026", { selector: "time" }))
      .toHaveAttribute("datetime", "2026-07-09");

    const directorySource = screen.getByRole("listitem", { name: /i-BVI public company-directory listing/ });
    expect(within(directorySource).getByText("Registration date shown by directory", { selector: "dt" }))
      .toBeVisible();
    expect(within(directorySource).getByText("July 3, 2018", { selector: "time" }))
      .toHaveAttribute("datetime", "2018-07-03");
    expect(within(directorySource).queryByText("Publication date", { selector: "dt" }))
      .not.toBeInTheDocument();
  });

  it("keeps the capacity reading sequence responsive at the required 760px breakpoint", async () => {
    const css = await readFile(resolve(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toMatch(/\.capacity-sequence\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*?\.company-timeline, \.capacity-sequence \{ grid-template-columns: 1fr; \}/);
  });

  it("stores the bounded public record with sourceable qualifications", () => {
    expect(COMPANY_CONTENT.en.announcement.dateTime).toBe("2026-07-09");
    expect(COMPANY_CONTENT.en.announcement.date).toBe("July 9, 2026");
    expect(COMPANY_CONTENT.en.capacity.initialMw).toBe("Approximately 3.1 MW");
    expect(COMPANY_CONTENT.en.capacity.initialReservation)
      .toBe("Approximately US$27.9M over the initial contract term");
    expect(COMPANY_CONTENT.en.capacity.initialLabel)
      .toBe("Counterparty-reported expected initial capacity and reservation context");
    expect(COMPANY_CONTENT.en.capacity.expansionLabel)
      .toBe("Counterparty-reported expansion context");
    expect(COMPANY_CONTENT.en.capacity.expansion)
      .toBe("Up to 12 MW if expansion rights are exercised");
    expect(COMPANY_CONTENT.en.capacity.potentialValue)
      .toBe("Approximately US$100M potential total contract value");
    expect(COMPANY_CONTENT.en.capacity.qualification).toContain("No assurance");
    expect(COMPANY_SOURCES.find((source) => source.id === "azio-sec-exhibit"))
      .toMatchObject({
        href: "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986209.htm",
        dateTime: "2026-07-09",
      });
    expect(COMPANY_SOURCES.find((source) => source.id === "bvi-directory")?.copy.en.kind)
      .toBe("Third-party public directory");
    expect(COMPANY_CONTENT.en.record.directoryQualification)
      .toContain("public company-directory listing");
    expect(COMPANY_CONTENT.zh.record.directoryQualification)
      .toContain("公開公司目錄列表");
    expect(COMPANY_CONTENT.zh.capacity.initialLabel).toContain("交易對手報告");
    expect(COMPANY_CONTENT.zh.capacity.qualification)
      .toContain("不保證擴充權會被行使或增加容量");
  });

  it("supplies each new copy-dictionary field in both locales", () => {
    for (const locale of ["en", "zh"] as const) {
      expect(COPY[locale].nav.company).not.toBe("");
      expect(COPY[locale].home.launchStatus).not.toBe("");
      expect(COPY[locale].checkout.launchNotice).not.toBe("");
      expect(COPY[locale].checkout.requestComplete).not.toBe("");
    }
  });
});
