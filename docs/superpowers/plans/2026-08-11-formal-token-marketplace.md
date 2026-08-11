# Formal Token Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing display-only marketplace into a credible public token-access launch site with a fully sourced Company page and no live payment behavior.

**Architecture:** Place all company facts, source links, qualifications, and bilingual text in a new typed `lib/company.ts` module. Render that module through a server-safe `/company` page and a small client component that consumes the existing locale context; reuse the site shell, model catalog, checkout event, and modal isolation instead of creating a second navigation or dialog system.

**Tech Stack:** Next-compatible React 19, TypeScript, Vinext, Vitest, Testing Library, CSS, Dokploy Docker deployment.

## Global Constraints

- English is the primary locale; Traditional Chinese is a complete parallel locale.
- The site remains non-transactional: no payment fields, charges, binding orders, account creation, token issuance, API keys, or live usage.
- Public agreement numbers must be qualified as counterparty-reported information. Expansion is visibly marked `Potential; subject to conditions and not guaranteed`.
- Do not claim revenue, executed full deployment, exercised expansion, data-centre ownership, regulatory approval, company leadership, office address, or good standing.
- Refer to the BVI result only as a public company-directory listing, not an official registry.
- The existing dark, precise visual system remains; no crypto imagery, price charts, stock widgets, speculative graphics, or generic trust badges.
- All new controls and source links must be keyboard-accessible and locally bilingual.
- Capacity context must remain visible at narrow widths; it may stack but cannot be hidden.
- Node must remain `>=22.13.0`; add no runtime dependencies.

---

## File structure

| File | Responsibility |
| --- | --- |
| `lib/company.ts` | Typed, single-source bilingual company facts, source metadata, and disclosure copy. |
| `components/company-content.tsx` | Locale-aware rendering of company record, announcement, capacity sequence, and sources. |
| `app/company/page.tsx` | `/company` route and route-specific metadata. |
| `components/site-shell.tsx` | Adds Company to desktop/mobile navigation and makes the footer About link canonical. |
| `components/home-content.tsx` | Adds a compact factual infrastructure proof strip and links it to Company. |
| `app/pricing/page.tsx` | Uses launch-access language instead of a buy-token prompt. |
| `components/demo-checkout.tsx` | Turns the existing demo-order dialog into a clearly non-binding launch-access request preview. |
| `lib/content.ts` | Adds localized labels for Company, launch access, the checkout notice, and sourced-product messaging. |
| `app/globals.css` | Adds Company page, proof strip, and responsive styles without suppressing capacity facts. |
| `tests/company.test.tsx` | Covers factual content, sources, qualifications, semantics, and locale switching. |
| `tests/components.test.tsx` | Updates shell navigation/footer assertions for the Company route. |
| `tests/homepage.test.tsx` | Covers the Company proof strip and its localized source context. |
| `tests/pricing.test.tsx` | Covers launch-access language and the no-payment / non-binding request message. |
| `tests/rendered-html.test.mjs` | Adds `/company` to built-route smoke coverage and checks its metadata/source anchors. |

### Task 1: Define verified company data and locale interfaces

**Files:**
- Create: `lib/company.ts`
- Modify: `lib/content.ts`
- Test: `tests/company.test.tsx`

**Interfaces:**
- Produces `type CompanyLocale = "en" | "zh"`, `type CompanyContent`, and `const COMPANY_CONTENT: Record<CompanyLocale, CompanyContent>`.
- Produces `const COMPANY_SOURCES` with an `id`, `href`, semantic `dateTime`, and localized label, kind, date label, and display date for the SEC exhibit and BVI directory.
- Extends `CopyDictionary` with exact `nav.company`, `home.launchStatus`, `checkout.launchNotice`, and `checkout.requestComplete` string fields; company-specific Home copy remains in `lib/company.ts`.
- Consumes `Locale` from `lib/content.ts`; it must stay compatible with `CompanyLocale`.

