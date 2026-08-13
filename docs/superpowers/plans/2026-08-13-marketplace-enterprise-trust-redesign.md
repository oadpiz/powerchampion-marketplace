# Marketplace + Enterprise Trust Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the complete Power Champion launch site as a bilingual token marketplace plus enterprise trust experience without implying live payments, accounts, inference, deployment, or readiness.

**Architecture:** Centralize model, pricing, company, trust, and readiness facts in typed data modules, then render every route from those sources through focused client components and server route wrappers. Product surfaces use the dark marketplace layer; infrastructure, trust, company, status, and policy surfaces use the bright editorial layer while sharing one shell, locale system, accessibility contract, and evidence boundary.

**Tech Stack:** Next.js-compatible App Router through vinext, React 19, TypeScript 5.9, CSS, Vitest, Testing Library, Node rendered-route tests, Cloudflare-compatible worker build.

## Global Constraints

- English-first with complete Traditional Chinese (`zh-Hant`) localization on every route.
- Token access remains “launching soon”; payment, authentication, live accounts, funded balances, usable credentials, live inference, analytics, persistent enquiry submission, and CRM/email delivery stay absent.
- Prices, packages, balance, usage, availability, and performance displays remain visibly illustrative unless backed by current runtime evidence.
- Launch-access and deployment-review actions create no order, charge, reservation, account, balance, credential, or service commitment.
- Company capacity figures remain counterparty-reported context sourced only from `lib/company.ts`; never describe them as completed Power Champion deployment, owned data-centre capacity, or recognized revenue.
- Readiness fails closed: missing or false fields render as not ready and never receive a positive status treatment.
- No model license, provenance, supported feature, region, retention, training, certification, uptime, or deployment claim may appear unless the authoritative typed record contains it.
- No model fact, evidence qualifier, price, or trust description may be hidden at tablet or mobile widths.
- Small text must be at least 13px; normal decision-support copy targets 16–18px.
- The mobile menu and launch-access dialog must contain focus, close with Escape, isolate background content, lock page scroll, and restore focus.
- Motion must honor `prefers-reduced-motion`; color must not be the only readiness or availability cue.
- SENDFU is an information-architecture reference only; do not copy its text, graphics, assets, or page composition.
- Production deployment, DNS, and Dokploy configuration require a separate authorization checkpoint after local verification.

---

## File structure and responsibilities

- `lib/content.ts` — shared bilingual interface labels and route copy.
- `lib/models.ts` — model identity, price, limits, features, provenance-review state, serving role, availability, and filtering.
- `lib/pricing.ts` — illustrative packages and pure token-cost calculation.
- `lib/company.ts` — the only source for public company and counterparty-reported capacity facts.
- `lib/trust.ts` — typed service readiness, trust/policy content, review stages, and fail-closed helpers.
- `components/site-shell.tsx` — global navigation, grouped footer, locale controls, mobile dialog, and launch-access trigger.
- `components/editorial-page.tsx` — reusable accessible editorial layout for FAQ, Terms, Privacy, and Status.
- `components/home-content.tsx` — full dark-to-light dual-journey homepage.
- `components/model-marketplace.tsx` — searchable model comparison and details.
- `components/infrastructure-content.tsx` — qualified capacity-to-serving explanation.
- `components/trust-content.tsx` — data, provenance, policies, and release-control review.
- `components/status-content.tsx` — fail-closed service readiness rendering.
- `components/pricing-page-content.tsx`, `components/docs-page-content.tsx`, `components/console-page-content.tsx`, `components/models-page-content.tsx` — localized client content behind server route wrappers with metadata.
- `components/company-content.tsx`, `components/enterprise-enquiry.tsx` — sourced company context and local-only access enquiry.
- `app/*/page.tsx` — server route entry points and route-specific metadata.
- `app/globals.css` — shared dark/light design tokens, layout, responsive behavior, focus, motion, and typography contracts.
- `tests/content-foundation.test.ts` — truth-source and fail-closed invariants.
- `tests/trust-pages.test.tsx` — legal, FAQ, trust, and status behavior.
- `tests/infrastructure.test.tsx` — source-qualified infrastructure rendering.
- Existing route/component tests — interaction and localization regressions.
- `tests/visual-contract.test.ts` — static design-token, minimum-type, motion, and no-hidden-facts contracts.
- `tests/rendered-html.test.mjs` — production-render route, metadata, navigation, and forbidden-claim smoke tests.

---

### Task 1: Typed truth, readiness, model, and localization foundation

**Files:**
- Create: `lib/trust.ts`
- Create: `tests/content-foundation.test.ts`
- Modify: `lib/models.ts:1-51`
- Modify: `lib/content.ts:1-111`
- Modify: `components/model-marketplace.tsx:130-133`
- Test: `tests/unit.test.ts`

**Interfaces:**
- Consumes: existing `Locale`, `COMPANY_CONTENT`, `COMPANY_SOURCES`, `MODEL_CATALOG`, and `CREDIT_PACKS`.
- Produces: `ReadinessState`, `ServiceReadiness`, `SERVICE_READINESS`, `isReady(state): boolean`, `TRUST_CONTENT`, `POLICY_CONTENT`, and expanded `ModelDefinition` fields used by every later route.

- [ ] **Step 1: Write failing truth-source tests**

Create `tests/content-foundation.test.ts` with exact invariants:

