# Dual-Audience Marketplace Optimization Design

## Purpose

Refine Power Champion into a stronger public product site for two audiences at
once: developers evaluating model access and enterprise partners evaluating
infrastructure credibility. The improvement must make the next action clearer
without pretending token sales, payments, accounts, or API access are live.

## Positioning

The visual system becomes an enterprise command layer with a premium commerce
edge: decisive typography, disciplined data presentation, and a launch-access
journey that feels intentional rather than provisional. It retains the current
dark palette, cyan accent, source-backed Company evidence, English-first copy,
and complete Traditional Chinese locale.

## Information architecture

### Home: two equal paths

The hero presents one shared proposition and two distinct actions:

- **Explore model access** for developers and product teams. It links to the
  model marketplace and introduces the model-selection, token-rate, and
  launch-access path.
- **Talk to infrastructure** for enterprise buyers and partners. It links to
  a new non-binding enquiry surface that introduces the Company evidence brief
  and lets the visitor state interest without creating an account, order, or
  obligation.

Both actions remain visible above the fold. The current visible `Token access
launching soon` status stays in the hero and is not replaced by a sales claim.

Below the hero, Home uses a short decision sequence: featured model access,
compact developer proof, enterprise infrastructure context, then a closing
launch-access CTA. It does not duplicate the full Company page or turn Home
into an investor page.

### Developer path

The Models, Pricing, Docs, and Console pages are made more cohesive through
consistent `Developer access` labels and a single `Join launch access` action.
Pricing retains indicative packages and rate calculation; it must always state
that payment is not enabled and that an interaction creates no order, charge,
reservation, or token balance.

The Console remains a read-only preview. It gains a clearer preview state and
next action but never shows a real user identity, funded account, usable API
key, live balance, or real usage.

### Enterprise path

A new `/contact` route provides an enterprise enquiry surface. It offers two
interest types, `AI infrastructure` and `Model access partnership`, and an
optional non-sensitive message. Submission is local-only: it displays an
explicit confirmation that nothing was transmitted or reserved. The page
links to `/company` for cited public context.

No email address, phone number, company address, customer list, executive
biography, financial performance, or unverified operational claim is added.

## Components and data boundaries

- `lib/content.ts` remains the shared bilingual UI-copy source for generic
  navigation, path labels, enquiry copy, and launch state.
- `lib/company.ts` remains the exclusive source for company facts, public
  source metadata, source labels, and source-derived infrastructure wording.
- A new `components/enterprise-enquiry.tsx` owns local form state and
  validation. It exposes no network request, persistence, analytics, or
  side-effect outside the current browser session.
- A compact `components/audience-paths.tsx` renders the two Home paths from
  locale copy and uses ordinary links rather than duplicated hero logic.

## Interaction and accessibility

The enquiry form uses a native labelled select, textarea, and submit button.
It requires an interest type, announces validation with `role="alert"`, and
announces local-only completion with `role="status"`. It never asks for card,
bank, personal identity, company-registration, API-key, or password data.

All visual path indicators are backed by text labels. Keyboard focus,
skip-link targets, document language switching, mobile navigation, modal
focus behavior, and reduced-motion behavior continue to work across the new
route and components.

## Visual direction

- Use fewer decorative borders and small labels; reserve cyan for active
  actions, verified status, and the single capacity/evidence inflection point.
- Make Hero hierarchy more decisive with an operational eyebrow, a compact
  launch-status line, and two clearly differentiated but balanced CTAs.
- Replace evenly repeated card treatments with editorial sections, varied
  spacing, thin rules, and direct data labels.
- Treat developer and enterprise paths as sibling panels with distinct
  context, never as competing products.
- At mobile widths, stack paths and enquiry fields without hiding their
  decision context or source qualifiers.

## SEO and disclosures

Root metadata, Open Graph, and Twitter metadata remain launch-soon and
indicative. `/contact` metadata describes enterprise enquiry and publicly
cited context without using financial figures or implying a live commercial
service. The site remains neither a securities offering nor financial advice.

## Verification

Add tests for:

- both Home paths, their localized labels, and exact destinations;
- visible launch status and retained developer launch-access messaging;
- `/contact` headings, Company link, localized fields, validation, local-only
  completion, and absence of sensitive/payment inputs;
- console preview labels and no live-account implication;
- responsive source contracts that prevent hidden Home path context;
- rendered `/contact` route, its metadata, and the absence of payment forms.

Run unit tests, lint, production build, rendered-route checks, and a manual
wide/mobile visual pass before merging and deploying.

## Out of scope

- Payment processing, checkout, account creation, authentication, CRM/email
  delivery, real contact submission, API provisioning, live usage, analytics,
  pricing guarantees, and collection of personal data.
- A separate investor site, newsroom, or claims beyond cited public evidence.
