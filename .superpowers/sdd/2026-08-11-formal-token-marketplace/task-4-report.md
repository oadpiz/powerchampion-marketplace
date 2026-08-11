# Task 4 Report — Launch Access Presentation

## Status

Complete.

## Files

- `app/pricing/page.tsx`
- `components/demo-checkout.tsx`
- `lib/content.ts`
- `tests/components.test.tsx`
- `tests/homepage.test.tsx`
- `tests/pricing.test.tsx`
- `tests/rendered-html.test.mjs`

`components/home-content.tsx` did not require a code change: its existing CTA reads the localized `copy.nav.getTokens` value, so it inherits the launch-access wording without changing its event dispatch or content structure.

## Tests and output

- Red: `npm run test:unit -- tests/pricing.test.tsx tests/homepage.test.tsx` failed as expected because the existing UI still used token-purchase and demo-checkout wording.
- Focused suite: `npm run test:unit -- tests/pricing.test.tsx tests/components.test.tsx tests/homepage.test.tsx` passed — 3 files, 38 tests.
- Full unit suite: `npm run test:unit` passed — 9 files, 77 tests.
- `npm run lint` passed.
- `npm run build` passed.
- `node --test tests/rendered-html.test.mjs` passed — 6 tests.
- `git diff --check` passed with no whitespace errors.

## Commits

- `e5a678d feat: present token access as coming soon`

## Self-review

- `openCheckout(packId?)`, the `powerchampion:checkout` event shape, selection/review/complete flow, Escape behavior, focus trapping/restoration, and `useModalIsolation` are unchanged.
- The English and Traditional Chinese primary CTA now request launch access; no primary action uses buy, pay, or checkout wording.
- The dialog uses `launchNotice` and `requestComplete`; completion explicitly remains local to the demonstration and does not reserve capacity.
- The rendered-page regression asserts that pricing contains no card, payment, or billing input.
- No dependencies or deployment configuration changed.

## Concerns

`npm run build` emits Node's `DEP0040` `punycode` deprecation warning from the build toolchain, but the build and all tests pass.
