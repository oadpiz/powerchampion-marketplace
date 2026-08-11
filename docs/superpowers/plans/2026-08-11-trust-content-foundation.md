# Trust Content Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace placeholder footer items with bilingual Terms, Privacy, Status, and FAQ content that truthfully describes the launch-only site.

**Architecture:** Store generic document and FAQ copy in `lib/content.ts`, render a shared editorial document component for static routes, and keep Company facts out of these documents. Use native `<details>` FAQ controls and existing shell navigation.

**Tech Stack:** React 19, TypeScript, Vinext, Vitest, Testing Library, CSS.

## Global Constraints

- English primary and Traditional Chinese complete.
- No payment, account, API, live monitoring, SLA, data collection, analytics, support contact, or legal assurance claim.
- Terms/Privacy/Status are informational launch content; Company source facts stay in `lib/company.ts`.
- Preserve semantic main landmarks, keyboard access, mobile visibility, and current dark/cyan editorial visual system.

---

### Task 1: Add bilingual document routes and active footer links

**Files:**
- Create: `components/content-document.tsx`, `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/status/page.tsx`
- Modify: `lib/content.ts`, `components/site-shell.tsx`, `app/globals.css`
- Test: `tests/content-pages.test.tsx`, `tests/components.test.tsx`, `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces `ContentDocument({ documentId }: { documentId: "terms" | "privacy" | "status" })`.
- Extends `CopyDictionary` with `documents` records containing title, lead, sections, and status label.

- [ ] **Step 1: Write failing route and footer tests**

```tsx
it("links active trust documents from the footer", () => {
  render(<LocaleProvider><SiteShell><main>Content</main></SiteShell></LocaleProvider>);
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  expect(screen.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
});
```

- [ ] **Step 2: Run focused test to verify it fails**

Run: `npm run test:unit -- tests/content-pages.test.tsx tests/components.test.tsx`

Expected: FAIL because the routes and active footer links do not exist.

- [ ] **Step 3: Implement document data, semantic routes, and styles**

Use localized `<h1>`, `<section><h2>`, and paragraphs. Required visible claims: Terms says payments/access are not live; Privacy says local interactions are not transmitted/persisted; Status says `Launch preparation` and `Not a live monitoring dashboard or SLA`. Metadata must not include financial figures or active-service claims. Footer anchors are no longer `aria-disabled`.

- [ ] **Step 4: Verify focused and full suite**

Run: `npm test && npm run lint`

Expected: all routes render and no document contains payment input or live-service claim.

- [ ] **Step 5: Commit**

```bash
git add components/content-document.tsx app/terms/page.tsx app/privacy/page.tsx app/status/page.tsx lib/content.ts components/site-shell.tsx app/globals.css tests/content-pages.test.tsx tests/components.test.tsx tests/rendered-html.test.mjs
git commit -m "feat: add launch trust documents"
```

### Task 2: Add accessible FAQ and decision links

**Files:**
- Create: `app/faq/page.tsx`, `components/faq-list.tsx`
- Modify: `lib/content.ts`, `app/pricing/page.tsx`, `app/contact/page.tsx`, `app/globals.css`
- Test: `tests/faq.test.tsx`, `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces `FaqList({ scope }: { scope: "all" | "pricing" | "contact" })` using native `<details>` and localized FAQ data.

- [ ] **Step 1: Write failing FAQ tests**

```tsx
it("answers launch-only pricing without implying a purchase", async () => {
  const user = userEvent.setup();
  render(<LocaleProvider><FaqList scope="pricing" /></LocaleProvider>);
  await user.click(screen.getByText("Are payments available now?"));
  expect(screen.getByText(/Payments are not enabled/i)).toBeVisible();
});
```

- [ ] **Step 2: Run focused test to verify it fails**

Run: `npm run test:unit -- tests/faq.test.tsx`

Expected: FAIL because FAQ component/data is absent.

- [ ] **Step 3: Implement FAQ and links**

Include questions covering model access, indicative prices, payments, local enquiry, Company sources, and launch access. Answers link to `/company`, `/contact`, or `/pricing` only when relevant; do not repeat source figures. Add concise FAQ links to Pricing and Contact.

- [ ] **Step 4: Verify full release contract**

Run: `npm test && npm run lint`

Expected: FAQ route and all trust routes render, FAQ controls work through native keyboard behavior, and rendered checks cover all new paths.

- [ ] **Step 5: Commit**

```bash
git add app/faq/page.tsx components/faq-list.tsx lib/content.ts app/pricing/page.tsx app/contact/page.tsx app/globals.css tests/faq.test.tsx tests/rendered-html.test.mjs
git commit -m "feat: add launch access FAQ"
```

## Plan self-review

- **Coverage:** Task 1 delivers footer documents and truthful status; Task 2 delivers FAQ and decision links.
- **No placeholders:** each task has exact files, test behavior, commands, implementation rules, and commit scope.
- **Consistency:** `ContentDocument` and `FaqList` define all consumers before routes use them.