```ts
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../lib/models";
import {
  POLICY_CONTENT,
  SERVICE_READINESS,
  TRUST_CONTENT,
  isReady,
} from "../lib/trust";

describe("public truth foundation", () => {
  it("fails closed for every unreleased commercial capability", () => {
    expect(SERVICE_READINESS.website).toBe("preview");
    expect(SERVICE_READINESS.manifest).toBe("not-ready");
    expect(SERVICE_READINESS.inference).toBe("not-ready");
    expect(SERVICE_READINESS.payments).toBe("not-ready");
    expect(isReady(undefined)).toBe(false);
    expect(isReady("not-ready")).toBe(false);
    expect(isReady("ready")).toBe(true);
  });

  it("publishes complete decision fields without inventing provenance", () => {
    for (const model of MODEL_CATALOG) {
      expect(model.maxOutput).toMatch(/^\d+K$/);
      expect(model.features).toEqual({
        tools: expect.any(Boolean),
        structuredOutput: expect.any(Boolean),
        reasoning: expect.any(Boolean),
        streaming: expect.any(Boolean),
      });
      expect(model.provenance.status).toBe("review-required");
      expect(model.servingRole.en).toMatch(/illustrative catalog/i);
      expect(model.region).toBeNull();
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
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- tests/content-foundation.test.ts`

Expected: FAIL because `lib/trust.ts`, expanded model fields, and bilingual trust copy do not exist.

- [ ] **Step 3: Implement typed fail-closed data and copy**

In `lib/trust.ts`, define the exact readiness contract and pure helper:

```ts
import type { Locale } from "./content";

export type ReadinessState = "ready" | "preview" | "preparation" | "not-ready";

export type ServiceReadiness = {
  website: ReadinessState;
  manifest: ReadinessState;
  inference: ReadinessState;
  payments: ReadinessState;
  enterpriseReview: ReadinessState;
};

export const SERVICE_READINESS: ServiceReadiness = {
  website: "preview",
  manifest: "not-ready",
  inference: "not-ready",
  payments: "not-ready",
  enterpriseReview: "preparation",
};

export function isReady(state: ReadinessState | undefined): boolean {
  return state === "ready";
}
```

Define the content interfaces before the records so later routes consume one
stable shape:

```ts
export type EditorialSection = {
  id: string;
  title: string;
  body: string[];
};

export type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  href?: string;
  linkLabel?: string;
};

export type PolicyLocaleContent = {
  privacy: { kicker: string; title: string; lead: string; sections: EditorialSection[] };
  terms: { kicker: string; title: string; lead: string; sections: EditorialSection[] };
  faq: FaqEntry[];
};

export type TrustLocaleContent = {
  kicker: string;
  title: string;
  lead: string;
  releaseBoundary: string;
  sections: EditorialSection[];
  infrastructure: {
    kicker: string;
    title: string;
    lead: string;
    capacityStage: string;
    servingStage: string;
    deliveryStage: string;
    checklistTitle: string;
    checklist: string[];
  };
  status: {
    kicker: string;
    title: string;
    lead: string;
    labels: Record<keyof ServiceReadiness, string>;
    states: Record<ReadinessState, string>;
  };
  deploymentReview: string;
};

export const TRUST_CONTENT: Record<Locale, TrustLocaleContent> = {
  en: {
    kicker: "Enterprise review",
    title: "Evidence before promises.",
    lead: "Review the public boundaries, sources, and release gates behind future Power Champion access.",
    releaseBoundary: "This launch site does not represent a live inference, payment, account, or reserved-capacity service.",
    sections: [
      { id: "data", title: "Current data behavior", body: ["The current enquiry, estimator, console, and launch-access interactions stay in this browser and are not transmitted or persisted."] },
      { id: "provenance", title: "Model provenance", body: ["Every catalog entry requires model-license, serving-authorization, and deployment review before release."] },
      { id: "controls", title: "Release controls", body: ["Manifest, inference, usage accounting, payment, and operational status remain separate release gates."] },
      { id: "policies", title: "Policies and sources", body: ["Privacy, Terms, Status, and Company pages define the current public boundary and cited context."] },
    ],
    infrastructure: {
      kicker: "Infrastructure review",
      title: "From qualified capacity context to future delivery.",
      lead: "Separate counterparty-reported capacity from the serving and delivery controls required for release.",
      capacityStage: "Counterparty-reported expected hosting capacity; not live or completed deployment.",
      servingStage: "Model serving remains release-gated until deployment, authorization, and runtime evidence are verified.",
      deliveryStage: "The unified API is a public integration preview, not a currently available inference endpoint.",
      checklistTitle: "Deployment review inputs",
      checklist: ["Workload", "Model requirements", "Usage profile", "Deployment region", "Data handling", "Service-readiness gates"],
    },
    status: {
      kicker: "Public status",
      title: "Launch preparation",
      lead: "Website preview and future service readiness are reported separately.",
      labels: { website: "Website", manifest: "Provider manifest", inference: "Inference API", payments: "Payments", enterpriseReview: "Enterprise review" },
      states: { ready: "Ready", preview: "Preview", preparation: "In preparation", "not-ready": "Not ready" },
    },
    deploymentReview: "Deployment review",
  },
  zh: {
    kicker: "企業審查",
    title: "先看證據，再談承諾。",
    lead: "檢視 Power Champion 未來存取服務背後的公開邊界、來源與發布門檻。",
    releaseBoundary: "此啟動網站不代表已提供即時推論、付款、帳戶或容量預留服務。",
    sections: [
      { id: "data", title: "目前的資料行為", body: ["目前的洽詢、估算器、控制台與啟動存取互動僅保留在此瀏覽器，不會傳送或持久保存。"] },
      { id: "provenance", title: "模型來源", body: ["每筆模型目錄項目都必須在發布前完成模型授權、服務授權與部署審查。"] },
      { id: "controls", title: "發布控制", body: ["Manifest、推論、用量計算、付款與營運狀態分別屬於獨立發布門檻。"] },
      { id: "policies", title: "政策與來源", body: ["隱私權、條款、狀態與公司頁面界定目前的公開邊界及引用脈絡。"] },
    ],
    infrastructure: {
      kicker: "基礎設施審查",
      title: "從受限定的容量脈絡，到未來交付。",
      lead: "將交易對手報告的容量，與發布所需的服務及交付控制清楚分開。",
      capacityStage: "交易對手報告的預期託管容量；並非即時或已完成部署。",
      servingStage: "模型服務在部署、授權與執行證據完成驗證前，仍受發布門檻限制。",
      deliveryStage: "統一 API 僅為公開整合預覽，並非目前可用的推論端點。",
      checklistTitle: "部署審查輸入",
      checklist: ["工作負載", "模型需求", "用量輪廓", "部署區域", "資料處理", "服務就緒門檻"],
    },
    status: {
      kicker: "公開狀態",
      title: "啟動準備中",
      lead: "網站預覽與未來服務就緒狀態會分開呈現。",
      labels: { website: "網站", manifest: "供應商 Manifest", inference: "推論 API", payments: "付款", enterpriseReview: "企業審查" },
      states: { ready: "已就緒", preview: "預覽", preparation: "準備中", "not-ready": "尚未就緒" },
    },
    deploymentReview: "部署審查",
  },
};
```

