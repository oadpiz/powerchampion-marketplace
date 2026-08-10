# Power Champion marketplace

A bilingual, local-only Power Champion marketplace prototype for exploring open
AI models through one demonstration balance and an OpenAI-compatible API shape.

## Routes

- `/` — marketplace story and featured models
- `/models` — searchable local model catalog
- `/pricing` — illustrative credit packs, rates, and calculator
- `/docs` — local quick-start examples
- `/console` — static demonstration console

## Commands

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

All prices, usage, API keys, and checkout interactions are demonstration data.
No network calls or payments occur.

This standalone site is not the existing production homepage and is not deployed
by this project.

## Dependency audit status

As of 2026-08-11, the full `npm audit` reports 17 findings (2 low, 2 moderate,
13 high), all confined to the development-tooling dependency graph. The
production dependency audit (`npm audit --omit=dev`) is clean. The outstanding
Vinext and transitive image-parser (`image-size`) advisories must be resolved
before this prototype receives any network exposure. Do not use a destructive
automated audit fix to prepare this local showcase.
