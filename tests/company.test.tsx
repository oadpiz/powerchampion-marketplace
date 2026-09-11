import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CompanyContent } from "../components/company-content";
import { InternationalSite } from "../components/international-site";
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

    expect(screen.getByRole("heading", { level: 1, name: /AI models to build with. Infrastructure to grow on/i }))
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
    expect(screen.getByRole("link", { name: "Review infrastructure" }))
      .toHaveAttribute("href", "/infrastructure");
    expect(screen.getByRole("link", { name: "Start deployment review" }))
      .toHaveAttribute("href", "/contact");
  });

  it("connects concrete services and application patterns to real access routes", () => {
    render(<LocaleProvider><CompanyContent /></LocaleProvider>);

    const api = screen.getByRole("article", { name: "Model API" });
    const gpu = screen.getByRole("article", { name: "Dedicated GPU" });
    const custom = screen.getByRole("article", { name: "Custom deployment" });
    expect(within(api).getByRole("link", { name: "Read API documentation" })).toHaveAttribute("href", "/docs");
    expect(within(gpu).getByRole("link", { name: "Explore GPU infrastructure" })).toHaveAttribute("href", "/infrastructure");
    expect(within(custom).getByRole("link", { name: "Discuss a custom deployment" })).toHaveAttribute("href", "/contact");
    expect(within(gpu).getByText(/availability, and commercial terms are confirmed through review/)).toBeVisible();

    const applications = screen.getByRole("region", { name: "Start with what you want to build." });
    expect(within(applications).getAllByRole("article")).toHaveLength(4);
    expect(within(applications).getByRole("link", { name: "Qwen3-VL 30B" })).toHaveAttribute("href", "/models#qwen3-vl-30b");
    expect(within(applications).getByRole("link", { name: "BGE-M3" })).toHaveAttribute("href", "/models#bge-m3");
    expect(within(applications).getByRole("link", { name: "Whisper Large v3" })).toHaveAttribute("href", "/models#whisper-large-v3");
    expect(screen.getByText(/platform overview is a starting point for review, not a capacity commitment/)).toBeVisible();
    expect(document.body).not.toHaveTextContent(/1000\+|without egress fees|trillion-parameter|400G\/800G/);
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

  it("links to the same company section and renders its qualified Traditional Chinese record", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/company");
    const english = render(
      <LocaleProvider><SiteShell><CompanyContent /></SiteShell></LocaleProvider>,
    );
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Language: English" }));
    const languages = within(screen.getByRole("navigation", { name: "Website language" }));
    expect(languages.getByRole("link", { name: "繁體中文" })).toHaveAttribute("href", "/zh-Hant/company");
    expect(languages.getByRole("link", { name: "日本語" })).toHaveAttribute("href", "/ja/company");
    expect(screen.getByRole("heading", { level: 1, name: /AI models to build with. Infrastructure to grow on/i })).toBeVisible();

    // A dedicated language link loads another document, not an in-place copy swap.
    english.unmount();
    window.history.replaceState({}, "", "/zh-Hant/company");
    render(<LocaleProvider><InternationalSite language="zh-Hant" section="company" /></LocaleProvider>);
    expect(screen.getByRole("heading", { level: 1, name: "模型服務與算力，連成一條路。" })).toBeVisible();
    expect(screen.getByText(/Power Champion Investment Limited 的服務涵蓋模型 API 與企業 GPU 規劃/)).toBeVisible();
    expect(screen.getByText(/2026 年 7 月 9 日.*約 3.1 MW 的預期初期託管容量/)).toBeVisible();
    expect(screen.getByText(/不代表已完成部署、即時可售容量或 Power Champion 已收到營收/)).toBeVisible();
    expect(screen.getByRole("link", { name: "閱讀交易對手 SEC 揭露" })).toHaveAttribute(
      "href", "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986209.htm",
    );
    expect(screen.getAllByRole("link", { name: "GPU 算力" }).some((link) => link.getAttribute("href") === "/zh-Hant/infrastructure")).toBe(true);
    expect(screen.getAllByRole("link", { name: "info@powerchampion.org" })[0]).toHaveAttribute("href", "mailto:info@powerchampion.org");
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