- [ ] **Step 1: Write the failing data-contract test**

```tsx
import { COMPANY_CONTENT, COMPANY_SOURCES } from "../lib/company";

it("stores the bounded public record with sourceable qualifications", () => {
  expect(COMPANY_CONTENT.en.capacity.initialMw).toBe("Approximately 3.1 MW");
  expect(COMPANY_CONTENT.en.capacity.initialReservation)
    .toBe("Approximately US$27.9M over the initial contract term");
  expect(COMPANY_CONTENT.en.capacity.expansion).toContain("12 MW");
  expect(COMPANY_CONTENT.en.capacity.qualification).toContain("No assurance");
  expect(COMPANY_SOURCES.map((source) => source.href)).toContain(
    "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986209.htm",
  );
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test:unit -- tests/company.test.tsx`

Expected: FAIL because `../lib/company` does not exist.

- [ ] **Step 3: Implement the typed source module and exact copy fields**

```ts
export type CompanyLocale = "en" | "zh";

export const COMPANY_SOURCES = [
  {
    id: "azio-sec-exhibit",
    href: "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986209.htm",
    dateTime: "2026-07-09",
    copy: {
      en: { label: "Azio AI Holdings, Exhibit 99.1", kind: "Counterparty SEC-filed disclosure", dateLabel: "Publication date", date: "July 9, 2026" },
      zh: { label: "Azio AI Holdings，附件 99.1", kind: "交易對手向 SEC 提交的揭露", dateLabel: "發布日期", date: "2026 年 7 月 9 日" },
    },
  },
  {
    id: "bvi-directory",
    href: "https://i-bvi.com/company/power-champion-investment-limited_391718",
    dateTime: "2018-07-03",
    copy: {
      en: { label: "i-BVI public company-directory listing", kind: "Third-party public directory", dateLabel: "Registration date shown by directory", date: "July 3, 2018" },
      zh: { label: "i-BVI 公開公司目錄列表", kind: "第三方公開公司目錄", dateLabel: "目錄所列登記日期", date: "2018 年 7 月 3 日" },
    },
  },
] as const;
```

Define the bilingual `COMPANY_CONTENT` fields used in later tasks: page kicker/title/lead; company-record label and directory qualification; announcement heading/date/summary; initial capacity/reservation/deposit context; expansion capacity/potential value/qualification; sources heading; and legal disclosure. English copy must say the agreement was announced by the counterparty and that figures are not an offer of securities, investment advice, performance guidance, or a promise of capacity/service. Chinese fields must convey the same limits rather than a paraphrase that weakens them.

- [ ] **Step 4: Run focused tests and TypeScript-aware lint**

Run: `npm run test:unit -- tests/company.test.tsx && npm run lint`

Expected: PASS, with the module supplying both locales and no lint errors.

- [ ] **Step 5: Commit the self-contained data contract**

```bash
git add lib/company.ts lib/content.ts tests/company.test.tsx
git commit -m "feat: add sourced company data"
```

### Task 2: Build the accessible Company route and responsive evidence brief

**Files:**
- Create: `components/company-content.tsx`
- Create: `app/company/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/company.test.tsx`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes `COMPANY_CONTENT`, `COMPANY_SOURCES`, and `useLocale()`.
- Produces `CompanyContent`, rendered at `/company`, with `main#main-content` and named source/disclosure regions.
- Produces static `metadata` in `app/company/page.tsx` with no financial number in the title or description.

- [ ] **Step 1: Write the failing route/component tests**