Export `POLICY_CONTENT` with the same `Record<Locale, PolicyLocaleContent>`
contract. Use three Privacy sections (Current interactions, Features not
enabled, Future changes), three Terms sections (Informational site,
Non-transactional access, External sources), and these seven FAQ questions in
both locales: Can I buy tokens now?; Are the displayed rates final?; Is the API
live?; What happens to information entered here?; Is 3.1 MW already deployed?;
What is a deployment review?; How do I request launch access? The answers must
state respectively: no payment; illustrative rates; no live inference; current
interactions are not transmitted or persisted; the figure is counterparty-
reported expected capacity and not completed deployment; the review is a local
non-binding planning flow; and the local request creates no reservation or
account. The Traditional Chinese answers must carry the same qualifications.
The English Privacy opening must be exactly “This launch site does not transmit
or persist the current enquiry and preview interactions.” The corresponding
Traditional Chinese opening must be exactly “此啟動網站不會傳送或持久保存目前的洽詢
與預覽互動。” Terms must explicitly say no purchase, reservation, account, API
access, SLA, or service commitment is formed.

Expand `ModelDefinition` in `lib/models.ts`:

```ts
export type ModelFeatures = {
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  streaming: boolean;
};

export type ModelDefinition = {
  // retain current identity/category/rate fields except the legacy top-level tools flag
  maxOutput: `${number}K`;
  features: ModelFeatures;
  provenance: {
    status: "review-required";
    label: Record<"en" | "zh", string>;
    licenseHref: string | null;
  };
  servingRole: Record<"en" | "zh", string>;
  region: null;
};
```

Populate every current catalog entry with conservative `review-required`, null
license/region, illustrative serving-role copy, max output, and feature flags.
Do not claim a capability merely because the model family may support it.
Replace the existing `model.tools` render with `model.features.tools` so the
catalog has one feature source rather than duplicate tool flags.
Extend `CopyDictionary` with navigation labels for infrastructure, trust,
status, FAQ, deployment review, grouped footer labels, model decision fields,
homepage steps, and shared readiness labels in both locales.

- [ ] **Step 4: Run foundation tests and type-facing unit tests**

Run: `npm run test:unit -- tests/content-foundation.test.ts tests/unit.test.ts`

Expected: PASS with all catalog rows satisfying the conservative truth contract.

- [ ] **Step 5: Commit the foundation**

```bash
git add lib/content.ts lib/models.ts lib/trust.ts components/model-marketplace.tsx tests/content-foundation.test.ts tests/unit.test.ts
git commit -m "feat: centralize marketplace trust truth"
```

---

### Task 2: Real navigation, footer, policy, FAQ, and status routes

**Files:**
- Create: `components/editorial-page.tsx`
- Create: `components/status-content.tsx`
- Create: `app/faq/page.tsx`
- Create: `app/terms/page.tsx`
- Create: `app/privacy/page.tsx`
- Create: `app/status/page.tsx`
- Create: `tests/trust-pages.test.tsx`
- Modify: `components/site-shell.tsx:12-210`
- Modify: `tests/components.test.tsx`

**Interfaces:**
- Consumes: `POLICY_CONTENT`, `SERVICE_READINESS`, `isReady`, and new `copy.nav` / `copy.footer` labels from Task 1.
- Produces: `EditorialPage`, `StatusContent`, real `/faq`, `/terms`, `/privacy`, `/status` routes, and the canonical navigation destination arrays.

- [ ] **Step 1: Write route and shell regressions**

