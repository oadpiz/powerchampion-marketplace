# Marketplace + Enterprise Trust Redesign

## Decision

Power Champion will use the approved **C direction**: a full-site hybrid of a
high-clarity token marketplace and an enterprise infrastructure trust site.
The marketplace journey remains dark, technical, and conversion-oriented;
enterprise review surfaces use a brighter editorial layer with more whitespace,
fewer containers, and source-aware evidence. Both layers belong to one Power
Champion design system and must never look like two separate brands.

The redesign is English-first with complete Traditional Chinese localization.
It is inspired by the review sequence of the public SENDFU site—catalog,
infrastructure, documentation, trust, access, company, and status—but does not
copy its text, imagery, layouts, or claims.

## Product truth and release boundary

This is a professional launch website for future enterprise and individual
token access, not a live commerce or inference service. Until the underlying
capabilities are independently verified and released, the site must state:

- token access is launching soon;
- prices, packages, availability, balance, usage, and performance displays are
  illustrative;
- checkout and payment are not enabled;
- launch-access actions create no order, charge, reservation, account, balance,
  credential, or service commitment;
- the console is a local preview and documentation examples are non-operational;
- status is launch-preparation information, not an SLA or live uptime dashboard.

No visual polish may weaken these qualifications. Readiness claims, data-centre
locations, capacity, privacy behavior, model licensing, supported API features,
and model availability may only be promoted when their source and operating
state are present in the repository's authoritative data.

## Audiences and primary journeys

### Individual developers and product teams

The primary journey is:

1. Understand the one-endpoint, open-model proposition.
2. Compare model capabilities, token rates, context, and output limits.
3. Estimate an illustrative workload cost.
4. Review the familiar API format and preview console.
5. Join non-binding launch access.

The consumer-facing CTA language is **Compare token rates** and **Join launch
access**, never “Buy now” while payments are unavailable.

### Enterprise buyers, platform partners, and technical reviewers

The parallel journey is:

1. Understand the boundary between public marketplace information and future
   protected access.
2. Review infrastructure architecture, serving responsibilities, and qualified
   capacity context.
3. Review privacy, retention, model provenance, service status, and source
   disclosures.
4. Read integration documentation without interpreting examples as a live API.
5. Start a non-binding **Deployment review** through the local-only enquiry
   experience.

The two journeys meet in shared model and pricing data, but their CTAs remain
distinct throughout the site.

## Information architecture

### Primary navigation

Desktop navigation uses a restrained seven-item structure:

- Models
- Pricing
- Infrastructure
- Docs
- Trust
- Company
- Status

The header's primary action is **Join launch access**. **Deployment review** is
present in enterprise sections and the mobile menu. Console remains reachable
from product and footer contexts rather than competing with the principal
navigation. Contact is represented as Deployment review and resolves to the
existing `/contact` experience.

### Footer

The footer groups links by Product, Enterprise, Company, and Legal. It includes
Models, Pricing, Docs, Console, Infrastructure, Trust, Company, Deployment
review, Status, FAQ, Terms, and Privacy. Every item is a real route; disabled
`#` links are removed.

### Route set

Existing routes are retained and redesigned:

- `/` — dual-journey marketplace and trust overview
- `/models` — model catalog and decision details
- `/pricing` — rate comparison, estimator, and launch packages
- `/docs` — public integration preview and protected-access boundary
- `/console` — illustrative local console
- `/company` — sourced company context
- `/contact` — local-only deployment review / launch-access enquiry

New public routes complete the review path:

- `/infrastructure` — capacity-to-serving architecture and qualified evidence
- `/trust` — data handling, provenance, operational boundaries, and policies
- `/status` — launch-preparation status, manifest links, and readiness scope
- `/faq` — concise developer and enterprise decision support
- `/terms` — launch-site terms and non-transactional boundary
- `/privacy` — current local-only interaction and data-handling description

## Page design

### Home

The home page uses a deliberate dark-to-light progression:

1. **Dark marketplace hero** — a concise proposition, visible “launching soon”
   state, **Compare token rates** primary CTA, and **Deployment review**
   secondary CTA.
2. **Marketplace proof rail** — only qualified model count, maximum context,
   and indicative starting rate. Generic availability percentages are removed
   unless backed by a real status source.
