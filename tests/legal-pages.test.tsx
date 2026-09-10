import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import DataRetentionPage from "../app/data-retention/page";
import PrivacyPage from "../app/privacy/page";
import TermsPage from "../app/terms/page";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_ENTITY,
  POLICY_CONTENT,
} from "../lib/trust";

const pages = [
  ["privacy", <PrivacyPage key="privacy" />],
  ["terms", <TermsPage key="terms" />],
  ["dataRetention", <DataRetentionPage key="data-retention" />],
] as const;

/**
 * The cross-link contract handed over from the gateway's retirement plan:
 * privacy <-> terms <-> data-retention, three-way, in both locales. The
 * gateway's own suite could only keep a weaker "at least one sibling" check
 * once its HTML shell was deleted, so the full assertion lives here.
 */
const POLICY_HREF = {
  privacy: "/privacy",
  terms: "/terms",
  dataRetention: "/data-retention",
} as const;

const POLICY_LABEL = {
  en: {
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    dataRetention: "Data Retention Policy",
  },
  zh: {
    privacy: "隱私權政策",
    terms: "服務條款",
    dataRetention: "資料保存政策",
  },
} as const;

const SIBLINGS = {
  privacy: ["terms", "dataRetention"],
  terms: ["privacy", "dataRetention"],
  dataRetention: ["privacy", "terms"],
} as const;

// Terms that are allowed to appear in Latin script inside zh-Hant body copy —
// proper nouns, the contact address, a literal API path, and industry
// acronyms/terms with no established zh translation on this site. These are
// the same terms the *English* body also uses verbatim (endpoint names,
// hardware acronyms, protocol terminology, third-party product names) —
// not English prose that should have been translated.
const LATIN_ALLOWLIST = [
  "Power Champion Investment Limited",
  "info@powerchampion.org",
  "b300.powerchampion.ai",
  "POST /api/balance",
  "API",
  "SLA",
  "HTTPS",
  "GPU",
  "Bearer",
  "OpenRouter",
  "Tokens",
  "Token",
  "OpenAI",
  "JSON",
  "URL",
];

function stripAllowlist(text: string): string {
  return LATIN_ALLOWLIST.reduce((acc, term) => acc.split(term).join(" "), text);
}

function countLatinWords(text: string): number {
  return (stripAllowlist(text).match(/[A-Za-z]{3,}/g) ?? []).length;
}

function countCjkChars(text: string): number {
  return (text.match(/[一-鿿]/g) ?? []).length;
}