Create `tests/trust-pages.test.tsx` and update the disabled-footer assertions in
`tests/components.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import FaqPage from "../app/faq/page";
import PrivacyPage from "../app/privacy/page";
import StatusPage from "../app/status/page";
import TermsPage from "../app/terms/page";
import { LocaleProvider } from "../components/locale-provider";

function localized(ui: ReactNode) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

it("renders launch-safe policy and status routes", () => {
  localized(<StatusPage />);
  expect(screen.getByRole("heading", { level: 1, name: "Launch preparation" })).toBeVisible();
  expect(screen.getByText("Inference API").closest("li")).toHaveTextContent("Not ready");
  expect(screen.queryByText(/all systems operational/i)).not.toBeInTheDocument();
});

it("offers accessible bilingual FAQ disclosures", async () => {
  const user = userEvent.setup();
  localized(<FaqPage />);
  const question = screen.getByRole("button", { name: /Can I buy tokens now/i });
  expect(question).toHaveAttribute("aria-expanded", "false");
  await user.click(question);
  expect(question).toHaveAttribute("aria-expanded", "true");
});

it.each([[<TermsPage />, /does not create a purchase/i], [<PrivacyPage />, /does not transmit or persist/i]])(
  "preserves the launch boundary",
  (page, boundary) => {
    localized(page);
    expect(screen.getByText(boundary)).toBeVisible();
  },
);
```

Update shell expectations so Status, Terms, Privacy, and FAQ have real `href`
values and no `aria-disabled` attribute. Assert primary navigation includes
`/infrastructure`, `/trust`, and `/status`, while Console is present in the
footer rather than the desktop primary navigation.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm run test:unit -- tests/trust-pages.test.tsx tests/components.test.tsx`

Expected: FAIL because routes/components are missing and shell links remain disabled.

- [ ] **Step 3: Implement editorial routes and canonical shell links**

Implement `EditorialPage` with one `main#main-content`, a labelled hero, optional
section navigation, semantic sections, and no nested `main`. Implement FAQ with
button/panel semantics and localized state. Implement `StatusContent` by mapping
the exact readiness object:

```tsx
const content = TRUST_CONTENT[locale].status;
const rows = [
  [content.labels.website, SERVICE_READINESS.website],
  [content.labels.manifest, SERVICE_READINESS.manifest],
  [content.labels.inference, SERVICE_READINESS.inference],
  [content.labels.payments, SERVICE_READINESS.payments],
  [content.labels.enterpriseReview, SERVICE_READINESS.enterpriseReview],
] as const;

<ul className="status-ledger">
  {rows.map(([label, state]) => (
    <li data-ready={isReady(state)} key={label}>
      <span>{label}</span>
      <strong>{content.states[state]}</strong>
    </li>
  ))}
</ul>
```

Use server page wrappers with truthful English metadata. Replace the shell's
disabled footer map and the six-item desktop destination list with centralized
real route arrays. Keep mobile focus containment, Escape behavior, isolation,
scroll locking, and focus restoration unchanged. Add Deployment review as a
mobile/enterprise link to `/contact`, not a new network action.

- [ ] **Step 4: Run trust and shell tests**

Run: `npm run test:unit -- tests/trust-pages.test.tsx tests/components.test.tsx tests/skip-link.test.tsx`

Expected: PASS; all policy links resolve and status remains fail-closed.

- [ ] **Step 5: Commit real trust routes**

```bash
git add components/editorial-page.tsx components/status-content.tsx components/site-shell.tsx app/faq app/terms app/privacy app/status tests/trust-pages.test.tsx tests/components.test.tsx
git commit -m "feat: add public policy and readiness routes"
```

---

### Task 3: Infrastructure and Trust enterprise-review pages

**Files:**
- Create: `components/infrastructure-content.tsx`
- Create: `components/trust-content.tsx`
- Create: `app/infrastructure/page.tsx`
- Create: `app/trust/page.tsx`
- Create: `tests/infrastructure.test.tsx`
- Modify: `tests/trust-pages.test.tsx`

**Interfaces:**
- Consumes: `COMPANY_CONTENT`, `COMPANY_SOURCES`, `TRUST_CONTENT`, `SERVICE_READINESS`, and shell CTA labels.
- Produces: `InfrastructureContent` and `TrustContent` with source-qualified evidence and deployment-review links.

- [ ] **Step 1: Write source-bound enterprise page tests**

Add exact assertions:

```tsx
it("qualifies infrastructure figures beside the source-backed facts", () => {
  render(<LocaleProvider><InfrastructureContent /></LocaleProvider>);
  const capacity = screen.getByRole("region", { name: /Capacity context/i });
  expect(within(capacity).getByText("Approximately 3.1 MW")).toBeVisible();
  expect(within(capacity).getByText(/not live or completed deployment/i)).toBeVisible();
  expect(within(capacity).getByRole("link", { name: /SEC-filed/i })).toHaveAttribute(
    "href",
    "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986209.htm",
  );
  expect(screen.getByRole("link", { name: "Deployment review" })).toHaveAttribute("href", "/contact");
});

it("does not turn expected capacity into an ownership or deployment claim", () => {
  render(<LocaleProvider><InfrastructureContent /></LocaleProvider>);
  expect(document.body).not.toHaveTextContent(/we own|our data centre|deployed 3\.1 MW/i);
});
```

In `tests/trust-pages.test.tsx`, assert the Trust page contains data handling,
model provenance, release controls, links to `/privacy`, `/terms`, `/status`,
and `/company`, and no certification/uptime language.

- [ ] **Step 2: Run focused enterprise tests and verify RED**

Run: `npm run test:unit -- tests/infrastructure.test.tsx tests/trust-pages.test.tsx`