3. **Featured model ledger** — four models displayed as editorial rows with
   pricing, context, max output, capability, provenance label, and release
   status visible without opening a modal.
4. **How access works** — compare, estimate, request access; avoids suggesting
   a completed purchase flow.
5. **Bright enterprise bridge** — architecture from capacity context through
   future serving and unified delivery, clearly distinguishing announced or
   expected capacity from completed deployment.
6. **Trust review strip** — privacy, provenance, policies, and status with direct
   links and visible qualifications.
7. **Split closing action** — Join launch access for developers; Deployment
   review for enterprise visitors.

The current credit-package block becomes a disciplined rate/access section
rather than three repeated sales cards. The compact console preview remains,
but it cannot visually resemble a funded live account.

### Models

The catalog prioritizes comparison over decorative cards. Each row or expanded
detail includes, when present in authoritative model data:

- model name and stable identifier;
- category and intended workload;
- input and output USD price per one million tokens;
- context length and maximum output;
- tool use, structured output, reasoning, and streaming support;
- model provenance / license reference and Power Champion's serving role;
- data-centre or region only when verified;
- release state and a clear unavailable state.

Filtering remains usable on mobile, facts are never hidden to save space, and
model details use a consistent comparison vocabulary.

### Pricing

Pricing is a decision page, not a checkout page. It contains a transparent
rate table, workload estimator, concise package examples, and an explanation
of input/output token billing. All values remain visibly illustrative until
commercial release. Blank or invalid estimator values fail visibly rather than
silently becoming a purchase estimate.

The main CTA is Join launch access. Payment UI remains paused and no payment
provider is introduced in this redesign.

### Infrastructure

Infrastructure uses the bright editorial layer. It explains three bounded
stages—capacity context, serving layer, and unified delivery—without presenting
future or counterparty-reported capacity as deployed Power Champion hardware.
The existing public Company source remains the sole basis for the 3.1 MW and
potential expansion context. Source labels and qualifications sit beside the
figures, not in an obscure footnote.

An enterprise review panel lists the evidence a future deployment review would
cover: workload, model requirements, usage profile, deployment region, data
handling, and service-readiness gates. It does not claim those controls are
already operational.

### Docs

Docs clearly separates:

- **Public preview** — model metadata, request shape, code examples, and
  integration expectations.
- **Protected access** — future credentials, inference traffic, usage, support,
  and commercial terms.

Code examples are labelled non-operational while the API is not released. A
technical-review checklist describes streaming, usage accounting, tool calls,
structured output, manifest, and status evidence as release gates rather than
completed features unless real runtime evidence exists.

### Trust

Trust is an evidence-oriented page with four sections:

- data handling and the exact current local-only behavior;
- model provenance and license review expectations;
- service boundaries, status, and release controls;
- direct links to Privacy, Terms, Status, and Company sources.

It must not imply certifications, audits, security controls, retention behavior,
or training behavior that is not explicitly backed by current policy and
implementation evidence.

### Status

Status presents launch preparation and the public evidence that actually
exists. It distinguishes website availability, manifest readiness, model API
readiness, payment readiness, and enterprise review readiness. A single “all
systems operational” treatment is prohibited until all relevant systems are
live and monitored.

If a public manifest or status JSON is available, the page may link to it and
render exact fields. It must not transform `is_ready: false` into a positive
badge or infer uptime from the marketing website.

### Company, Contact, FAQ, Terms, and Privacy

Company keeps the existing SEC exhibit and third-party directory context in
the centralized company data module. It remains explicit that counterparty
expectations are not completed deployment, revenue received by Power Champion,
regulatory approval, or investment guidance.

Contact becomes the shared non-binding access surface. Visitors choose Launch
access, Infrastructure planning, or Model partnership. The current local-only
behavior remains visible before and after submission; no personal information
is transmitted or persisted.

FAQ, Terms, and Privacy implement the previously approved trust-content design
and inherit the new visual system. They answer or disclose boundaries without
inventing support contacts, addresses, uptime, payment, account, or compliance
claims.

## Visual system

### Shared tokens

- Near-black graphite grounds for marketplace and product sections.
- Warm near-white / pale mineral grounds for enterprise and evidence sections.
- Electric cyan for actions and selected technical states.
- Acid-lime used sparingly for a verified or explicitly qualified positive
  state, never as generic decoration.