describe("published legal pages", () => {
  it.each(pages)("%s carries the entity, effective date and contact", (_id, page) => {
    render(<LocaleProvider>{page}</LocaleProvider>);
    const text = document.body.textContent ?? "";

    expect(text).toContain(LEGAL_ENTITY);
    expect(text).toContain(LEGAL_EFFECTIVE_DATE);
    expect(text).toContain(LEGAL_CONTACT_EMAIL);
  });

  it.each(pages)("%s contains no unfilled placeholder", (_id, page) => {
    render(<LocaleProvider>{page}</LocaleProvider>);
    const text = document.body.textContent ?? "";

    expect(text).not.toMatch(/\[/);
    expect(text).not.toMatch(/TBD/i);
    expect(text).not.toMatch(/yourdomain/i);
    // The .org mailbox is the real contact address; a .org *URL* is the stale
    // domain from the retired static site and must never appear.
    expect(text).not.toMatch(/https?:\/\/[^\s]*powerchampion\.org/i);
    expect(text).not.toMatch(/powerchampion\.org\//i);
  });

  it.each(pages)("%s contains no unfilled placeholder in Traditional Chinese either", async (_id, page) => {
    const user = userEvent.setup();
    render(<LocaleProvider><SiteShell>{page}</SiteShell></LocaleProvider>);
    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);

    const text = screen.getByRole("main").textContent ?? "";

    expect(text).not.toMatch(/\[/);
    expect(text).not.toMatch(/TBD/i);
    expect(text).not.toMatch(/yourdomain/i);
    expect(text).not.toMatch(/https?:\/\/[^\s]*powerchampion\.org/i);
    expect(text).not.toMatch(/powerchampion\.org\//i);
    // A page that still shows English body copy is an untranslated page. A
    // single stray CJK character among an otherwise-English body must not
    // pass, so this binds on the actual mix: allowlisted proper nouns and
    // acronyms aside, Latin words must be rare, and CJK characters must
    // outnumber them outright.
    const latinWordCount = countLatinWords(text);
    const cjkCharCount = countCjkChars(text);
    expect(latinWordCount).toBeLessThanOrEqual(5);
    expect(cjkCharCount).toBeGreaterThan(latinWordCount);
  });

  it("cross-links the three policies in both directions", () => {
    render(<LocaleProvider><PrivacyPage /></LocaleProvider>);
    expect(screen.getByRole("link", { name: "Data Retention Policy" })).toHaveAttribute("href", "/data-retention");
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  });

  it.each(pages)("%s links to both sibling policies in English", (id, page) => {
    render(<LocaleProvider>{page}</LocaleProvider>);
    const related = screen.getByRole("navigation", { name: "Related policies" });
    const links = within(related).getAllByRole("link");

    expect(links).toHaveLength(2);
    for (const sibling of SIBLINGS[id]) {
      expect(within(related).getByRole("link", { name: POLICY_LABEL.en[sibling] }))
        .toHaveAttribute("href", POLICY_HREF[sibling]);
    }
  });

  it.each(pages)("%s links to both sibling policies in Traditional Chinese", async (id, page) => {
    const user = userEvent.setup();
    render(<LocaleProvider><SiteShell>{page}</SiteShell></LocaleProvider>);
    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);

    const related = screen.getByRole("navigation", { name: "相關政策" });
    const links = within(related).getAllByRole("link");

    expect(links).toHaveLength(2);
    for (const sibling of SIBLINGS[id]) {
      expect(within(related).getByRole("link", { name: POLICY_LABEL.zh[sibling] }))
        .toHaveAttribute("href", POLICY_HREF[sibling]);
    }
  });

  it("states the no-content-storage guarantee on privacy and data retention", () => {
    render(<LocaleProvider><PrivacyPage /></LocaleProvider>);
    expect(screen.getByText(/We do not store prompt or completion content\./)).toBeVisible();
  });

  it("states the retention rule the gateway actually implements", () => {
    render(<LocaleProvider><DataRetentionPage /></LocaleProvider>);
    expect(screen.getByText(/not written to persistent storage/)).toBeVisible();
    expect(screen.getByText(/not used to train, fine-tune, or evaluate machine-learning models\./)).toBeVisible();
  });

  it("data-retention lead promises exactly what the body does: purpose-bound retention, no fixed window", () => {
    // The body (usage-metadata section, both locales) only ever promises
    // "only as long as needed for billing and reconciliation" — never a
    // defined/fixed retention period. The lead must not over-promise a
    // specific duration the body doesn't back up.
    const enLead = POLICY_CONTENT.en.dataRetention.lead;
    const zhLead = POLICY_CONTENT.zh.dataRetention.lead;

    expect(enLead).not.toMatch(/for how long/i);
    expect(enLead).not.toMatch(/defined|fixed|specific(?:ally)? (?:period|duration|window)/i);
    expect(enLead).toMatch(/only as long as (?:necessary|needed)/i);

    expect(zhLead).not.toMatch(/明確的保存期間/);
    expect(zhLead).not.toMatch(/固定(?:的)?保存期間/);
    expect(zhLead).toMatch(/僅於(?:必要|所需)期間內保存/);
  });

  it("states that there is no uptime guarantee without a signed SLA", () => {
    render(<LocaleProvider><TermsPage /></LocaleProvider>);
    expect(screen.getByText(/no specific uptime or latency is guaranteed\./)).toBeVisible();
  });

  it("renders every section in Traditional Chinese too", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><DataRetentionPage /></SiteShell>
      </LocaleProvider>,
    );

    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);
    expect(screen.getByRole("heading", { level: 1, name: "資料保存政策" })).toBeVisible();
    expect(screen.getByText(/提示內容與模型輸出不會被用於訓練、微調或評估任何機器學習模型。/)).toBeVisible();
  });

  it("keeps both locales structurally parallel", () => {
    for (const policy of ["privacy", "terms", "dataRetention"] as const) {
      const en = POLICY_CONTENT.en[policy];
      const zh = POLICY_CONTENT.zh[policy];
      expect(zh.sections.map((section) => section.id)).toEqual(en.sections.map((section) => section.id));
      expect(zh.related.map((link) => link.href)).toEqual(en.related.map((link) => link.href));
      for (const section of [...en.sections, ...zh.sections]) {
        expect(section.title, section.id).toBeTruthy();
        expect(section.body.length, section.id).toBeGreaterThan(0);
      }
    }
  });

  it("links Data retention from the footer", () => {
    render(
      <LocaleProvider>
        <SiteShell><main id="main-content">Content</main></SiteShell>
      </LocaleProvider>,
    );

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Data retention" }))
      .toHaveAttribute("href", "/data-retention");
  });
});
