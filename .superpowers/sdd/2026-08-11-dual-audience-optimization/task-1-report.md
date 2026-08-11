# Task 1 Report — Dual-Audience Home Paths

## Status

Complete.

## Tests and output

- Red: `npm run test:unit -- tests/audience-paths.test.tsx tests/homepage.test.tsx` failed as expected because the Home decision surface and both new path links did not exist.
- Focused suite: `npm run test:unit -- tests/audience-paths.test.tsx tests/homepage.test.tsx` passed — 2 files, 13 tests.
- Full unit suite: `npm run test:unit` passed — 10 files, 82 tests.
- `npm run lint` passed.
- `git diff --check` passed with no whitespace errors before commit.

## Commit

- `a12fe7a feat: add developer and enterprise paths`

## Self-review

- Added localized developer and enterprise actions to the Hero, plus sibling decision panels immediately below it. Both locales retain the visible launch-status message.
- The developer path targets `/models`; the enterprise path targets `/contact`. No form, account, API, transaction, or checkout behavior was added or changed.
- The panels use the existing dark/cyan design system, a single cyan developer rule, and stack at widths of 760px and below without hiding their labels or descriptions.
- `lib/company.ts`, Company source language, and the checkout event/flow were not changed.