- Cool violet as a low-intensity depth accent, not a competing CTA color.
- Hairline rules, large editorial spacing, and broad section rhythm replace
  repeated small cards and badge clusters.

Typography keeps a confident grotesk display face and disciplined monospace for
identifiers, prices, endpoints, and measured facts. Small text is at least 13px;
body and decision-support copy target 16–18px. Dense facts use aligned lists or
tables, not miniature floating widgets.

### Motion and graphics

Motion is functional and restrained: section-reveal opacity/translation,
focused number transitions, and slow ambient gradients only. Decorative orbit
graphics and busy particle systems are excluded. `prefers-reduced-motion`
removes non-essential movement.

The hero graphic, if retained, becomes an abstract routing field with crisp
lines and depth rather than a literal orbit. It must not imply real traffic,
nodes, or geographic deployment.

### Responsive behavior

At tablet and mobile widths:

- no model facts, evidence qualifiers, prices, or trust descriptions are
  hidden;
- comparison rows may stack but preserve label/value relationships;
- tables use a deliberate scroll container with a visible affordance;
- dual CTAs remain distinct and reachable;
- the mobile menu traps focus, closes with Escape, restores focus, and isolates
  the underlying page;
- Traditional Chinese does not clip, overflow, or collapse into undersized
  type.

## Content architecture

Generic bilingual content stays centralized in `lib/content.ts`. Source-backed
company facts stay exclusively in `lib/company.ts`. Model facts and availability
stay in `lib/models.ts`; rates and package examples stay in `lib/pricing.ts`.

New trust and infrastructure data uses typed structures rather than being
duplicated across components. Status rendering consumes a normalized, bounded
view model so missing or false readiness fields fail closed. Routes render from
shared data, and tests compare displayed facts to those sources.

The locale remains a client-side experience for this phase, but every route is
complete in English and Traditional Chinese. The document `lang` attribute
must follow the selected locale (`en` or `zh-Hant`).

## Accessibility and interaction

- One `main#main-content` per route with a valid skip link.
- Semantic heading order and native links/buttons.
- Visible focus treatment on dark and light surfaces.
- Keyboard-complete navigation, filters, disclosures, estimator, enquiry, and
  launch-access dialog.
- Modal focus containment, Escape close, background isolation, body locking,
  and focus restoration.
- Status and validation messages use the appropriate live-region behavior.
- Color never carries readiness, price, or availability meaning alone.
- Contrast and zoom remain usable at 200%.

## SEO, metadata, and sources

Metadata remains launch-soon and does not advertise live token sales. Route
titles describe the page purpose, while descriptions preserve the illustrative
and non-operational boundary where relevant. Canonical and social metadata use
the active deployment host safely.

Public factual claims link directly to primary or clearly labelled third-party
sources. The SENDFU site is a design-reference source only and is not cited as
evidence for Power Champion capabilities.

## Verification and acceptance

The implementation is accepted only when:

- every navigation and footer destination resolves to a real route;
- English and Traditional Chinese content is complete on every route;
- model, price, company, infrastructure, and readiness claims match their
  authoritative typed data exactly;
- no live-sale, funded-account, credential, API-readiness, deployment,
  certification, or uptime claim appears without evidence;
- payment and real submission/network behavior remain absent;
- unit tests, lint, production build, and rendered-route checks pass;
- desktop, tablet, and mobile layouts are manually reviewed across the home,
  models, pricing, infrastructure, docs, trust, status, company, contact,
  console, FAQ, Terms, and Privacy routes;
- keyboard, reduced-motion, locale, 200% zoom, and modal/menu behavior pass a
  focused accessibility review;
- the deployed public site is updated only after local verification and a
  separate deployment authorization/checkpoint.

## Out of scope

- Payment processing, authentication, real accounts, funded balances, real API
  keys, live inference, CRM/email delivery, analytics, and persistent enquiry
  submission.
- Unsupported infrastructure ownership, customer, revenue, licensing,
  compliance, security-certification, geographic-serving, or uptime claims.
- Copying SENDFU branding, proprietary assets, page text, or visual composition.
- Changing DNS, Dokploy configuration, or production deployment as an implicit
  side effect of the visual/content redesign.