```tsx
it("renders qualified capacity information and verifiable sources", () => {
  render(<LocaleProvider><CompanyContent /></LocaleProvider>);

  expect(screen.getByRole("heading", { level: 1, name: /Infrastructure, made accountable/i }))
    .toBeInTheDocument();
  expect(screen.getByText("Approximately 3.1 MW")).toBeVisible();
  expect(screen.getByText("Approximately US$27.9M over the initial contract term"))
    .toBeVisible();
  expect(screen.getByText("Potential; subject to conditions and not guaranteed."))
    .toBeVisible();
  expect(screen.getByRole("link", { name: /Azio AI Holdings, Exhibit 99.1/i }))
    .toHaveAttribute("href", expect.stringContaining("sec.gov"));
});
```

Extend the rendered smoke test with `"/company"` and assert the built HTML includes a canonical Company title, `3.1 MW`, and the SEC source URL.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test:unit -- tests/company.test.tsx && node --test tests/rendered-html.test.mjs`

Expected: FAIL because neither the component nor `/company` exists.

- [ ] **Step 3: Implement semantic Company content and metadata**

```tsx
export function CompanyContent() {
  const { locale } = useLocale();
  const content = COMPANY_CONTENT[locale];

  return (
    <main className="company-page" id="main-content">
      <section aria-labelledby="company-title" className="company-hero">
        <p className="eyebrow">{content.kicker}</p>
        <h1 id="company-title">{content.title}</h1>
        <p>{content.lead}</p>
      </section>
      <section aria-labelledby="capacity-title" className="capacity-brief">
        <h2 id="capacity-title">{content.capacity.title}</h2>
        <dl className="capacity-sequence">{/* initial / expansion facts */}</dl>
        <p className="capacity-qualification">{content.capacity.qualification}</p>
      </section>
      <section aria-labelledby="sources-title" className="source-disclosures">
        <h2 id="sources-title">{content.sourcesTitle}</h2>
        <ul>{COMPANY_SOURCES.map((source) => <li key={source.id}><a href={source.href}>{source.label}</a></li>)}</ul>
        <p>{content.disclosure}</p>
      </section>
    </main>
  );
}
```

Use a definition list for capacity facts, an ordered timeline for the company record/announcement sequence, and a native list for sources. External links include `target="_blank"` and `rel="noreferrer"`; their accessible text names the source, not `Read more`. Do not use an image to represent any factual content.

In `app/company/page.tsx`, export:

```ts
export const metadata = {
  title: "Company | Power Champion",
  description: "Public company context and cited AI infrastructure information for Power Champion.",
};
```

Add CSS that makes `.capacity-sequence` a three-column reading sequence at large widths and one-column at `max-width: 760px`. Do not set `display: none`, `visibility: hidden`, or `content-visibility: hidden` on capacity facts in any media rule.

- [ ] **Step 4: Run focused tests, full unit tests, lint, and a production build**

Run: `npm run test:unit -- tests/company.test.tsx && npm run test:unit && npm run lint && npm run build && node --test tests/rendered-html.test.mjs`

Expected: PASS. The rendered check includes `/company` and no source or metadata assertion fails.

- [ ] **Step 5: Commit the Company page**

```bash
git add components/company-content.tsx app/company/page.tsx app/globals.css tests/company.test.tsx tests/rendered-html.test.mjs
git commit -m "feat: add company evidence page"
```

### Task 3: Integrate Company navigation and product-led infrastructure context

**Files:**
- Modify: `components/site-shell.tsx`
- Modify: `components/home-content.tsx`
- Modify: `lib/content.ts`
- Modify: `app/globals.css`
- Modify: `tests/components.test.tsx`
- Modify: `tests/homepage.test.tsx`

**Interfaces:**
- Consumes `copy.nav.company`, `copy.home.infrastructureProof`, `copy.home.companyLink`, and `COMPANY_CONTENT` for only the exact public fact displayed on Home.
- Produces `/company` navigation links in desktop, mobile, and footer navigation, and a home proof strip which links to `/company`.

- [ ] **Step 1: Write the failing integration tests**

```tsx
it("adds Company to primary navigation, mobile navigation, and footer", () => {
  render(<LocaleProvider><SiteShell><main>Content</main></SiteShell></LocaleProvider>);
  expect(within(screen.getByRole("navigation", { name: "Primary navigation" }))
    .getByRole("link", { name: "Company" })).toHaveAttribute("href", "/company");
  expect(within(screen.getByRole("contentinfo", { name: "Footer" }))
    .getByRole("link", { name: "About" })).toHaveAttribute("href", "/company");
});

