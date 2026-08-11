# Formal Token Marketplace Design

## Purpose

Evolve Power Champion Marketplace from a polished product demonstration into a
credible, public-facing token-access marketplace. The site will remain
non-transactional until payment processing is explicitly introduced: visitors
can compare token-access plans, estimate usage, and request launch access, but
cannot pay, create a binding order, or receive tokens.

English remains the primary language and Traditional Chinese remains a complete
parallel locale.

## Product position

The public site sells access to supported open-source AI models through a
prepaid-token concept. It must be clear at every purchase-intent step that
availability and payments are **coming soon**. Pricing is indicative launch
information, not a checkout offer.

The simplified console remains a non-functional product preview. It must not
imply that a user already has a funded account, live API credentials, or live
usage.

## Information architecture

### Public navigation

The site navigation will include Home, Models, Pricing, Docs, Company, and
Console. Company is the public trust destination; it is not labelled Investor
Relations or Newsroom because the available record cannot support an ongoing
investor-news publication.

### Home

The home page remains product-led. It gains:

- an explicit `Token access launching soon` status and a launch-access CTA;
- a compact, factual infrastructure proof strip linking to Company;
- starting token-access rates for four featured models, each marked as a
  launch indication;
- no claims of live checkout, guaranteed model availability, funded balances,
  revenue, or customer usage.

### Pricing and purchase intent

Pricing continues to explain token packages, usage estimation, and model rates.
The primary CTA becomes `Join launch access` rather than a purchase action.
The checkout dialog becomes a request-preview dialog with a persistent notice:
`Payments are not enabled yet. This request does not create an order or charge
your account.`

The request result is local-only, has no payment fields, and does not represent
an account creation or completed transaction.

### Company

The Company page contains four bounded sections:

1. **Company record** — `Power Champion Investment Limited` and a carefully
   qualified reference to a public BVI company-directory listing. The page does
   not call the directory an official registry or use the listing as a proxy for
   regulatory approval, ownership, office address, leadership, or good standing.
2. **Infrastructure announcement** — a timeline card for the July 2026 AI
   infrastructure agreement cited in Azio AI Holdings' SEC-filed Exhibit 99.2.
   It identifies the announcement as a counterparty disclosure.
3. **Capacity context** — the announced initial capacity reservation of roughly
   US$27.9 million, the approximately 3.1 MW initial deployment, and the stated
   expansion right up to 12 MW / potential value up to US$100 million. Every
   expandable amount is visually and textually marked `Potential; subject to
   conditions and not guaranteed`.
4. **Sources and disclosures** — direct source links, source date, and a short
   disclosure explaining that the information is public third-party reporting,
   not an offer of securities, financial advice, performance guidance, or a
   promise of capacity or service.

The copy may state that the counterparty reported receiving an initial deposit.
It must not state that Power Champion received revenue, owns or operates the
data centre, has deployed the full capacity, or has exercised the expansion
right.

## Data and component boundaries

`lib/company.ts` will be the sole source for company facts, source metadata,
qualifications, and bilingual copy. Page and shared UI components consume this
data rather than repeating figures or source URLs.

The Company page will be assembled from small presentation components for the
record, timeline, capacity facts, and disclosures. Existing locale provider,
site shell, modal isolation, and shared CTA patterns will be reused.

## Visual direction

Keep the existing dark, precision-led visual language. The Company page should
look like a concise enterprise evidence brief: editorial typography, restrained
data labels, thin dividers, source footnotes, and a single capacity progression
from 3.1 MW to 12 MW. It must not use speculative charts, stock-style price
visuals, generic badges, or decorative crypto imagery.

On small screens, capacity facts remain visible as a readable vertical sequence;
no material context is hidden solely to create a compact layout.

## Accessibility and interaction

- Company facts use semantic headings, definition lists or labelled data,
  descriptive external-link labels, and an accessible source/disclosure region.
- Launch-access controls retain the existing focus, Escape, and focus-return
  behavior of the shared modal system.
- New labels and messages have English and Traditional Chinese equivalents.
- The page must work without JavaScript for reading company information and
  following source links.

## SEO and legal language

Company metadata describes a token-access marketplace and public infrastructure
context; it must not describe the site as a securities offering or an investment
platform. The Company page adds a canonical title/description suited to search
without repeating unqualified financial numbers in metadata.

## Verification

Unit and rendered-route tests will cover:

- the Company navigation and `/company` route in both locales;
- exact company figures, units, source links, and required qualifications;
- the absence of live-payment or completed-order claims in the launch-access
  experience;
- localized Company content and document language updates;
- mobile-visible capacity facts and semantic source/disclosure content.

Run the complete test suite, lint, production build, and rendered-route smoke
checks. After the feature is merged to `main`, push to GitHub and verify the
Dokploy auto-deployment before announcing it as live.

## Explicitly out of scope

- Payment providers, payment collection, invoices, refunds, tax handling, and
  issuance of tokens.
- Authentication, account creation, live API keys, live metering, and live
  balances.
- Claims beyond the cited public record, including team biographies, office
  addresses, licences, customers, financial performance, or operational status.
