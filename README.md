# Power Champion marketplace

A bilingual, launch-only Power Champion marketplace for reviewing an
illustrative open-model catalog, indicative rates, public evidence, and future
access paths. It is a local demonstration, not a production service.

## Routes

- `/` — marketplace story and featured models
- `/models` — searchable local model catalog
- `/pricing` — illustrative rates and local planning calculator
- `/infrastructure` — qualified capacity context and release gates
- `/docs` — local quick-start examples
- `/trust` — public trust boundaries and review links
- `/status` — separate website and service-readiness states
- `/company` — cited company and infrastructure context
- `/contact` — local, non-binding deployment review
- `/console` — static demonstration console
- `/faq` — launch-boundary questions and answers
- `/terms` — informational, non-transactional site terms
- `/privacy` — current local-interaction privacy boundary

## Commands

```bash
npm install
npm run dev
npm run test:unit
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
npm test
```

`npm test` runs the unit suite, production build, and rendered-HTML route tests.

All prices, usage, API keys, estimator results, and launch-access interactions
are illustrative. Payment, a live API, accounts, persistence, and production
readiness are not implemented. Current enquiry and planning interactions remain
local to the browser and transmit nothing.

This standalone site is not the existing production homepage and is not deployed
by this project. Any deployment, DNS, or Dokploy change requires a separate
deployment checkpoint after local verification.

## Dependency audit status

As of 2026-08-11, the full `npm audit` reports 17 findings (2 low, 2 moderate,
13 high), all confined to the development-tooling dependency graph. The
production dependency audit (`npm audit --omit=dev`) is clean. The outstanding
Vinext and transitive image-parser (`image-size`) advisories must be resolved
before this prototype receives any network exposure. Do not use a destructive
automated audit fix to prepare this local showcase.
