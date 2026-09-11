# Customer platform and international launch

The user authorized continuing the existing Power Champion site with a functional customer/admin backend, additional languages, SEO and marketing materials. Model API sales remain primary; dedicated GPU services remain available. English is the default, with Traditional Chinese preserved.

## Deliverables

- A persistent customer service with registration, login/logout, opaque cookie sessions, customer-owned keys and usage, and manual credit verification requests.
- Administrator views for customers, verification decisions and audit history; administrator creation is an explicit local CLI operation, never a public signup option.
- A same-origin frontend proxy to a separately configured private service, with credentials and gateway administration kept server-side.
- Twenty translated public pages across Traditional Chinese, Simplified Chinese, Japanese and Korean. Each language has home, models, pricing, infrastructure and company pages. Developer tools and account UI support English and Traditional Chinese.
- Production canonical URLs, reciprocal language alternates, page-specific social metadata, a 1200×630 share card, structured company data, a generated public sitemap and private/preview noindex controls.
- English and Traditional Chinese launch copy, campaign links and a four-week organic promotion plan, prepared for review.

## Service boundaries

The currently checked-in production entry point is the parent Python gateway. Its administration API can issue/revoke keys and report usage, but it does not provide customer authentication, a payment processor, or the frontend's previously assumed prepaid-account contract. The new customer service is separate and uses its own SQLite store. No production configuration or private files are modified.

Gateway provisioning stays unavailable until the operator supplies the service-side gateway admin token. Customer key ownership is recorded locally and enforced on every read/write. A manually approved credit request is a verification record, not a settled payment and not a gateway spendable balance. Payment settlement, refunds, webhook reconciliation and gateway credit enforcement require an actual billing integration.

The private service requires durable storage and HTTPS in production. Account recovery initially uses operator tooling; no email delivery or third-party identity provider is assumed. Production rollout, public posts, emails, advertising spend and search-engine submissions remain separate actions requiring authorization.

## Validation

Backend tests cover account isolation, sessions, permissions, key lifecycle, credit validation and review atomicity. Frontend tests cover real interaction states with controlled service responses; proxy tests cover cookies, origin enforcement, endpoint restrictions and failure redaction. Rendered-page checks validate the SEO output. Local browser checks exercise account workflows and translated pages at desktop/mobile widths. No paid model request is necessary for this release.

## Verified delivery — 11 September 2026

- 221 frontend/component/API tests passed across 25 files; 38 isolated Python service tests passed; 13 built-HTML tests passed (272 total).
- TypeScript, ESLint, production build and whitespace checks passed.
- All 20 localized URLs passed live SSR checks for status, language, canonical, reciprocal alternatives, noindex on preview and single main/H1. Five Korean page types were checked at 320px and 768px without document overflow; Japanese desktop and Korean mobile were visually reviewed.
- Real local browser flow: customer registration → authenticated account → submit a clearly labeled synthetic verification request → customer denied admin API with 403 → operator-created admin login → explicitly approve the request → customer sees persisted approval after service restart. Actual logout was verified to return session401.
- Browser JavaScript could not read the HttpOnly session cookie; localStorage contained no key or session credential. Test accounts and their synthetic records were removed after verification, preserving other accounts.
- Independent reproductions verified per-account throttling under concurrency, the 20-key provisioning limit, reservation cleanup/compensating revocation, and truthful handling of missing owned-model pricing.
- Workerd-specific integration failures were fixed: use manual redirect handling with explicit rejection, and accept empty POST/DELETE body streams. Regression tests cover both.
- Graphite/champagne share card is 1200×630 and favicon is 128×128, matching the current brand mark. Marketing kit has 16 validated UTM links and 12 English search headlines within 30 characters.

Local browser screenshots are in `outputs/growth/` and `outputs/unified-brand/` (ignored by Git). Operational setup and administrator bootstrap are documented in `docs/portal-operations.md` and `server/README.md`. No production deployment, real gateway key issuance, paid model call, payment, social publication or email send was performed.