it("links the factual home infrastructure brief to Company", () => {
  renderInShell(<HomeContent />);
  expect(screen.getByRole("link", { name: /View company context/i }))
    .toHaveAttribute("href", "/company");
  expect(screen.getByText("Approximately 3.1 MW")).toBeVisible();
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test:unit -- tests/components.test.tsx tests/homepage.test.tsx`

Expected: FAIL because Company links and the home brief are absent.

- [ ] **Step 3: Add the navigation and compact proof strip**

Change `destinations` to include `["company", "/company"]` between Docs and Console. Change the footer About target from `/#about` to `/company` while retaining the localized `About` label. Use the same `destinations` collection in the mobile dialog so no navigation variant drifts.

Insert one `home-infrastructure-brief` section after the existing proof strip. It contains a source-qualified heading, the counterparty-reported expected approximately `3.1 MW` contracted hosting-capacity context, and a single link to `/company`; it does not repeat US$ values or make any claim of live or completed capacity. Its source qualification must be visible and bound through `aria-describedby` to the fact.

Add styles that separate this proof strip through borders and editorial labels rather than another floating-card surface. At narrow widths, use a single-column layout and keep all text visible.

- [ ] **Step 4: Run focused and full checks**

Run: `npm run test:unit -- tests/components.test.tsx tests/homepage.test.tsx && npm run test:unit && npm run lint`

Expected: PASS in English and Traditional Chinese, with the footer canonical target updated.

- [ ] **Step 5: Commit navigation and homepage integration**

```bash
git add components/site-shell.tsx components/home-content.tsx lib/content.ts app/globals.css tests/components.test.tsx tests/homepage.test.tsx
git commit -m "feat: connect company context to marketplace"
```

### Task 4: Convert the purchase intent journey to launch access

**Files:**
- Modify: `components/demo-checkout.tsx`
- Modify: `app/pricing/page.tsx`
- Modify: `components/home-content.tsx`
- Modify: `lib/content.ts`
- Modify: `tests/pricing.test.tsx`
- Modify: `tests/homepage.test.tsx`

**Interfaces:**
- Consumes `copy.nav.getTokens` renamed in both locales to launch-access wording, `copy.checkout.launchNotice`, and `copy.checkout.requestComplete`.
- Retains `openCheckout(packId?: CreditPack["id"])` and `powerchampion:checkout`; no callers change event shape.
- Produces a dialog that completes only as a local request preview and cannot collect payment data.

- [ ] **Step 1: Write the failing launch-access test**

```tsx
it("makes launch access non-binding and payment-free", async () => {
  const user = userEvent.setup();
  render(<LocaleProvider><DemoCheckout open /></LocaleProvider>);

  expect(screen.getByText("Payments are not enabled yet. This request does not create an order or charge your account."))
    .toBeVisible();
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));

  expect(screen.getByText("Launch access request saved locally.")).toBeVisible();
  expect(screen.queryByLabelText(/card|payment|billing/i)).not.toBeInTheDocument();
});
```

Update the pricing page assertion to require `Join launch access` and to reject a `Buy`, `Pay`, or `Checkout` primary action.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test:unit -- tests/pricing.test.tsx tests/homepage.test.tsx`

Expected: FAIL because current UI says `Get tokens` and completes a demo checkout.

- [ ] **Step 3: Implement launch-access copy without changing modal mechanics**

Change only the presentation strings and labels; keep the select/review/complete state machine, Escape handling, focus trap, focus restoration, and `useModalIsolation` unchanged.

Required English strings:

```ts
nav: { getTokens: "Join launch access" },
checkout: {
  title: "Request launch access",
  choose: "Choose an indicative package",
  review: "Review your request",
  complete: "Launch access request saved locally.",
  demoOnly: "Payments are not enabled yet. This request does not create an order or charge your account.",
}
```

Use semantically equivalent Traditional Chinese strings. Replace `Showcase price`, `Account credit`, and `Showcase bonus` in the review step with `Indicative package`, `Indicative account credit`, and `Indicative launch bonus` (plus Chinese equivalents). The final state must say that the saved request is local to this demonstration and does not reserve capacity.

- [ ] **Step 4: Verify focused behavior and complete regression suite**

Run: `npm run test:unit -- tests/pricing.test.tsx tests/components.test.tsx tests/homepage.test.tsx && npm run test:unit && npm run lint && npm run build && node --test tests/rendered-html.test.mjs`

Expected: PASS. Existing focus-return and keyboard tests remain green; no rendered HTML includes payment input fields.

- [ ] **Step 5: Commit the non-transactional launch-access flow**

```bash
git add components/demo-checkout.tsx app/pricing/page.tsx components/home-content.tsx lib/content.ts tests/pricing.test.tsx tests/homepage.test.tsx
git commit -m "feat: present token access as coming soon"
```

### Task 5: Verify release output and deploy through the established Dokploy pipeline

**Files:**
- Modify only if a verification exposes a concrete defect: the smallest relevant source/test file from Tasks 1–4.

**Interfaces:**
- Consumes GitHub `main`, Dokploy auto-deploy, and the public `/`, `/models`, `/pricing`, `/docs`, `/company`, `/console` routes.
- Produces a verified GitHub revision and a deployed Dokploy revision; no DNS change is part of this task.

- [ ] **Step 1: Run the release test suite from a clean working tree**

Run: `git status --short && npm test && npm run lint`

Expected: an empty status before the test run, 100% passing unit/build/rendered tests, and no lint errors.

- [ ] **Step 2: Inspect the built Company route’s substantive contract**

Run: `node --test tests/rendered-html.test.mjs`

Expected: PASS for all six public routes, including `/company`; its built HTML contains a canonical Company title, source link, `3.1 MW`, and qualification text.

- [ ] **Step 3: Push the committed implementation**

```bash
git push origin main
```

Expected: `main` is accepted by GitHub and starts Dokploy auto-deployment.

- [ ] **Step 4: Verify Dokploy deployment and HTTPS routes**

Use the existing scoped Dokploy credential file outside the repository to check the current compose deployment until it reports success. Then request each public route with its host header: `/`, `/models`, `/pricing`, `/docs`, `/company`, `/console`.

Expected: HTTP 200 at every route, with the Company page returning the new source-qualified content. Never print, commit, or expose credentials.

- [ ] **Step 5: Commit any concrete release-only fix, otherwise report the deployed commit**

If a verified defect required a source change:

```bash
git add <the exact changed files>
git commit -m "fix: correct marketplace release verification"
git push origin main
```

Otherwise make no empty commit. Report the existing feature commit IDs, test results, GitHub push, and Dokploy deployment status.

## Plan self-review

- **Spec coverage:** data source and qualifications are Task 1; semantic Company route and SEO are Task 2; public navigation/home context and mobile visibility are Task 3; coming-soon purchase intent and preserved modal accessibility are Task 4; full test/build/push/Dokploy verification is Task 5.
- **No placeholders:** the plan contains no deferred-work markers, generic validation language, or undefined interface names. Every task names exact paths, signatures, test commands, and commit actions.
- **Type consistency:** `CompanyLocale` is compatible with the existing `Locale`; `COMPANY_CONTENT`, `COMPANY_SOURCES`, `useLocale`, and `openCheckout` are introduced before consumers use them. The event shape is deliberately preserved.