Expected: FAIL because enterprise review routes and components do not exist.

- [ ] **Step 3: Implement source-aware infrastructure and trust views**

Render three infrastructure stages with explicit stage states:

```ts
const stages = [
  { id: "capacity", state: "counterparty-context" },
  { id: "serving", state: "release-gated" },
  { id: "delivery", state: "preview" },
] as const;
```

The capacity stage reads values and qualification text directly from
`COMPANY_CONTENT[locale]` and links to `COMPANY_SOURCES[0]`. Serving and delivery
use trust copy that says they are review/release gates, not completed operations.
Render the enterprise input checklist—workload, model requirements, usage
profile, deployment region, data handling, and service-readiness gates—and link
to `/contact`.

Render Trust as four editorial sections: current data behavior, provenance
review, service/release controls, and policies/sources. Do not add badges for
SOC 2, ISO, GDPR, uptime, retention duration, or training behavior.

- [ ] **Step 4: Run enterprise tests**

Run: `npm run test:unit -- tests/infrastructure.test.tsx tests/trust-pages.test.tsx tests/company.test.tsx`

Expected: PASS; company facts remain centralized and qualified.

- [ ] **Step 5: Commit enterprise review pages**

```bash
git add components/infrastructure-content.tsx components/trust-content.tsx app/infrastructure app/trust tests/infrastructure.test.tsx tests/trust-pages.test.tsx
git commit -m "feat: add enterprise infrastructure and trust review"
```

---

### Task 4: Recompose Home around the two approved journeys

**Files:**
- Modify: `components/home-content.tsx:1-160`
- Modify: `components/audience-paths.tsx`
- Modify: `tests/homepage.test.tsx`

**Interfaces:**
- Consumes: expanded `MODEL_CATALOG`, `COMPANY_CONTENT`, `SERVICE_READINESS`, `CREDIT_PACKS`, and bilingual home copy.
- Produces: dark-to-light Home sequence, visible decision facts, Compare token rates CTA, Deployment review CTA, and launch-safe closing actions.

- [ ] **Step 1: Replace old Homepage expectations with the approved sequence**

Add/adjust tests to require:

```tsx
expect(within(hero).getByRole("link", { name: "Compare token rates" }))
  .toHaveAttribute("href", "/pricing");
expect(within(hero).getByRole("link", { name: "Deployment review" }))
  .toHaveAttribute("href", "/contact");
expect(screen.getByText("Token access launching soon")).toBeVisible();

const proof = screen.getByRole("region", { name: "Marketplace facts" });
expect(within(proof).queryByText("99.98%")).not.toBeInTheDocument();
expect(within(proof).getByText("6")).toBeVisible();
expect(within(proof).getByText("128K")).toBeVisible();
expect(within(proof).getByText("$0.16")).toBeVisible();
```

For every featured model, assert visible price, context, max output, provenance
review state, and release state without expanding a control. Assert How access
works has exactly Compare, Estimate, and Request steps. Assert enterprise and
trust sections link to `/infrastructure`, `/trust`, and `/status`. Repeat primary
facts after switching to `繁中`.

- [ ] **Step 2: Run Homepage tests and verify RED**

Run: `npm run test:unit -- tests/homepage.test.tsx tests/audience-paths.test.tsx`

Expected: FAIL on the old hero destinations, illustrative availability metric,
card package layout, and missing trust bridge.

- [ ] **Step 3: Implement the seven-section Home composition**

Refactor `HomeContent` into small render sections inside the same file or
single-purpose local components: hero, fact rail, featured ledger, access steps,
enterprise bridge, trust strip, split closing action. Derive facts:

```ts
const catalogCount = MODEL_CATALOG.length;
const maxContext = MODEL_CATALOG.reduce(
  (max, model) => Math.max(max, Number.parseInt(model.context, 10)),
  0,
);
const startingRate = Math.min(...MODEL_CATALOG.map((model) => model.inputPerMillion));
```

Use these derived values (`catalogCount`, `maxContext`, and `startingRate`) instead
of hardcoded `28`, `128K+`, or `99.98%`.
Featured rows show model decision fields directly. Convert packages into one
editorial rate/access section with a single launch-access button and visible
non-binding disclosure. Keep `ConsoleView compact`, but place it after its
preview boundary. Use `AudiencePaths` for the paired closing choices.

- [ ] **Step 4: Run Homepage and interaction tests**

Run: `npm run test:unit -- tests/homepage.test.tsx tests/audience-paths.test.tsx tests/components.test.tsx`

Expected: PASS in English and Traditional Chinese with no unsupported uptime or
route-count claim.

- [ ] **Step 5: Commit the Homepage**

```bash
git add components/home-content.tsx components/audience-paths.tsx tests/homepage.test.tsx tests/audience-paths.test.tsx
git commit -m "feat: rebuild home for token and enterprise journeys"
```

---

### Task 5: Upgrade Models into a complete decision ledger

**Files:**
- Create: `components/models-page-content.tsx`
- Modify: `app/models/page.tsx:1-20`
- Modify: `components/model-marketplace.tsx:1-149`
- Modify: `tests/marketplace.test.tsx`

**Interfaces:**
- Consumes: the Task 1 `ModelDefinition` decision fields and bilingual model labels.
- Produces: server-rendered Models route metadata, searchable/filterable rows, and complete responsive facts.

- [ ] **Step 1: Write complete model-decision tests**

Extend `tests/marketplace.test.tsx`:

