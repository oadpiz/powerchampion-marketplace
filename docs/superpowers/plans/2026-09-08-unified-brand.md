# Unified Power Champion website

Goal: Consolidate the model API business, B300 compute services, and company information into one premium bilingual website. Model services are the primary business and first visitor journey. English is the default; an explicit Traditional Chinese preference persists.

Design: Warm ivory, deep forest green, carefully spaced typography, original metallic/emerald conceptual hero artwork, editorial section numbering, compact model cards, a restrained dark infrastructure section. Retain existing functional model catalog, pricing, API documentation, contact flow, and public gateway status.

Implementation:
- [x] Rebuild the homepage with model categories, correct rate units, integration examples, infrastructure and company sections, and FAQ.
- [x] Redesign shared navigation/footer and persist explicit locale preferences.
- [x] Apply the shared palette to existing product and information pages.
- [x] Verify model filters, example switching/copying, language persistence, keyboard navigation and mobile layouts; run unit tests, lint, TypeScript, production build and rendered route checks.

Content: Public sources reviewed 2026-09-08: powerchampion.ai (models, pricing, docs, company, status), powerchampion.org (services, architecture). b300.powerchampion.ai is the API origin. No fixed online counts, unsupported uptime claims, fake certifications or invented customer logos. Infrastructure capacity is qualified; company disclosure remains on the company page. Keep prices derived from the catalog with explicit units. Contact uses the existing email-draft flow.

Delivery: Local preview on localhost:3010. Preserve the production gateway and configuration. Production deployment and domain redirects require the project deployment checkpoint in /Users/optyne/repository/b300/CLAUDE.md.


## Verification — 2026-09-09

- ESLint and TypeScript checks passed.
- 141 unit tests passed across 16 files. On Node 25, run with `NODE_OPTIONS=--no-experimental-webstorage` to let jsdom own localStorage.
- Production build succeeded; all 10 rendered-route tests passed.
- Browser verified at 1440, 768, 390, and 320 pixels. No viewport overflow.
- Verified model-category filtering, model anchor destinations, Python/cURL switching, clipboard copy, access dialog, mobile Escape/focus restoration, and Traditional Chinese persistence across navigation.
- Independent review verified 19 internal links and model fragment targets. Fixed light-theme code contrast, validation messages, button hover contrast, and form borders.
- No production deployment, DNS changes, production configuration edits, or outgoing messages.

## Asset

`public/model-core.png` is an original 1536 × 1024 conceptual hero illustration generated with the built-in imagegen tool, not a photograph of actual equipment. Prompt: premium industrial-design render of four thin brushed-silver plates enclosing an emerald glass computational core, floating in a warm ivory studio, landscape 3:2, right-side composition with left negative space; no text, logos, UI, or recognizable actual hardware.

## Additional reference

The user supplied https://enginestar-aih.com during implementation. Public pages identify EngineStar Technology Co., Ltd. and a New API-based model platform. Used only as a product-flow reference pending clarification; no EngineStar company identity, plan prices, or unsupported brand relationship was copied into Power Champion.


## Platform expansion — 2026-09-10

The user clarified that the intended product is a multi-page, functional model platform comparable in structure to XLRouter, with company and GPU services retained. The approved implementation direction is one brand with a website entrance and a distinct developer platform; a separate developer host remains possible later. No DNS or deployment change was made.

### Delivered locally

- Graphite/neutral/champagne palette across the website, workspace, product pages, forms, and dialogs; original noir conceptual hardware artwork.
- `/platform`: tool overview with the real gateway status, catalog, model comparison, playground, integrations, and balance links. No fabricated account statistics.
- Shared desktop sidebar and mobile tool navigation for platform/model/pricing/docs/balance/status routes.
- `/models/[modelId]`: eight individual catalog-backed model pages with capabilities, billing units, copied IDs, and model-specific onward links.
- `/compare`: up to three models, unit-aware usage estimates (tokens/images/audio), and shareable model selections.
- `/integrations`: configurable model-specific Python/JavaScript/cURL examples, editable inputs, copy actions and generic compatible-client setup. IndexTTS2 uses provisioned reference voice IDs.
- `/playground`: actual user-triggered single-turn text requests, settings, cancellable loading, response and token usage, safe errors, and code copy. API keys remain in component memory and are not saved in browser storage.
- `/api/playground`: fixed-origin, bounded same-origin proxy with model allowlisting, input validation, deadline/cancellation, no-store output, safe errors and key redaction.
- Expanded company service matrix and infrastructure planning pages; workload selection changes the planning questions. Existing SEC qualifications preserved.
- Corrected IndexTTS2 billing labels, static-rate wording, and privacy statements to disclose the actual server proxy.

### Verification

- ESLint, TypeScript, production build and diff whitespace checks passed.
- 181 unit/component/API tests across 20 files passed.
- 11 rendered-page test cases passed, including all new tools, all eight model detail routes, and unknown-model 404.
- Browser checked new tools, company/infrastructure/home, legacy model/pricing/docs/balance pages at 1440, 768, 390 and 320 pixels where applicable. No viewport overflow. Each page has one main landmark.
- Explicit Traditional Chinese preference persisted across navigation. Model deep-links select the correct integrations/playground model.
- Playground success, failure, cancellation, validation, redaction, and non-persistence were tested with mocked upstream generation. No paid generation or real customer key was used.
- The public gateway reported a service interruption during verification. Successful production inference remains unverified.

### Boundaries and next integration work

This is a locally reviewable implementation at http://localhost:3010/platform, not a production deployment. Customer accounts, self-service key issuance/rotation, usage history, and online payments require tenant-scoped backend integration. The existing admin APIs were not exposed. No production config, private data, DNS, or outgoing email was changed.

The user references https://www.xlrouter.com and https://enginestar-aih.com informed the workflow, model discovery and information hierarchy. Their company identity, plan pricing, provider claims, customer statistics and authenticated dashboards were not copied.

`public/model-core-noir.png` is a 1536 × 1024 original conceptual image: floating blackened titanium plates, smoky glass core, graphite studio and restrained champagne edge lighting. It is not a photograph of owned equipment.

Latest preview screenshots are in `outputs/unified-brand/`, including platform.png, integrations.png, compare.png, playground.png, home-noir.png, company.png and mobile variants.
