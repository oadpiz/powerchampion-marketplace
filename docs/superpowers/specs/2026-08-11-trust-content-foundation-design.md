# Trust Content Foundation Design

## Purpose

Complete the public Power Champion launch site with essential trust and
decision-support content while preserving its launch-only, non-transactional
status. The site will offer readable Terms, Privacy, Status, and FAQ surfaces
instead of disabled footer placeholders.

## Routes

- `/terms` explains that access, pricing, payments, service availability, and
  API provisioning are not yet live; it is informational launch-site content,
  not a contract for a completed purchase.
- `/privacy` explains the current local-only interactions: enquiry and launch
  previews do not transmit or persist entered data. It must not claim tracking,
  cookies, account storage, payment processing, or compliance certification.
- `/status` presents `Launch preparation` and the scope of the demonstration.
  It explicitly states that it is not a live monitoring dashboard or SLA.
- `/faq` answers developer and enterprise questions on model access, indicative
  pricing, launch access, Company sources, local enquiry behavior, and next
  steps. It must link to the relevant route rather than repeating sourced
  company facts.

## Navigation and copy

Footer Terms, Privacy, and Status become active links. FAQ is available from
Pricing and Contact, with an optional footer link only if it fits the existing
layout. About continues to resolve to Company. Every page is English-first with
complete Traditional Chinese copy, semantic headings, one `main#main-content`,
and the existing shell.

## Visual direction

Use compact editorial documents rather than card grids: narrow readable text
columns, clear section anchors, muted rules, and source-aware inline links.
FAQ uses accessible native disclosure elements or button/panel semantics with
keyboard support; on mobile it remains vertically readable without hiding
answers.

## Boundaries

No legal assurances, live monitoring, uptime history, support contacts,
business address, data collection, analytics, payment, account, API, or
service-availability claims are introduced. Existing Company information stays
centralized in `lib/company.ts`; generic FAQ and legal/status copy lives in
`lib/content.ts`.

## Verification

Tests cover all four routes, bilingual footer and FAQ navigation, semantic
headings, active footer links, FAQ disclosure behavior, launch-only language,
no sensitive/payment inputs, and rendered route/metadata checks. Run unit,
lint, production build, and rendered-route verification before deployment.