```tsx
it("shows all decision facts for an expanded model", async () => {
  const user = userEvent.setup();
  render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
  await user.click(screen.getByRole("button", { name: "Qwen" }));
  const details = screen.getByRole("region", { name: "Qwen details" });
  expect(details).toHaveTextContent("pc/qwen-coder");
  expect(details).toHaveTextContent("Max output");
  expect(details).toHaveTextContent("Structured output");
  expect(details).toHaveTextContent("Reasoning");
  expect(details).toHaveTextContent("Streaming");
  expect(details).toHaveTextContent("Provenance review required");
  expect(details).toHaveTextContent("Region not published");
});

it("keeps summary facts visible before expansion", () => {
  render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);
  const qwen = screen.getByRole("article", { name: "Qwen" });
  expect(within(qwen).getByText("128K")).toBeVisible();
  expect(within(qwen).getByText("$0.18 per 1M input")).toBeVisible();
  expect(within(qwen).getByText("$0.72 per 1M output")).toBeVisible();
});
```

Add a data-loop assertion that every catalog model renders an exact input/output
unit string, not substring-matched extra charges or units.

- [ ] **Step 2: Run Models tests and verify RED**

Run: `npm run test:unit -- tests/marketplace.test.tsx`

Expected: FAIL because max output, feature matrix, provenance, serving role, and
region state are not rendered.

- [ ] **Step 3: Implement the decision ledger and server wrapper**

Move the client intro into `ModelsPageContent`; leave `app/models/page.tsx` as a
server wrapper exporting:

```ts
export const metadata = {
  title: "Open Model Catalog | Power Champion",
  description: "Compare illustrative open-model token rates, limits, features, and release-review states.",
};
```

Keep filters and disclosure interaction. Summary rows show context and exact
input/output rates. Expanded details render all Task 1 fields with textual
Enabled / Not published / Review required values. Use provenance license links
only when `licenseHref` is non-null. Never derive availability from visual color.

- [ ] **Step 4: Run catalog tests**

Run: `npm run test:unit -- tests/marketplace.test.tsx tests/responsive-contract.test.ts`

Expected: PASS with keyboard disclosure and localized units intact.

- [ ] **Step 5: Commit Models**

```bash
git add app/models/page.tsx components/models-page-content.tsx components/model-marketplace.tsx tests/marketplace.test.tsx
git commit -m "feat: expand model decision ledger"
```

---

### Task 6: Refine Pricing, Docs, and Console product surfaces

**Files:**
- Create: `components/pricing-page-content.tsx`
- Create: `components/docs-page-content.tsx`
- Create: `components/console-page-content.tsx`
- Modify: `app/pricing/page.tsx:1-68`
- Modify: `app/docs/page.tsx:1-37`
- Modify: `app/console/page.tsx:1-19`
- Modify: `components/pricing-calculator.tsx:15-85`
- Modify: `components/code-samples.tsx`
- Modify: `components/console-view.tsx`
- Modify: `tests/pricing.test.tsx`
- Modify: `tests/docs-console.test.tsx`

**Interfaces:**
- Consumes: `MODEL_CATALOG`, `CREDIT_PACKS`, `calculateUsageCost`, readiness data, and product copy.
- Produces: route-specific metadata wrappers, transparent rates, strict estimator, public/protected docs split, and unmistakably local console preview.

- [ ] **Step 1: Write product-boundary and decision tests**

Add tests requiring:

```tsx
expect(screen.getByRole("heading", { level: 2, name: "How token billing works" })).toBeVisible();
expect(screen.getByText(/input and output tokens are priced separately/i)).toBeVisible();
expect(screen.getAllByRole("button", { name: "Join launch access" })).toHaveLength(1);
expect(document.body).not.toHaveTextContent(/buy now|checkout|funded balance/i);
```

Keep the existing blank/negative/non-finite estimator tests. On Docs, require
two regions named Public preview and Protected access, require code examples to
say non-operational, and require release gates for streaming usage, tools,
structured output, manifest, and status. On Console, require the local preview
boundary before illustrative balance/usage and prohibit a copyable usable key.

- [ ] **Step 2: Run product tests and verify RED**

Run: `npm run test:unit -- tests/pricing.test.tsx tests/docs-console.test.tsx`

Expected: FAIL on repeated package CTAs, missing billing explanation, missing
Docs access split, and route-specific metadata wrappers.

- [ ] **Step 3: Implement product routes and metadata wrappers**

Move client bodies into the three new content components. Server route wrappers
export truthful metadata. Pricing renders one horizontal/stacked package
comparison, one launch-access action, exact rate table, estimator, and visible
illustrative note. Keep the pure calculation unchanged.

Docs renders:

```tsx
<section aria-labelledby="public-preview-title">...</section>
<section aria-labelledby="protected-access-title">...</section>
<section aria-labelledby="release-gates-title">
  <ul>{releaseGates.map((gate) => <li key={gate.id}>{gate.label}: {gate.state}</li>)}</ul>
</section>
```

Replace a realistic-looking credential value with an explicit inert placeholder
such as `pc_demo_YOUR_KEY`, label all examples non-operational, and keep copy
fallback messaging. Console displays its preview boundary in the first visible
content block and retains no live identity, funded balance, usable key, or live
usage implication.

- [ ] **Step 4: Run product tests**

Run: `npm run test:unit -- tests/pricing.test.tsx tests/docs-console.test.tsx tests/unit.test.ts`

Expected: PASS with exact rates, strict invalid-input behavior, and no payment or
live API implication.

