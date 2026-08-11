# Dual-Audience Marketplace Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Power Champion a premium launch-access marketplace with clear developer and enterprise paths while keeping every conversion action non-transactional.

**Architecture:** Keep generic bilingual copy in `lib/content.ts` and all source-derived enterprise language in `lib/company.ts`. Add two focused client components: a Home-path renderer for normal links and a local-only enterprise enquiry form; use route-level pages and shared shell/navigation rather than parallel layouts.

**Tech Stack:** React 19, TypeScript, Vinext, Vitest, Testing Library, CSS, Dokploy.

## Global Constraints

- English is primary and Traditional Chinese is a complete parallel locale.
- The product is launch-only: no payment, checkout, binding order, account creation, API provisioning, live balance, live usage, analytics, or transmission/persistence of enquiry data.
- Company facts and all source-derived infrastructure wording remain exclusively in `lib/company.ts` and retain their source qualifiers.
- Never add unverified company claims, securities language, financial advice, live capacity claims, executive/office/customer information, or pricing guarantees.
- Maintain keyboard access, document language updates, skip links, focus traps, focus restoration, reduced motion, and source visibility at mobile sizes.
- Retain the dark/cyan system; remove visual noise instead of adding crypto imagery, stock charts, generic trust badges, or runtime dependencies.

---

## File structure

| File | Responsibility |
| --- | --- |
| `components/audience-paths.tsx` | Renders the two localized Home paths as ordinary links. |
| `components/enterprise-enquiry.tsx` | Owns local form selection/message state, validation, and local-only confirmation. |
| `app/contact/page.tsx` | Renders the enterprise enquiry route and qualified metadata. |
| `lib/content.ts` | Adds generic locale copy for Home paths, enquiry UI, developer labels, and console preview. |
| `components/home-content.tsx` | Integrates the Hero actions and `AudiencePaths` decision sequence. |
| `components/console-view.tsx` | Clarifies its read-only preview state and next action. |
| `components/site-shell.tsx` | Adds Contact to destination navigation only if its label fits the shared collection. |
| `app/globals.css` | Implements command-style Hero, sibling path panels, enquiry surface, and responsive contracts. |
| `tests/audience-paths.test.tsx` | Tests Home paths, locale switching, destinations, and visible launch state. |
| `tests/contact.test.tsx` | Tests form semantics, validation, local-only completion, and no sensitive/payment fields. |
| `tests/docs-console.test.tsx` | Tests the console preview wording and launch-access action. |
| `tests/rendered-html.test.mjs` | Adds `/contact` metadata and no-payment rendered smoke coverage. |

### Task 1: Add dual-path copy and Home decision surface

**Files:**
- Create: `components/audience-paths.tsx`
- Modify: `lib/content.ts`, `components/home-content.tsx`, `app/globals.css`
- Test: `tests/audience-paths.test.tsx`, `tests/homepage.test.tsx`

**Interfaces:**
- Produces `AudiencePaths()` which consumes `useLocale()` and returns two named links: developer path `/models`; enterprise path `/contact`.
- Extends `CopyDictionary` with `home.developerPath`, `home.enterprisePath`, `home.developerDescription`, and `home.enterpriseDescription` in both locales.

- [ ] **Step 1: Write failing Home-path tests**

```tsx
it("offers parallel developer and enterprise paths", () => {
  renderInShell(<HomeContent />);
  expect(screen.getByRole("link", { name: "Explore model access" })).toHaveAttribute("href", "/models");
  expect(screen.getByRole("link", { name: "Talk to infrastructure" })).toHaveAttribute("href", "/contact");
  expect(screen.getByText("Token access launching soon")).toBeVisible();
});
```

- [ ] **Step 2: Run focused test to verify it fails**

Run: `npm run test:unit -- tests/audience-paths.test.tsx tests/homepage.test.tsx`

Expected: FAIL because `AudiencePaths` and both links do not exist.

- [ ] **Step 3: Implement localized sibling paths and Hero integration**

```tsx
export function AudiencePaths() {
  const { copy } = useLocale();
  return <section aria-label={copy.home.pathsLabel} className="audience-paths">
    <a className="audience-path audience-path-developer" href="/models">
      <span>{copy.home.developerEyebrow}</span><strong>{copy.home.developerPath}</strong><p>{copy.home.developerDescription}</p>
    </a>
    <a className="audience-path audience-path-enterprise" href="/contact">
      <span>{copy.home.enterpriseEyebrow}</span><strong>{copy.home.enterprisePath}</strong><p>{copy.home.enterpriseDescription}</p>
    </a>
  </section>;
}
```

Place the links in the Hero action area and render the panels immediately after the Hero. Style them as sibling editorial panels with one active cyan rule, not repeated floating cards. At `max-width: 760px`, stack panels without hiding copy.

- [ ] **Step 4: Run focused and full checks**

Run: `npm run test:unit -- tests/audience-paths.test.tsx tests/homepage.test.tsx && npm run test:unit && npm run lint`