- [ ] **Step 5: Commit product surfaces**

```bash
git add app/pricing/page.tsx app/docs/page.tsx app/console/page.tsx components/pricing-page-content.tsx components/docs-page-content.tsx components/console-page-content.tsx components/pricing-calculator.tsx components/code-samples.tsx components/console-view.tsx tests/pricing.test.tsx tests/docs-console.test.tsx
git commit -m "feat: clarify pricing docs and console preview"
```

---

### Task 7: Align Company and Deployment Review with the enterprise path

**Files:**
- Modify: `components/company-content.tsx:9-88`
- Modify: `components/enterprise-enquiry.tsx:6-84`
- Modify: `app/contact/page.tsx:1-14`
- Modify: `tests/company.test.tsx`
- Modify: `tests/contact.test.tsx`

**Interfaces:**
- Consumes: `COMPANY_CONTENT`, `COMPANY_SOURCES`, and enquiry labels from `lib/content.ts`.
- Produces: bright evidence-led Company route and three-choice local-only deployment review.

- [ ] **Step 1: Write enterprise-path regressions**

Update Contact tests to require three exact interest values:

```tsx
expect(screen.getByRole("option", { name: "Launch access" })).toHaveValue("launch-access");
expect(screen.getByRole("option", { name: "Infrastructure planning" })).toHaveValue("infrastructure");
expect(screen.getByRole("option", { name: "Model partnership" })).toHaveValue("partnership");
expect(screen.getByText(/No information is transmitted or persisted/i)).toBeVisible();
expect(document.querySelector("form")).not.toHaveAttribute("action");
```

Assert no email, phone, address, card, password, API key, or company-registration
field. Company tests retain every exact sourced figure/qualification and require
links to Infrastructure and Deployment review.

- [ ] **Step 2: Run enterprise-path tests and verify RED**

Run: `npm run test:unit -- tests/company.test.tsx tests/contact.test.tsx`

Expected: FAIL because launch access is not an enquiry option and the page still
uses generic Contact / enterprise-enquiry framing.

- [ ] **Step 3: Implement the shared deployment-review surface**

Change `Interest` to:

```ts
type Interest = "" | "launch-access" | "infrastructure" | "partnership";
```

Rename visible route copy to Deployment review while retaining local-only form
semantics, client state, native labelled controls, `role="alert"`, and
`role="status"`. Show the local-only notice before the form submit button and
again in the completion state. Keep message optional and never add a network
request.

Recompose Company with fewer panels: record, qualified announcement, capacity
sequence, source ledger, and related enterprise links. Read every figure and
source from `lib/company.ts`; do not duplicate strings in the component.

- [ ] **Step 4: Run company/contact tests**

Run: `npm run test:unit -- tests/company.test.tsx tests/contact.test.tsx`

Expected: PASS in both locales with no personal/payment fields or unsupported
company claims.

- [ ] **Step 5: Commit enterprise path**

```bash
git add components/company-content.tsx components/enterprise-enquiry.tsx app/contact/page.tsx tests/company.test.tsx tests/contact.test.tsx
git commit -m "feat: align company and deployment review"
```

---

### Task 8: Apply the unified dark marketplace / bright trust visual system

**Files:**
- Create: `tests/visual-contract.test.ts`
- Modify: `app/globals.css:1-end`
- Modify: `tests/responsive-contract.test.ts`
- Modify: `tests/homepage.test.tsx`

**Interfaces:**
- Consumes: all route class names and semantic structures from Tasks 2–7.
- Produces: shared design tokens, product/trust themes, responsive layouts, focus states, reduced-motion behavior, and no-hidden-facts contract.

- [ ] **Step 1: Write static visual and responsive contract tests**

Create `tests/visual-contract.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = () => readFile(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("hybrid design contracts", () => {
  it("defines distinct product and trust surfaces from shared tokens", async () => {
    const source = await css();
    expect(source).toMatch(/--surface-product:\s*#[0-9a-f]{6}/i);
    expect(source).toMatch(/--surface-trust:\s*#[0-9a-f]{6}/i);
    expect(source).toMatch(/\.theme-product/);
    expect(source).toMatch(/\.theme-trust/);
  });

  it("never uses sub-13px interface text", async () => {
    const source = await css();
    const px = [...source.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
    const rem = [...source.matchAll(/font-size:\s*([\d.]+)rem/g)].map((match) => Number(match[1]) * 16);
    expect([...px, ...rem].every((value) => value >= 13)).toBe(true);
  });

  it("has an explicit reduced-motion mode", async () => {
    expect(await css()).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});
```

Extend `tests/responsive-contract.test.ts` to prohibit `display:none` for model
facts, trust qualifiers, infrastructure evidence, rate units, and status text
inside 1024/820/720/480 media blocks. Require scroll affordance on the rate
table and complete stacked grid areas for model rows.

- [ ] **Step 2: Run visual contract tests and verify RED**

Run: `npm run test:unit -- tests/visual-contract.test.ts tests/responsive-contract.test.ts`

Expected: FAIL because shared theme tokens, bright trust layer, complete responsive
contracts, and reduced-motion block are absent or incomplete.

- [ ] **Step 3: Rebuild the stylesheet around shared tokens and section rhythm**

At the top of `app/globals.css`, define:

```css
:root {
  --surface-product: #070a0f;
  --surface-product-raised: #0d121a;
  --surface-trust: #f3f2ed;
  --surface-trust-raised: #fbfaf6;
  --ink-product: #f4f7fb;
  --ink-trust: #10161f;
  --muted-product: #9ca8b8;
  --muted-trust: #5d6672;
  --cyan: #55e7ff;
  --lime: #b9f36b;
  --violet: #8d7dff;
  --rule-dark: rgb(255 255 255 / 14%);
  --rule-light: rgb(16 22 31 / 15%);
  --content-max: 1240px;
}
```

Use `.theme-product` and `.theme-trust` on page sections. Remove repeated rounded
card grids, decorative orbit rules, tiny badges, and arbitrary glow clusters.
Use large section spacing, hairline dividers, editorial ledgers, and aligned
facts. Cyan is the primary action; lime is limited to an explicitly qualified
positive state. Provide `:focus-visible` rules with visible offset on both
themes. Maintain at least 13px small text and 16px body text.

At 1024/820/720/480 breakpoints, stack content without removing facts. Add a
labelled horizontal scroll affordance for wide tables. Preserve mobile menu and
dialog overscroll containment. Add:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Run visual/static/component regressions**

Run: `npm run test:unit -- tests/visual-contract.test.ts tests/responsive-contract.test.ts tests/homepage.test.tsx tests/marketplace.test.tsx tests/components.test.tsx`

Expected: PASS with no hidden facts, no sub-13px declarations, and interaction
contracts intact.

- [ ] **Step 5: Commit the visual system**

```bash
git add app/globals.css tests/visual-contract.test.ts tests/responsive-contract.test.ts tests/homepage.test.tsx
git commit -m "feat: unify marketplace and trust visual system"
```

---

### Task 9: Metadata, production rendering, accessibility, and release verification

**Files:**
- Modify: `app/layout.tsx:1-66`
- Modify: every `app/*/page.tsx` metadata export created or changed above
- Modify: `tests/rendered-html.test.mjs:1-140`
- Modify: `README.md`
- Test: complete `tests/` suite

**Interfaces:**
- Consumes: final route set and all completed components/data.
- Produces: truthful route metadata, safe host-derived social URLs, full rendered-route coverage, documented local verification, and deployment checkpoint.

- [ ] **Step 1: Expand rendered-route and forbidden-claim tests**

Change the rendered route list to:

```js
const routes = [
  "/", "/models", "/pricing", "/infrastructure", "/docs", "/trust",
  "/status", "/company", "/contact", "/console", "/faq", "/terms", "/privacy",
];
```

For every route assert status 200, brand, real primary/footer links, `lang="en"`,
route title, and absence of placeholder shells. Add a single forbidden-claim
expression:

```js
assert.doesNotMatch(
  html,
  /all systems operational|buy now|funded account|live inference|SOC 2 certified|ISO 27001 certified|we own (?:a|the) data cent(?:re|er)|deployed 3\.1 MW/i,
);
```

Assert Status includes not-ready inference/payment wording; Docs contains
non-operational examples; Contact contains no sensitive/payment inputs; policy
routes contain launch boundaries; Home contains both approved CTAs. Add metadata
assertions for Models, Pricing, Infrastructure, Docs, Trust, Status, Company,
Contact, Console, FAQ, Terms, and Privacy.

- [ ] **Step 2: Run the production gate and verify expected failures**

Run: `npm run test`

Expected before final metadata changes: unit/build may pass, rendered tests FAIL
on missing route-specific titles or newly required links.

- [ ] **Step 3: Finish metadata, locale, README, and release-safe wiring**

Keep `metadataOrigin()` host validation and launch-soon root metadata. Give every
server route a specific English title/description without claiming live sales or
API availability. Ensure `LocaleProvider` sets `document.documentElement.lang`
to `en` and `zh-Hant`, restoring the previous value on unmount. Keep OG image
resolution 1200×630 and favicon references.

Update `README.md` with:

- current launch-only scope;
- all public routes;
- `npm run test:unit`, `npm run lint`, `npm run build`, and rendered test commands;
- explicit statement that payment, live API, accounts, persistence, and production
  readiness are not implemented;
- statement that deployment/DNS/Dokploy changes require a separate checkpoint.

- [ ] **Step 4: Run complete automated verification**

Run all commands from the project root:

```bash
npm run test:unit
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
git diff --check
```

Expected: every command exits 0; rendered tests pass for all 13 routes; no diff
whitespace errors.

- [ ] **Step 5: Perform manual browser acceptance**

Start the verified build locally and inspect all 13 routes at 1440×900, 820×1180,
390×844, and 200% zoom. In both English and Traditional Chinese verify:

- no clipping, overlap, horizontal page overflow, hidden facts, or truncated
  evidence qualifications;
- Home has dark-to-light rhythm and both distinct CTA paths;
- model filters/disclosures and pricing estimator work with keyboard;
- mobile menu and launch dialog close with Escape and restore focus;
- Contact validates locally and transmits nothing;
- Status does not show false positive readiness;
- reduced-motion disables non-essential animation;
- every footer/navigation link resolves.

Record any visual issue as a failing regression before correcting it, then rerun
the focused test and affected viewport.

- [ ] **Step 6: Commit the verified redesign**

```bash
git add README.md app/layout.tsx app/*/page.tsx tests/rendered-html.test.mjs
git commit -m "feat: complete marketplace trust redesign"
git status --short
```

Expected: commit succeeds and tracked worktree is clean. Do not push, change DNS,
or deploy to Dokploy in this task; request the deployment checkpoint after the
verified commit is ready.