Expected: PASS in both locales; launch status stays visible.

- [ ] **Step 5: Commit**

```bash
git add components/audience-paths.tsx components/home-content.tsx lib/content.ts app/globals.css tests/audience-paths.test.tsx tests/homepage.test.tsx
git commit -m "feat: add developer and enterprise paths"
```

### Task 2: Build local-only enterprise enquiry

**Files:**
- Create: `components/enterprise-enquiry.tsx`, `app/contact/page.tsx`
- Modify: `lib/content.ts`, `components/site-shell.tsx`, `app/globals.css`
- Test: `tests/contact.test.tsx`, `tests/components.test.tsx`, `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces `EnterpriseEnquiry()` with no props and local state `{ interest: "" | "infrastructure" | "partnership", message: string, submitted: boolean }`.
- Produces `/contact` with metadata title `Contact | Power Champion` and launch-only description without financial figures.

- [ ] **Step 1: Write failing interaction and rendered tests**

```tsx
it("keeps enterprise enquiries local and payment-free", async () => {
  const user = userEvent.setup();
  render(<LocaleProvider><EnterpriseEnquiry /></LocaleProvider>);
  await user.click(screen.getByRole("button", { name: "Send enquiry" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose an interest area.");
  await user.selectOptions(screen.getByLabelText("I am interested in"), "infrastructure");
  await user.click(screen.getByRole("button", { name: "Send enquiry" }));
  expect(screen.getByRole("status")).toHaveTextContent("Nothing was sent or reserved.");
  expect(screen.queryByLabelText(/card|bank|email|password/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused test to verify it fails**

Run: `npm run test:unit -- tests/contact.test.tsx && node --test tests/rendered-html.test.mjs`

Expected: FAIL because component and route do not exist.

- [ ] **Step 3: Implement accessible enquiry and route**

Use a native `<select id="interest">`, optional `<textarea id="message">`, and submit button. Empty interest sets a localized error with `role="alert"`; success sets only local React state and renders localized `role="status"` confirmation saying no information was transmitted or reserved. Include one descriptive `/company` link. Add Contact to one shared `destinations` collection so desktop/mobile nav cannot drift.

- [ ] **Step 4: Run focused and release checks**

Run: `npm run test:unit -- tests/contact.test.tsx tests/components.test.tsx && npm test && npm run lint`

Expected: PASS; rendered route list includes `/contact` and no payment form/input.

- [ ] **Step 5: Commit**

```bash
git add components/enterprise-enquiry.tsx app/contact/page.tsx components/site-shell.tsx lib/content.ts app/globals.css tests/contact.test.tsx tests/components.test.tsx tests/rendered-html.test.mjs
git commit -m "feat: add local enterprise enquiry"
```

### Task 3: Clarify the developer preview and release verification

**Files:**
- Modify: `components/console-view.tsx`, `lib/content.ts`, `app/globals.css`
- Modify: `tests/docs-console.test.tsx`, `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes `copy.console.previewLabel`, `copy.console.previewDescription`, and `copy.nav.getTokens`.
- Produces an explicit preview label that does not imply a real user, funded account, usable key, live balance, or live usage.

- [ ] **Step 1: Write failing console contract tests**

```tsx
it("labels the console as a local launch preview", () => {
  render(<LocaleProvider><ConsoleView /></LocaleProvider>);
  expect(screen.getByText("Launch preview — illustrative only")).toBeVisible();
  expect(screen.queryByText(/your funded account|live API key/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Join launch access" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused test to verify it fails**

Run: `npm run test:unit -- tests/docs-console.test.tsx`

Expected: FAIL because the explicit preview label is absent.

- [ ] **Step 3: Implement the preview state and restrained styling**

Render the localized preview label before console metrics, keep the existing illustrative disclosure, and use the same launch-access button text as the rest of the site. Simplify only console-specific visual noise; do not change model data or make the graphs look live.

- [ ] **Step 4: Run full verification and manual responsive inspection**

Run: `npm test && npm run lint`

Expected: all unit/build/rendered checks pass, including `/contact`. Inspect Home and Contact at 1440px and 390px: both paths and all enquiry labels are visible; no horizontal overflow.

- [ ] **Step 5: Commit**

```bash
git add components/console-view.tsx lib/content.ts app/globals.css tests/docs-console.test.tsx tests/rendered-html.test.mjs
git commit -m "feat: refine developer launch preview"
```

## Plan self-review

- **Spec coverage:** Task 1 covers dual Home paths and premium hierarchy; Task 2 covers enterprise enquiry, navigation, metadata, local-only boundaries, and form accessibility; Task 3 covers console truthfulness, full route verification, and responsive inspection.
- **No placeholders:** every task names files, interfaces, failing test behavior, commands, implementation specifics, and commit scope.
- **Type consistency:** `AudiencePaths`, `EnterpriseEnquiry`, and their copy fields are introduced before consuming pages/tests; all enquiry state values are defined in Task 2.
