# Marketing Site Information Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `powerchampion.ai` (the vinext marketing site) tell the truth about the models, prices, legal terms, language and metadata that `b300.powerchampion.ai` actually serves, by consuming the gateway's `/catalog.json` instead of build-time constants and by hosting the single authoritative legal texts.

**Architecture:** A new `lib/catalog.ts` owns the gateway contract (types, a frozen `CATALOG_SNAPSHOT`, and `fetchCatalog()` with a snapshot fallback). `lib/models.ts` keeps only presentation metadata (`MODEL_PRESENTATION`) plus a pure `mergeCatalog()` that joins gateway facts with presentation into the `ModelDefinition` the components already render. Pages become async server components that fetch once and pass the merged array down, so every surface (home proof strip, `/models`, `/pricing`, the estimator, `/docs` release gates) derives from one array. Legal texts move from the gateway's inline HTML into `lib/trust.ts` as structured bilingual sections rendered by the existing `EditorialPage`. Locale gains a cookie plus a server-resolved `initialLocale`.

**Tech Stack:** vinext 1.0.0-beta.2 (Vite-based Next.js-compatible framework — **not** official Next.js), React 19.2, TypeScript 5.9 (strict), Vitest 4 + Testing Library (jsdom), `node --test` for the built-worker HTML test, Cloudflare Workers runtime (`worker/index.ts`), Docker on Dokploy.

## Global Constraints

- Work only inside the worktree `/Users/optyne/repository/b300/sell-panel/powerchampion-marketplace/.worktrees/site-info-2026-09-09` (branch `fix/site-info-2026-09-09`). Never `cd` to the main checkout. Never merge another branch, never push, never touch remotes. If a dependency is missing, stop and report BLOCKED.
- This plan covers the **marketing site only**. The gateway (`sell-panel/app.py`) work — `/catalog.json`, the 301 redirects, the `config.yaml` description, deleting `site/` — is a separate plan. Do not edit anything under `/Users/optyne/repository/b300/sell-panel/` except to **read** `app.py` and `config.yaml`.
- The gateway `/catalog.json` endpoint **does not exist yet**. Until it ships, `fetchCatalog()` must fall back to `CATALOG_SNAPSHOT` and every page must render the snapshot notice. That is the intended rollout order (spec §10.4a) — a failing live fetch is not a bug.
- Legal constants, exact values, used everywhere: `LEGAL_EFFECTIVE_DATE = "2026-09-09"`, entity `Power Champion Investment Limited`, contact `info@powerchampion.org`, gateway host `b300.powerchampion.ai`.
- No unfilled placeholders may reach a rendered legal page: no `[`, no `TBD`, no `yourdomain`, no `powerchampion.org` in a URL position (the `info@powerchampion.org` mail address is allowed).
- Both locales, always. Every new user-visible string needs an `en` and a `zh` (Traditional Chinese, Taiwan wording) value. Never ship an English string into the `zh` dictionary.
- Prices, model set, and billing rules are **not** changed by this work. Numbers come from the gateway; the site only reformats them.
- Tests must stay green at every commit: `npx vitest run` (baseline **140 passed, 16 files**, verified 2026-09-09 at commit `2c1161d`) and `npm run build`.
- Node v25 is in use; `tests/setup.ts` already polyfills the broken Web Storage globals. Do not remove that polyfill.
- Media pricing arithmetic, fixed by the gateway's billing rules (`config.yaml` comments): image models are metered as a 1000-token equivalent per image, audio models as a 1000-token equivalent per 20 seconds. So displayed per-image price = `completion_usd / 1000`, displayed per-minute-of-audio price = `completion_usd * 3 / 1000`. These reproduce today's published numbers exactly (flux `10.0 → $0.01/image`, indextts2 `10.0 → $0.03/min`, whisper `3.33 → $0.00999 → "$0.01"/min`).

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `lib/catalog.ts` | The gateway contract only: `CatalogModel`/`CatalogPayload`/`CatalogResult` types, the frozen `CATALOG_SNAPSHOT` + `CATALOG_SNAPSHOT_DATE`, and `fetchCatalog()` with its snapshot fallback. No React, no locale. |
| `tests/catalog.test.ts` | Unit tests for `fetchCatalog()` (live / non-200 / timeout / malformed) and for the snapshot's internal consistency. |
| `scripts/sync-catalog-snapshot.mjs` | Manual pre-release tool: fetch `/catalog.json`, rewrite the marked snapshot block in `lib/catalog.ts`. Exports pure helpers so it is testable. |
| `tests/sync-catalog-snapshot.test.ts` | Tests the script's pure helpers. |
| `app/data-retention/page.tsx` | The third policy route. |
| `app/about/page.tsx` | Permanent redirect to `/company`. |
| `public/openapi.json` | Public OpenAPI 3.1 description of the gateway's public surface. |
| `tests/openapi.test.ts` | Parses `public/openapi.json` and pins its path set. |
| `tests/legal-pages.test.tsx` | Placeholder scan + cross-link assertions for the three policy pages. |
| `lib/locale.ts` | Framework-free locale resolution shared by the server layout and the client provider: the cookie/storage constants, `resolveInitialLocale()`, `localeFromAcceptLanguage()`, `htmlLangFor()`, and the browser cookie read/write. No React, no `next/headers`. |
| `tests/locale-resolution.test.ts` | Unit tests for `lib/locale.ts`'s pure helpers. |
| `tests/metadata.test.ts` | Route-title, sitemap and `/about`-redirect assertions. |
| `docs/superpowers/plans/2026-09-09-marketing-site-info-anchors.md` | The pre-deploy numeric anchors, filled in with real measured output by Task 9. |

**Modified**

| Path | Change |
|---|---|
| `lib/models.ts` | `MODEL_CATALOG` deleted. Now: `ModelPresentation`, `MODEL_PRESENTATION`, `ModelDefinition`, `mergeCatalog()`, derived-default helpers, `SNAPSHOT_CATALOG`, and the unchanged `filterModels()`. |
| `lib/gateway-status.ts` | Export `GATEWAY_ORIGIN` (currently module-private) so the catalogue and the status link share one definition. |
| `lib/content.ts` | New copy keys: `footer.dataRetention`, `shared.catalogSnapshotNotice`, `shared.openApiSpec`. |
| `lib/trust.ts` | Legal constants; `PolicyDocument` type; `POLICY_CONTENT` rewritten with the gateway's full texts plus a new `dataRetention` document, both locales. |
| `lib/metadata.ts` | `/contact` title fixed; `/data-retention` route added. |
| `components/editorial-page.tsx` | Renders `meta` line and `related` cross-links; accepts the `dataRetention` policy. |
| `components/model-marketplace.tsx` | Takes `models` prop; uses `billingUnit`/`unitPrice`; renders per-model `notice`. |
| `components/models-page-content.tsx` | Takes `models` + `snapshotDate`; renders the snapshot notice. |
| `components/pricing-page-content.tsx` | Same, and the rate table derives from the prop. |
| `components/pricing-calculator.tsx` | Takes `models`; token-billing check uses `billingUnit`. |
| `components/home-content.tsx` | Takes `models` + `snapshotDate`; proof strip counts ready models. |
| `components/docs-page-content.tsx` | Takes `models`; adds the OpenAPI link. |
| `components/live-status-content.tsx` | Takes `gatewayOrigin`; the `status.json` link uses it. |
| `components/site-shell.tsx` | Footer gains "Data retention". |
| `app/page.tsx`, `app/models/page.tsx`, `app/pricing/page.tsx`, `app/docs/page.tsx`, `app/status/page.tsx` | Async server components fetching the catalogue; `export const revalidate = 60`. |
| `app/layout.tsx` | Server-resolved `initialLocale` (or the inline-script fallback). |
| `components/locale-provider.tsx` | `initialLocale` prop, cookie read/write, new `detectLocale` precedence. |
| `app/globals.css` | Two new rules: `.catalog-snapshot-notice`, `.marketplace-model-notice`. |
| `public/sitemap.xml` | Adds `/console` and `/data-retention`. |
| Tests: `tests/setup.ts` (clears the locale cookie and `data-locale` between tests), `tests/unit.test.ts`, `tests/content-foundation.test.ts`, `tests/marketplace.test.tsx`, `tests/pricing.test.tsx`, `tests/homepage.test.tsx`, `tests/audience-paths.test.tsx`, `tests/docs-console.test.tsx`, `tests/skip-link.test.tsx`, `tests/trust-pages.test.tsx`, `tests/locale-detection.test.tsx`, `tests/rendered-html.test.mjs` | Updated for the new component contracts and new behaviour. |

**Not touched:** `lib/company.ts`, `lib/console-data.ts`, `lib/pricing.ts`, `components/code-samples.tsx` (its hard-coded example model ids are out of scope), `worker/index.ts` (no task touches it — the `/about` redirect is a page-level `permanentRedirect()` in Task 7, and `public/openapi.json` in Task 8 is a static asset, so neither needs a worker route), `Dockerfile`, `docker-compose.dokploy.yml`.

---

## Task 1: `lib/catalog.ts` — gateway catalogue contract and snapshot fallback

**Files:**
- Create: `lib/catalog.ts`
- Create: `tests/catalog.test.ts`
- Modify: `lib/gateway-status.ts:30-31` (export the existing `GATEWAY_ORIGIN` constant)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces, relied on by Tasks 2, 3, 4, 7:
  - `type CatalogModalities = { input: string[]; output: string[] }`
  - `type CatalogPricing = { unit: "per_million_tokens"; prompt_usd: number; completion_usd: number }`
  - `type CatalogModel = { id: string; name: string; description: string; modalities: CatalogModalities; context_length: number | null; max_output_length: number | null; pricing: CatalogPricing; billing_note: string | null; ready: boolean; uptime: number | null }`
  - `type CatalogPayload = { updated: string; models: CatalogModel[] }`
  - `type CatalogSource = "live" | "snapshot"`
  - `type CatalogResult = { source: CatalogSource; updated: string; models: CatalogModel[] }`
  - `const CATALOG_SNAPSHOT_DATE: string` (currently `"2026-09-09"`)
  - `const CATALOG_SNAPSHOT: CatalogModel[]` (9 entries)
  - `async function fetchCatalog(): Promise<CatalogResult>`
  - re-exported `const GATEWAY_ORIGIN: string` from `lib/gateway-status.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/catalog.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CATALOG_SNAPSHOT,
  CATALOG_SNAPSHOT_DATE,
  fetchCatalog,
  type CatalogPayload,
} from "../lib/catalog";

const livePayload: CatalogPayload = {
  updated: "2026-09-09T08:00:00Z",
  models: [
    {
      id: "glm-5.2-fp8",
      name: "GLM 5.2 FP8",
      description: "Frontier bilingual reasoning model.",
      modalities: { input: ["text"], output: ["text"] },
      context_length: 131072,
      max_output_length: 32768,
      pricing: { unit: "per_million_tokens", prompt_usd: 0.93, completion_usd: 3.0 },
      billing_note: null,
      ready: true,
      uptime: 0.998,
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchCatalog", () => {
  it("returns the live gateway models when the endpoint answers", async () => {
    const mock = vi.fn(async () => jsonResponse(livePayload));
    vi.stubGlobal("fetch", mock);

    const result = await fetchCatalog();

    expect(result.source).toBe("live");
    expect(result.updated).toBe("2026-09-09T08:00:00Z");
    expect(result.models.map((model) => model.id)).toEqual(["glm-5.2-fp8"]);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe("https://b300.powerchampion.ai/catalog.json");
  });

  it("passes an abort signal so a hung gateway cannot hang the page", async () => {
    const mock = vi.fn(async () => jsonResponse(livePayload));
    vi.stubGlobal("fetch", mock);

    await fetchCatalog();

    const init = mock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to the snapshot when the gateway answers non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 503)));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
    expect(result.updated).toBe(CATALOG_SNAPSHOT_DATE);
    expect(result.models).toEqual(CATALOG_SNAPSHOT);
  });

  it("falls back to the snapshot when the request times out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    }));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
    expect(result.models).toEqual(CATALOG_SNAPSHOT);
  });

  it("falls back to the snapshot when the payload has no models", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ updated: "x", models: [] })));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
  });

  it("falls back to the snapshot when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 200 })));

    const result = await fetchCatalog();

    expect(result.source).toBe("snapshot");
  });
});

describe("CATALOG_SNAPSHOT", () => {
  it("holds the nine models the gateway currently enables", () => {
    expect(CATALOG_SNAPSHOT.map((model) => model.id)).toEqual([
      "glm-5.2-fp8",
      "glm-5.3-flash-uncensored",
      "qwen3-vl-30b",
      "flux-schnell",
      "chroma1-hd",
      "whisper-large-v3",
      "indextts2",
      "bge-m3",
      "bge-reranker-v2-m3",
    ]);
  });

  it("keeps every entry structurally complete", () => {
    for (const model of CATALOG_SNAPSHOT) {
      expect(model.name).toBeTruthy();
      expect(model.description).toBeTruthy();
      expect(model.pricing.unit).toBe("per_million_tokens");
      expect(model.pricing.prompt_usd).toBeGreaterThanOrEqual(0);
      expect(model.pricing.completion_usd).toBeGreaterThanOrEqual(0);
      expect(model.modalities.input.length).toBeGreaterThan(0);
      expect(model.modalities.output.length).toBeGreaterThan(0);
    }
  });

  it("carries a billing note on every media model", () => {
    const media = CATALOG_SNAPSHOT.filter(
      (model) =>
        model.modalities.output.includes("image") ||
        model.modalities.output.includes("audio") ||
        model.modalities.input.includes("audio"),
    );
    expect(media).toHaveLength(4);
    for (const model of media) {
      expect(model.billing_note).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/catalog.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/catalog"`.

- [ ] **Step 3: Export `GATEWAY_ORIGIN` from `lib/gateway-status.ts`**

In `lib/gateway-status.ts`, change line 30 from `const GATEWAY_ORIGIN =` to `export const GATEWAY_ORIGIN =`. The rest of the file is unchanged:

```ts
export const GATEWAY_ORIGIN =
  process.env.GATEWAY_ORIGIN ?? "https://b300.powerchampion.ai";
```

- [ ] **Step 4: Create `lib/catalog.ts`**

Every number below was read from `sell-panel/config.yaml` on 2026-09-09 (`served_context_length` preferred over `context_length`, per spec §3.1). Do not invent values.

```ts
/**
 * The gateway's public model catalogue.
 *
 * `b300.powerchampion.ai/catalog.json` is the single source of truth for which
 * models exist, what they cost, and whether they are serving right now. This
 * module is the only place that knows that endpoint's shape. It never throws:
 * a slow, broken or not-yet-deployed gateway degrades to CATALOG_SNAPSHOT, and
 * the caller is told which one it got so the page can say so out loud.
 *
 * Presentation (categories, taglines, capability flags) deliberately lives in
 * lib/models.ts instead — the gateway has no opinion about how a card looks.
 */
import { GATEWAY_ORIGIN } from "./gateway-status";

export { GATEWAY_ORIGIN };

export type CatalogModalities = {
  input: string[];
  output: string[];
};

export type CatalogPricing = {
  unit: "per_million_tokens";
  prompt_usd: number;
  completion_usd: number;
};

export type CatalogModel = {
  id: string;
  name: string;
  description: string;
  modalities: CatalogModalities;
  /** served_context_length when the gateway sets one, else context_length. */
  context_length: number | null;
  max_output_length: number | null;
  pricing: CatalogPricing;
  /** How a non-token unit maps onto the per-million meter, or null for text. */
  billing_note: string | null;
  ready: boolean;
  uptime: number | null;
};

export type CatalogPayload = {
  updated: string;
  models: CatalogModel[];
};

export type CatalogSource = "live" | "snapshot";

export type CatalogResult = {
  source: CatalogSource;
  updated: string;
  models: CatalogModel[];
};

const IMAGE_BILLING_NOTE = "1000-token equivalent per image";
const AUDIO_BILLING_NOTE = "1000-token equivalent per 20 seconds of audio";

// catalog-snapshot:start — regenerated by scripts/sync-catalog-snapshot.mjs
export const CATALOG_SNAPSHOT_DATE = "2026-09-09";

export const CATALOG_SNAPSHOT: CatalogModel[] = [
  {
    id: "glm-5.2-fp8",
    name: "GLM 5.2 FP8",
    description: "Frontier bilingual reasoning model with extended thinking, served FP8 on the Thailand B300 fleet.",
    modalities: { input: ["text"], output: ["text"] },
    context_length: 131072,
    max_output_length: 32768,
    pricing: { unit: "per_million_tokens", prompt_usd: 0.93, completion_usd: 3.0 },
    billing_note: null,
    ready: true,
    uptime: null,
  },
  {
    id: "glm-5.3-flash-uncensored",
    name: "GLM 5.3 Flash Uncensored",
    description: "GLM-5.3 Flash community fine-tune with safety refusals removed. 32K context. Intended for research, red-teaming and creative work where refusals get in the way. No content filtering is applied; use is subject to the Terms of Service.",
    modalities: { input: ["text"], output: ["text"] },
    context_length: 32768,
    max_output_length: 32768,
    pricing: { unit: "per_million_tokens", prompt_usd: 0.3, completion_usd: 1.0 },
    billing_note: null,
    ready: true,
    uptime: null,
  },
  {
    id: "qwen3-vl-30b",
    name: "Qwen3-VL 30B",
    description: "Qwen3-VL-30B-A3B-Instruct (Apache 2.0, FP8) vision-language model. Same /v1/chat/completions as the text models, with image_url content parts; up to 4 images per prompt.",
    modalities: { input: ["text", "image"], output: ["text"] },
    context_length: 32768,
    max_output_length: 4096,
    pricing: { unit: "per_million_tokens", prompt_usd: 0.3, completion_usd: 1.2 },
    billing_note: null,
    ready: true,
    uptime: null,
  },
  {
    id: "flux-schnell",
    name: "Flux Schnell",
    description: "FLUX.1-schnell text-to-image (Apache 2.0), 4-step diffusion.",
    modalities: { input: ["text"], output: ["image"] },
    context_length: 512,
    max_output_length: 0,
    pricing: { unit: "per_million_tokens", prompt_usd: 0.0, completion_usd: 10.0 },
    billing_note: IMAGE_BILLING_NOTE,
    ready: true,
    uptime: null,
  },
  {
    id: "chroma1-hd",
    name: "Chroma1 HD",
    description: "Chroma1-HD text-to-image (Apache 2.0), de-distilled from FLUX.1-schnell. Takes real classifier-free guidance, so negative_prompt and guidance_scale steer it.",
    modalities: { input: ["text"], output: ["image"] },
    context_length: 512,
    max_output_length: 0,
    pricing: { unit: "per_million_tokens", prompt_usd: 0.0, completion_usd: 10.0 },
    billing_note: IMAGE_BILLING_NOTE,
    ready: true,
    uptime: null,
  },
  {
    id: "whisper-large-v3",
    name: "Whisper Large v3",
    description: "Whisper large-v3 speech-to-text via /v1/audio/transcriptions (multipart upload). Mandarin output is converted to Taiwanese traditional orthography.",
    modalities: { input: ["audio"], output: ["text"] },
    context_length: 0,
    max_output_length: 0,
    pricing: { unit: "per_million_tokens", prompt_usd: 0.0, completion_usd: 3.33 },
    billing_note: AUDIO_BILLING_NOTE,
    ready: true,
    uptime: null,
  },
  {
    id: "indextts2",
    name: "IndexTTS2",
    description: "IndexTTS-2 text-to-speech via /v1/audio/speech. Speaker and emotion are separate inputs, so one cloned voice can be gentle or excited on demand.",
    modalities: { input: ["text"], output: ["audio"] },
    context_length: 2000,
    max_output_length: 0,
    pricing: { unit: "per_million_tokens", prompt_usd: 0.0, completion_usd: 10.0 },
    billing_note: AUDIO_BILLING_NOTE,
    ready: true,
    uptime: null,
  },
  {
    id: "bge-m3",
    name: "BGE-M3",
    description: "BGE-M3 multilingual embedding model (1024-dim) served on the Thailand B300 fleet.",
    modalities: { input: ["text"], output: ["embedding"] },
    context_length: 8192,
    max_output_length: 0,
    pricing: { unit: "per_million_tokens", prompt_usd: 0.02, completion_usd: 0.0 },
    billing_note: null,
    ready: true,
    uptime: null,
  },
  {
    id: "bge-reranker-v2-m3",
    name: "BGE Reranker v2-m3",
    description: "BGE-reranker-v2-m3 cross-encoder reranking, served on the Thailand B300 fleet. Billed per input token like embeddings.",
    modalities: { input: ["text"], output: ["score"] },
    context_length: 8192,
    max_output_length: 0,
    pricing: { unit: "per_million_tokens", prompt_usd: 0.02, completion_usd: 0.0 },
    billing_note: null,
    ready: true,
    uptime: null,
  },
];
// catalog-snapshot:end

function isCatalogPayload(value: unknown): value is CatalogPayload {
  if (typeof value !== "object" || value === null) return false;
  const models = (value as { models?: unknown }).models;
  return Array.isArray(models) && models.length > 0;
}

/**
 * Read the gateway catalogue, or the snapshot if the gateway cannot answer.
 *
 * Never rejects: the marketing site must render a price list during a gateway
 * outage, and — during the staged rollout — before /catalog.json exists at all.
 * Callers branch on `source` to decide whether to show the snapshot notice.
 */
export async function fetchCatalog(): Promise<CatalogResult> {
  try {
    const response = await fetch(`${GATEWAY_ORIGIN}/catalog.json`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      throw new Error(`gateway catalog ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!isCatalogPayload(payload)) {
      throw new Error("gateway catalog payload has no models");
    }
    return {
      source: "live",
      updated: payload.updated || CATALOG_SNAPSHOT_DATE,
      models: payload.models,
    };
  } catch {
    return {
      source: "snapshot",
      updated: CATALOG_SNAPSHOT_DATE,
      models: CATALOG_SNAPSHOT,
    };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/catalog.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the whole suite to confirm nothing regressed**

Run: `npx vitest run`
Expected: 149 passed (140 baseline + 9 new).

- [ ] **Step 7: Commit**

```bash
git add lib/catalog.ts lib/gateway-status.ts tests/catalog.test.ts
git commit -m "feat(catalog): read the gateway model catalogue with a snapshot fallback"
```

---

## Task 2: Split `lib/models.ts` into presentation metadata plus a merge function

**Files:**
- Modify: `lib/models.ts:1-271` (whole file rewritten)
- Modify: `tests/unit.test.ts:1-14`
- Modify: `tests/content-foundation.test.ts:6, 70-94`

**Interfaces:**
- Consumes from Task 1: `CatalogModel`, `CATALOG_SNAPSHOT` from `../lib/catalog`.
- Produces, relied on by Tasks 3, 4, 7:
  - `type ModelCategory` — unchanged union (`"all" | "coding" | "reasoning" | "general" | "multilingual" | "vision" | "image" | "audio" | "embedding"`)
  - `type ModelFeatures = { tools: boolean; structuredOutput: boolean; reasoning: boolean; streaming: boolean }` — unchanged
  - `type BillingUnit = "token" | "image" | "audio-minute"`
  - `type ModelPresentation` (see code)
  - `type ModelDefinition` — the old shape plus `description`, `billingUnit`, `unitPrice`, `billingNote`, `uptime`, `notice`
  - `const MODEL_PRESENTATION: Record<string, ModelPresentation>`
  - `function mergeCatalog(models: CatalogModel[], presentation?: Record<string, ModelPresentation>): ModelDefinition[]`
  - `function formatContextLength(length: number | null): string`
  - `function billingUnitFor(model: CatalogModel): BillingUnit`
  - `function unitPriceFor(model: CatalogModel, unit: BillingUnit): number | null`
  - `const SNAPSHOT_CATALOG: ModelDefinition[]` — `mergeCatalog(CATALOG_SNAPSHOT)`, the value every test renders with
  - `function filterModels(models: ModelDefinition[], query: string, category: ModelCategory): ModelDefinition[]` — unchanged
  - **`MODEL_CATALOG` no longer exists.**

- [ ] **Step 1: Write the failing test**

Replace the whole of `tests/unit.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { CATALOG_SNAPSHOT, type CatalogModel } from "../lib/catalog";
import {
  MODEL_PRESENTATION,
  SNAPSHOT_CATALOG,
  billingUnitFor,
  filterModels,
  formatContextLength,
  mergeCatalog,
  unitPriceFor,
} from "../lib/models";
import { CREDIT_PACKS, calculateUsageCost } from "../lib/pricing";

function catalogModel(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: "test-model",
    name: "Test Model",
    description: "A model used only by this test.",
    modalities: { input: ["text"], output: ["text"] },
    context_length: 16384,
    max_output_length: 2048,
    pricing: { unit: "per_million_tokens", prompt_usd: 1, completion_usd: 2 },
    billing_note: null,
    ready: true,
    uptime: null,
    ...overrides,
  };
}

describe("formatContextLength", () => {
  it("renders thousands of tokens and an em dash for non-context models", () => {
    expect(formatContextLength(131072)).toBe("131K");
    expect(formatContextLength(32768)).toBe("33K");
    expect(formatContextLength(8192)).toBe("8K");
    expect(formatContextLength(512)).toBe("—");
    expect(formatContextLength(0)).toBe("—");
    expect(formatContextLength(null)).toBe("—");
  });
});

describe("billing units", () => {
  it("classifies image, audio and token models from their modalities", () => {
    expect(billingUnitFor(catalogModel({ modalities: { input: ["text"], output: ["image"] } }))).toBe("image");
    expect(billingUnitFor(catalogModel({ modalities: { input: ["audio"], output: ["text"] } }))).toBe("audio-minute");
    expect(billingUnitFor(catalogModel({ modalities: { input: ["text"], output: ["audio"] } }))).toBe("audio-minute");
    expect(billingUnitFor(catalogModel())).toBe("token");
  });

  it("converts the 1000-token equivalent meter into the displayed unit", () => {
    const image = catalogModel({
      modalities: { input: ["text"], output: ["image"] },
      pricing: { unit: "per_million_tokens", prompt_usd: 0, completion_usd: 10 },
    });
    expect(unitPriceFor(image, "image")).toBeCloseTo(0.01, 6);

    const audio = catalogModel({
      modalities: { input: ["text"], output: ["audio"] },
      pricing: { unit: "per_million_tokens", prompt_usd: 0, completion_usd: 10 },
    });
    expect(unitPriceFor(audio, "audio-minute")).toBeCloseTo(0.03, 6);

    expect(unitPriceFor(catalogModel(), "token")).toBeNull();
  });
});

describe("mergeCatalog", () => {
  it("renders only gateway models, never presentation-only entries", () => {
    const merged = mergeCatalog([catalogModel({ id: "glm-5.2-fp8", name: "ignored" })]);
    expect(merged.map((model) => model.id)).toEqual(["glm-5.2-fp8"]);
    // The presentation name wins over whatever the gateway calls it.
    expect(merged[0].name).toBe("GLM 5.2 FP8");
  });

  it("takes availability, price and context from the gateway", () => {
    const merged = mergeCatalog([
      catalogModel({ id: "glm-5.2-fp8", ready: false, context_length: 65536, uptime: 0.97 }),
    ]);
    expect(merged[0].available).toBe(false);
    expect(merged[0].context).toBe("66K");
    expect(merged[0].uptime).toBe(0.97);
    expect(merged[0].inputPerMillion).toBe(1);
    expect(merged[0].outputPerMillion).toBe(2);
  });

  it("gives an unknown model a safe default presentation instead of throwing", () => {
    const merged = mergeCatalog([
      catalogModel({ id: "brand-new-model", description: "Something the site has never seen." }),
    ]);
    expect(merged[0].name).toBe("Test Model");
    expect(merged[0].categories).toEqual(["general"]);
    expect(merged[0].speed).toBe("Balanced");
    expect(merged[0].features).toEqual({
      tools: false,
      structuredOutput: false,
      reasoning: false,
      streaming: false,
    });
    expect(merged[0].tagline.en).toBe("Something the site has never seen.");
    expect(merged[0].tagline.zh).toBe("Something the site has never seen.");
    expect(merged[0].notice).toBeNull();
    expect(merged[0].region).toBeNull();
  });

  it("defaults an unknown image model into the image category", () => {
    const merged = mergeCatalog([
      catalogModel({ id: "unknown-image", modalities: { input: ["text"], output: ["image"] } }),
    ]);
    expect(merged[0].categories).toEqual(["image"]);
    expect(merged[0].billingUnit).toBe("image");
  });

  it("defaults an unknown embedding model into the embedding category", () => {
    const merged = mergeCatalog([
      catalogModel({ id: "unknown-embed", modalities: { input: ["text"], output: ["embedding"] } }),
    ]);
    expect(merged[0].categories).toEqual(["embedding"]);
  });
});

describe("SNAPSHOT_CATALOG", () => {
  it("covers every snapshot id with a presentation entry", () => {
    for (const model of CATALOG_SNAPSHOT) {
      expect(MODEL_PRESENTATION[model.id], `no presentation for ${model.id}`).toBeTruthy();
    }
    expect(SNAPSHOT_CATALOG).toHaveLength(CATALOG_SNAPSHOT.length);
  });

  it("publishes the uncensored model with a usage notice in both locales", () => {
    const model = SNAPSHOT_CATALOG.find((entry) => entry.id === "glm-5.3-flash-uncensored");
    expect(model).toBeDefined();
    expect(model!.notice?.en).toBe("No content filtering; you are responsible for compliant use.");
    expect(model!.notice?.zh).toBe("不套用內容過濾；合規使用由你負責。");
    expect(model!.inputPerMillion).toBe(0.3);
    expect(model!.outputPerMillion).toBe(1.0);
    expect(model!.context).toBe("33K");
  });

  it("keeps the published media unit prices unchanged", () => {
    const byId = Object.fromEntries(SNAPSHOT_CATALOG.map((model) => [model.id, model]));
    expect(byId["flux-schnell"].unitPrice!.toFixed(2)).toBe("0.01");
    expect(byId["chroma1-hd"].unitPrice!.toFixed(2)).toBe("0.01");
    expect(byId["whisper-large-v3"].unitPrice!.toFixed(2)).toBe("0.01");
    expect(byId["indextts2"].unitPrice!.toFixed(2)).toBe("0.03");
  });
});

describe("model catalog", () => {
  it("filters by category and query together", () => {
    const result = filterModels(SNAPSHOT_CATALOG, "glm-5.2", "coding");
    expect(result.map((model) => model.id)).toEqual(["glm-5.2-fp8"]);
  });

  it("returns no rows when no model matches", () => {
    expect(filterModels(SNAPSHOT_CATALOG, "not-a-model", "all")).toEqual([]);
  });
});

describe("pricing", () => {
  it("calculates input and output cost per million tokens", () => {
    expect(
      calculateUsageCost(1_000_000, 500_000, {
        inputPerMillion: 0.18,
        outputPerMillion: 0.72,
      }),
    ).toBeCloseTo(0.54, 6);
  });

  it("rejects invalid token amounts", () => {
    expect(() =>
      calculateUsageCost(-1, 0, {
        inputPerMillion: 0.18,
        outputPerMillion: 0.72,
      }),
    ).toThrow(RangeError);
  });

  it("keeps the approved credit-pack economics", () => {
    expect(CREDIT_PACKS.map(({ id, price, credit }) => ({ id, price, credit })))
      .toEqual([
        { id: "starter", price: 10, credit: 10 },
        { id: "builder", price: 50, credit: 52.5 },
        { id: "scale", price: 200, credit: 224 },
      ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit.test.ts`
Expected: FAIL — `MODEL_PRESENTATION`, `SNAPSHOT_CATALOG`, `mergeCatalog`, `formatContextLength`, `billingUnitFor`, `unitPriceFor` are not exported by `lib/models.ts`.

- [ ] **Step 3: Rewrite `lib/models.ts`**

Replace the entire file with:

```ts
/**
 * Presentation metadata for the model catalogue.
 *
 * What a model *is* — price, context, availability — comes from the gateway
 * (lib/catalog.ts). What a model *looks like* on this site — which filter
 * chips it answers to, how fast we call it, what the card says in Chinese —
 * lives here, keyed by model id. mergeCatalog() joins the two.
 *
 * A model the gateway serves but this file has never heard of still renders,
 * from a derived default. A model in this file that the gateway does not serve
 * does not render at all — that direction is how stale entries used to leak
 * onto the price list.
 */
import { CATALOG_SNAPSHOT, type CatalogModel } from "./catalog";

export type ModelCategory =
  | "all"
  | "coding"
  | "reasoning"
  | "general"
  | "multilingual"
  | "vision"
  | "image"
  | "audio"
  | "embedding";

export type ModelFeatures = {
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  streaming: boolean;
};

/** The unit a price is shown in — not the unit the meter bills in. */
export type BillingUnit = "token" | "image" | "audio-minute";

export type ModelProvenance = {
  status: "review-required" | "live";
  label: Record<"en" | "zh", string>;
  licenseHref: string | null;
};

export type ModelPresentation = {
  /** Display name, overriding whatever the gateway calls the model. */
  name: string;
  categories: Exclude<ModelCategory, "all">[];
  speed: "Fast" | "Balanced" | "Deep";
  tagline: Record<"en" | "zh", string>;
  servingRole: Record<"en" | "zh", string>;
  /** Human-readable output ceiling; omit to derive from max_output_length. */
  maxOutput?: string;
  features: ModelFeatures;
  provenance: ModelProvenance;
  region: string | null;
  /** Rendered on the card when a model needs a caveat before it is used. */
  notice?: Record<"en" | "zh", string>;
};

export type ModelDefinition = {
  id: string;
  name: string;
  modelId: string;
  description: string;
  categories: Exclude<ModelCategory, "all">[];
  context: string;
  speed: "Fast" | "Balanced" | "Deep";
  inputPerMillion: number;
  outputPerMillion: number;
  billingUnit: BillingUnit;
  /** Price in the displayed unit (per image / per audio minute), else null. */
  unitPrice: number | null;
  billingNote: string | null;
  available: boolean;
  uptime: number | null;
  tagline: Record<"en" | "zh", string>;
  maxOutput: string;
  features: ModelFeatures;
  provenance: ModelProvenance;
  servingRole: Record<"en" | "zh", string>;
  region: string | null;
  notice: Record<"en" | "zh", string> | null;
};

const LIVE_PROVENANCE: ModelProvenance = {
  status: "live",
  label: { en: "Live", zh: "已上線" },
  licenseHref: null,
};

export const MODEL_PRESENTATION: Record<string, ModelPresentation> = {
  "glm-5.2-fp8": {
    name: "GLM 5.2 FP8",
    categories: ["reasoning", "multilingual", "coding"],
    speed: "Fast",
    tagline: {
      en: "Frontier bilingual reasoning model with extended thinking.",
      zh: "前沿雙語推理模型，支援延伸思考鏈。",
    },
    servingRole: {
      en: "Primary LLM for chat, reasoning, and coding workloads.",
      zh: "主力 LLM，用於對話、推理與程式開發。",
    },
    features: { tools: true, structuredOutput: true, reasoning: true, streaming: true },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "glm-5.3-flash-uncensored": {
    name: "GLM 5.3 Flash Uncensored",
    categories: ["general", "reasoning"],
    speed: "Fast",
    tagline: {
      en: "GLM-5.3 Flash community fine-tune with safety refusals removed.",
      zh: "GLM-5.3 Flash 社群微調版本，已移除安全性拒答。",
    },
    servingRole: {
      en: "Research, red-teaming, and creative work where refusals get in the way.",
      zh: "用於研究、紅隊測試與創作場景——拒答會妨礙工作的情境。",
    },
    features: { tools: true, structuredOutput: false, reasoning: true, streaming: true },
    provenance: LIVE_PROVENANCE,
    region: "TH",
    notice: {
      en: "No content filtering; you are responsible for compliant use.",
      zh: "不套用內容過濾；合規使用由你負責。",
    },
  },
  "qwen3-vl-30b": {
    name: "Qwen3-VL 30B",
    categories: ["vision", "multilingual", "general"],
    speed: "Fast",
    tagline: {
      en: "Multimodal vision-language model for OCR, charts, and images.",
      zh: "多模態視覺語言模型，支援 OCR、圖表與圖片理解。",
    },
    servingRole: {
      en: "Vision and OCR inference for document and image understanding.",
      zh: "視覺與 OCR 推理，用於文件與圖片理解。",
    },
    features: { tools: true, structuredOutput: true, reasoning: false, streaming: true },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "flux-schnell": {
    name: "Flux Schnell",
    categories: ["image"],
    speed: "Fast",
    tagline: {
      en: "Ultra-fast text-to-image generation, 4-step diffusion.",
      zh: "超快文生圖，4 步擴散生成。",
    },
    servingRole: {
      en: "Text-to-image generation for marketing and creative use.",
      zh: "文生圖生成，用於行銷與創意場景。",
    },
    maxOutput: "1 image",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "chroma1-hd": {
    name: "Chroma1 HD",
    categories: ["image"],
    speed: "Balanced",
    tagline: {
      en: "High-definition image generation with fine detail.",
      zh: "高畫質圖像生成，細節豐富。",
    },
    servingRole: {
      en: "Premium HD image generation for high-quality output.",
      zh: "高品質 HD 圖像生成。",
    },
    maxOutput: "1 image",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "whisper-large-v3": {
    name: "Whisper Large v3",
    categories: ["audio"],
    speed: "Fast",
    tagline: {
      en: "State-of-the-art speech-to-text transcription.",
      zh: "頂級語音轉文字辨識。",
    },
    servingRole: {
      en: "Audio transcription and subtitle generation.",
      zh: "音訊轉錄與字幕生成。",
    },
    maxOutput: "transcript",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  indextts2: {
    name: "IndexTTS2",
    categories: ["audio"],
    speed: "Fast",
    tagline: {
      en: "Voice cloning and text-to-speech with reference audio.",
      zh: "語音克隆與文字轉語音，需參考音檔。",
    },
    servingRole: {
      en: "Text-to-speech with voice cloning capabilities.",
      zh: "文字轉語音與語音克隆。",
    },
    maxOutput: "audio",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "bge-m3": {
    name: "BGE-M3",
    categories: ["embedding", "multilingual"],
    speed: "Fast",
    tagline: {
      en: "Multilingual embedding model for semantic search.",
      zh: "多語言嵌入模型，用於語意搜尋。",
    },
    servingRole: {
      en: "Embedding generation for RAG and semantic search.",
      zh: "嵌入向量生成，用於 RAG 與語意搜尋。",
    },
    maxOutput: "vector",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
  "bge-reranker-v2-m3": {
    name: "BGE Reranker v2-m3",
    categories: ["embedding"],
    speed: "Fast",
    tagline: {
      en: "Cross-encoder reranker for precision retrieval.",
      zh: "交叉編碼重排器，用於精確檢索。",
    },
    servingRole: {
      en: "Document reranking for retrieval-augmented generation.",
      zh: "文件重排，用於檢索增強生成。",
    },
    maxOutput: "scores",
    features: { tools: false, structuredOutput: false, reasoning: false, streaming: false },
    provenance: LIVE_PROVENANCE,
    region: "TH",
  },
};

/**
 * Context windows are shown in thousands of tokens. Image and speech models
 * report a resolution or a zero in this field rather than a context window,
 * so anything under 1K is shown as an em dash instead of a misleading number.
 */
export function formatContextLength(length: number | null): string {
  if (!length || length < 1000) return "—";
  return `${Math.round(length / 1000)}K`;
}

export function billingUnitFor(model: CatalogModel): BillingUnit {
  if (model.modalities.output.includes("image")) return "image";
  if (model.modalities.output.includes("audio") || model.modalities.input.includes("audio")) {
    return "audio-minute";
  }
  return "token";
}

/**
 * The gateway meters media as a 1000-token equivalent — per image, or per 20
 * seconds of audio. Turn that into the unit the site quotes.
 */
export function unitPriceFor(model: CatalogModel, unit: BillingUnit): number | null {
  const perThousandTokens = model.pricing.completion_usd / 1000;
  if (unit === "image") return perThousandTokens;
  if (unit === "audio-minute") return perThousandTokens * 3;
  return null;
}

const EMBEDDING_OUTPUTS = new Set(["embedding", "vector", "score", "scores", "rerank"]);

function defaultCategories(model: CatalogModel, unit: BillingUnit): Exclude<ModelCategory, "all">[] {
  if (unit === "image") return ["image"];
  if (unit === "audio-minute") return ["audio"];
  if (model.modalities.output.some((output) => EMBEDDING_OUTPUTS.has(output))) return ["embedding"];
  return ["general"];
}

function defaultMaxOutput(model: CatalogModel): string {
  const length = model.max_output_length;
  if (!length) return "—";
  return length >= 1000 ? `${Math.round(length / 1000)}K` : String(length);
}

/**
 * Join gateway facts with site presentation. Iteration is over the gateway
 * list, so the site can never advertise a model the gateway is not serving.
 */
export function mergeCatalog(
  models: CatalogModel[],
  presentation: Record<string, ModelPresentation> = MODEL_PRESENTATION,
): ModelDefinition[] {
  return models.map((model) => {
    const meta = presentation[model.id];
    const billingUnit = billingUnitFor(model);
    const fallbackCopy = { en: model.description, zh: model.description };
    return {
      id: model.id,
      name: meta?.name ?? model.name,
      modelId: model.id,
      description: model.description,
      categories: meta?.categories ?? defaultCategories(model, billingUnit),
      context: formatContextLength(model.context_length),
      speed: meta?.speed ?? "Balanced",
      inputPerMillion: model.pricing.prompt_usd,
      outputPerMillion: model.pricing.completion_usd,
      billingUnit,
      unitPrice: unitPriceFor(model, billingUnit),
      billingNote: model.billing_note,
      available: model.ready,
      uptime: model.uptime,
      tagline: meta?.tagline ?? fallbackCopy,
      maxOutput: meta?.maxOutput ?? defaultMaxOutput(model),
      features: meta?.features ?? {
        tools: false,
        structuredOutput: false,
        reasoning: false,
        streaming: false,
      },
      provenance: meta?.provenance ?? LIVE_PROVENANCE,
      servingRole: meta?.servingRole ?? fallbackCopy,
      region: meta?.region ?? null,
      notice: meta?.notice ?? null,
    };
  });
}

/**
 * The catalogue rendered when the gateway cannot be reached. Pages that show
 * this must also show the snapshot notice, so a reader is never told a stale
 * availability flag is live.
 */
export const SNAPSHOT_CATALOG: ModelDefinition[] = mergeCatalog(CATALOG_SNAPSHOT);

export function filterModels(
  models: ModelDefinition[],
  query: string,
  category: ModelCategory,
): ModelDefinition[] {
  const normalized = query.trim().toLowerCase();
  return models.filter((model) => {
    const categoryMatches = category === "all" || model.categories.includes(category as Exclude<ModelCategory, "all">);
    const queryMatches = !normalized || `${model.name} ${model.modelId}`.toLowerCase().includes(normalized);
    return categoryMatches && queryMatches;
  });
}
```

- [ ] **Step 4: Run the new unit test**

Run: `npx vitest run tests/unit.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Update `tests/content-foundation.test.ts` for the new shape**

Change the import on line 6 from `import { MODEL_CATALOG } from "../lib/models";` to:

```ts
import { SNAPSHOT_CATALOG } from "../lib/models";
```

Replace the two catalogue tests (currently `tests/content-foundation.test.ts:70-94`) with:

```ts
  it("publishes complete decision fields with live provenance", () => {
    for (const model of SNAPSHOT_CATALOG) {
      expect(model.maxOutput).toBeTruthy();
      expect(model.features).toEqual({
        tools: expect.any(Boolean),
        structuredOutput: expect.any(Boolean),
        reasoning: expect.any(Boolean),
        streaming: expect.any(Boolean),
      });
      expect(model.provenance.status).toBe("live");
      expect(model.provenance.label.en).toBe("Live");
      expect(model.provenance.label.zh).toBe("已上線");
      expect(model.servingRole.en).toBeTruthy();
      expect(model.servingRole.zh).toBeTruthy();
      expect(model.tagline.en).toBeTruthy();
      expect(model.tagline.zh).toBeTruthy();
      expect(model.region).toBeTruthy();
    }
  });

  it("quotes a positive price in whichever unit the model is billed in", () => {
    for (const model of SNAPSHOT_CATALOG) {
      if (model.billingUnit === "token") {
        expect(model.inputPerMillion, model.id).toBeGreaterThan(0);
        expect(model.outputPerMillion, model.id).toBeGreaterThanOrEqual(0);
        expect(model.unitPrice, model.id).toBeNull();
      } else {
        expect(model.unitPrice, model.id).toBeGreaterThan(0);
        expect(model.billingNote, model.id).toBeTruthy();
      }
    }
  });

  it("keeps the snapshot catalog marked available and self-identifying", () => {
    for (const model of SNAPSHOT_CATALOG) {
      expect(model.available).toBe(true);
      expect(model.modelId).toBe(model.id);
    }
  });
```

- [ ] **Step 6: Run the two affected test files**

Run: `npx vitest run tests/unit.test.ts tests/content-foundation.test.ts`
Expected: PASS. `tests/content-foundation.test.ts` now has one extra test (the split of the price assertion).


- [ ] **Step 7: Point the five consuming components at `SNAPSHOT_CATALOG`**

The components keep reading a module-level array in this task — Task 3 lifts the data into the pages. Only the *shape* changes here.

`components/model-marketplace.tsx` — replace the import block at lines 4-9 and delete `getBillingMode` (lines 28-32):

```tsx
import {
  SNAPSHOT_CATALOG,
  filterModels,
  type ModelCategory,
  type ModelDefinition,
} from "../lib/models";
```

Replace line 39 with:

```tsx
  const models = filterModels(SNAPSHOT_CATALOG, query, category);
```

Replace the whole rate-rendering IIFE (currently lines 126-162) with one that reads `model.billingUnit` and `model.unitPrice`:

```tsx
                {(() => {
                  if (model.billingUnit !== "token" && model.unitPrice !== null) {
                    const unitLabel = model.billingUnit === "image"
                      ? copy.shared.perImage
                      : copy.shared.perMinute;
                    return (
                      <>
                        <dl className="marketplace-summary-fact">
                          <dt>{copy.models.input}</dt>
                          <dd>{formatRate(model.unitPrice)} <span className="marketplace-rate-unit">{unitLabel}</span></dd>
                        </dl>
                        <dl className="marketplace-summary-fact marketplace-summary-fact-placeholder" aria-hidden="true"><dt> </dt><dd> </dd></dl>
                      </>
                    );
                  }
                  return (
                    <>
                      <dl className="marketplace-summary-fact">
                        <dt>{copy.models.input}</dt>
                        <dd>{formatRate(model.inputPerMillion)} <span className="marketplace-rate-unit">{copy.shared.perMillionInput}</span></dd>
                      </dl>
                      <dl className="marketplace-summary-fact">
                        <dt>{copy.models.output}</dt>
                        <dd>{formatRate(model.outputPerMillion)} <span className="marketplace-rate-unit">{copy.shared.perMillionOutput}</span></dd>
                      </dl>
                    </>
                  );
                })()}
```

Render the per-model notice directly after the tagline paragraph (currently line 120), inside `.marketplace-identity`:

```tsx
                  <p className="marketplace-tagline">{model.servingRole[locale]}</p>
                  {model.notice ? (
                    <p className="marketplace-model-notice">{model.notice[locale]}</p>
                  ) : null}
```

`components/pricing-page-content.tsx` — change line 3 to `import { SNAPSHOT_CATALOG } from "../lib/models";` and replace the table body (currently lines 113-133) with:

```tsx
              {SNAPSHOT_CATALOG.map((model) => (
                <tr className="rate-table-row" key={model.id}>
                  <td>{model.name}</td>
                  {model.billingUnit !== "token" && model.unitPrice !== null ? (
                    <td colSpan={2}>
                      <strong>{formatRate(model.unitPrice)}</strong>{" "}
                      {model.billingUnit === "audio-minute"
                        ? (locale === "en" ? "per minute of audio" : "每分鐘音訊")
                        : (locale === "en" ? "per image" : "每張圖片")}
                    </td>
                  ) : (
                    <>
                      <td><strong>{formatRate(model.inputPerMillion)}</strong> {copy.shared.perMillionInput}</td>
                      <td><strong>{formatRate(model.outputPerMillion)}</strong> {copy.shared.perMillionOutput}</td>
                    </>
                  )}
                </tr>
              ))}
```

`components/pricing-calculator.tsx` — change line 4 to `import { SNAPSHOT_CATALOG } from "../lib/models";`, replace `MODEL_CATALOG` on lines 25, 28, 63 and 111 with `SNAPSHOT_CATALOG`, and replace the billing-mode block (lines 30-46) with:

```tsx
  // Media models bill per image / per minute of audio, not per token —
  // a token-pair estimator would be meaningless for them.
  const isTokenBilled = model.billingUnit === "token";

  const inputAmount = parseTokenAmount(inputTokens);
  const outputAmount = parseTokenAmount(outputTokens);
  const isInvalid = inputAmount === null || outputAmount === null;
  const estimate = isInvalid
    ? null
    : calculateUsageCost(inputAmount, outputAmount, {
      inputPerMillion: model.inputPerMillion,
      outputPerMillion: model.outputPerMillion,
    });

  const mediaUnit = model.billingUnit === "audio-minute"
    ? (locale === "en" ? "minute of audio" : "分鐘音訊")
    : (locale === "en" ? "image" : "張圖片");
  const mediaPrice = currencyFormatter.format(model.unitPrice ?? 0);
  const mediaNote = locale === "en"
    ? `${model.name} is billed per ${mediaUnit} at ${mediaPrice} each — see the rates table below.`
    : `${model.name} 以每${mediaUnit}計費，單價 ${mediaPrice} — 見下方費率表。`;
```

`components/home-content.tsx` — change line 4 to `import { SNAPSHOT_CATALOG } from "../lib/models";` and replace lines 14-19 with:

```tsx
  // The proof strip counts what is actually serving right now, and quotes the
  // cheapest *token* rate — media models bill per image/minute, so folding
  // their zero prompt price in would advertise "$0.00".
  const models = SNAPSHOT_CATALOG;
  const activeRoutes = models.filter((model) => model.available).length;
  const maxContext = models.reduce((max, model) => {
    const parsed = Number.parseInt(model.context, 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  const tokenRates = models
    .filter((model) => model.billingUnit === "token")
    .map((model) => model.inputPerMillion);
  const startingRate = tokenRates.length > 0 ? Math.min(...tokenRates) : 0;
```

Replace the proof strip's first item (line 89) with:

```tsx
        <div className="proof-item"><strong>{activeRoutes}</strong><span>{text.catalogEntries}</span></div>
```

Replace the model-list map (lines 101-118) with:

```tsx
          {models.map((model, index) => (
            <article aria-label={model.name} className={`model-row model-row-${model.id}`} key={model.id}>
              <span aria-hidden="true" className="model-rail" />
              <div className="model-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="model-identity"><h3>{model.name}</h3><p>{model.servingRole[locale]}</p></div>
              <dl className="model-facts">
                <div><dt>{copy.models.context}</dt><dd>{model.context}</dd></div>
                <div><dt>{copy.models.maxOutput}</dt><dd>{model.maxOutput}</dd></div>
                {model.billingUnit !== "token" && model.unitPrice !== null ? (
                  <div><dt>{text.price}</dt><dd>{`$${model.unitPrice.toFixed(2)} ${model.billingUnit === "audio-minute" ? (locale === "en" ? "per minute of audio" : "每分鐘音訊") : (locale === "en" ? "per image" : "每張圖片")}`}</dd></div>
                ) : (
                  <div><dt>{text.price}</dt><dd>{`$${model.inputPerMillion.toFixed(2)} ${copy.shared.perMillionInput}`}</dd><dd>{`$${model.outputPerMillion.toFixed(2)} ${copy.shared.perMillionOutput}`}</dd></div>
                )}
                <div><dt>{text.provenance}</dt><dd>{model.provenance.label[locale]}</dd></div>
                <div><dt>{text.release}</dt><dd>{model.available ? copy.models.available : copy.models.unavailable}</dd></div>
              </dl>
            </article>
          ))}
```

`components/docs-page-content.tsx` — change line 3 to `import { SNAPSHOT_CATALOG } from "../lib/models";`, then replace `(typeof MODEL_CATALOG)[number]` on line 16 with `ModelDefinition` (adding `type ModelDefinition` to that same import), and replace `MODEL_CATALOG` on lines 37, 39 and 40 with `SNAPSHOT_CATALOG`:

```tsx
import { SNAPSHOT_CATALOG, type ModelDefinition } from "../lib/models";
```

```tsx
export function modelFeatureGateState(
  inference: ReadinessState,
  models: ReadonlyArray<Pick<ModelDefinition, "available" | "features">>,
  feature: ModelFeatureGate,
): ReadinessState {
```

- [ ] **Step 8: Add the notice style**

Append to `app/globals.css`:

```css
.marketplace-model-notice { grid-column: 1 / -1; margin: .45rem 0 0; padding: .35rem .6rem; border-left: 2px solid var(--cyan); color: var(--muted); font-size: .8125rem; line-height: 1.5; }
```

- [ ] **Step 9: Update `tests/marketplace.test.tsx` for the new units**

Change the import on line 9 to `import { SNAPSHOT_CATALOG } from "../lib/models";` and replace the whole "renders exact input and output units for every catalog model" test (currently lines 73-92) with:

```tsx
  it("renders exact input and output units for every catalog model", () => {
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);

    for (const model of SNAPSHOT_CATALOG) {
      const row = screen.getByRole("article", { name: model.name });

      expect(within(row).getByText(model.context)).toBeVisible();

      if (model.billingUnit === "image") {
        const inputRate = `$${model.unitPrice!.toFixed(2)} per image`;
        expect(within(row).getByText((_, element) => normalizedText(element!) === inputRate)).toBeVisible();
      } else if (model.billingUnit === "audio-minute") {
        const inputRate = `$${model.unitPrice!.toFixed(2)} per minute of audio`;
        expect(within(row).getByText((_, element) => normalizedText(element!) === inputRate)).toBeVisible();
      } else {
        const inputRate = `$${model.inputPerMillion.toFixed(2)} per 1M input`;
        const outputRate = `$${model.outputPerMillion.toFixed(2)} per 1M output`;
        expect(within(row).getByText((_, element) => normalizedText(element!) === inputRate)).toBeVisible();
        expect(within(row).getByText((_, element) => normalizedText(element!) === outputRate)).toBeVisible();
      }
    }
  });

  it("shows the uncensored model's usage notice on its card", () => {
    render(<LocaleProvider><ModelMarketplace /></LocaleProvider>);

    const row = screen.getByRole("article", { name: "GLM 5.3 Flash Uncensored" });
    expect(within(row).getByText("No content filtering; you are responsible for compliant use.")).toBeVisible();
  });
```

Also change the expanded-details assertion for context (line ~41 area is unaffected) — but note `Qwen3-VL 30B` still expands to `4K` max output, which is unchanged.

- [ ] **Step 10: Update `tests/pricing.test.tsx` for the ninth model and the derived units**

Replace the `EXPECTED_MODEL_RATES` constant (lines 13-22) with an import-driven expectation. Change the import block to add:

```tsx
import { SNAPSHOT_CATALOG } from "../lib/models";
```

and delete `EXPECTED_MODEL_RATES` entirely, then replace the "lists every model rate with honest units" test (lines 305-330) with:

```tsx
  it("lists every model rate with honest units (per-token vs per-image/minute)", () => {
    render(
      <LocaleProvider>
        <PricingPage />
      </LocaleProvider>,
    );

    const rows = screen.getAllByRole("row").filter((candidate) => within(candidate).queryAllByRole("cell").length > 0);
    expect(rows).toHaveLength(SNAPSHOT_CATALOG.length);

    for (const model of SNAPSHOT_CATALOG) {
      const row = rows.find((candidate) => within(candidate).queryByRole("cell", { name: model.name }));
      expect(row, `no rate row for ${model.name}`).toBeDefined();

      const cells = within(row!).getAllByRole("cell");
      if (model.billingUnit === "token") {
        expect(cells).toHaveLength(3);
        expect(normalizedText(cells[1])).toBe(`$${model.inputPerMillion.toFixed(2)} per 1M input`);
        expect(normalizedText(cells[2])).toBe(`$${model.outputPerMillion.toFixed(2)} per 1M output`);
      } else {
        const unit = model.billingUnit === "audio-minute" ? "minute of audio" : "image";
        expect(cells).toHaveLength(2);
        expect(normalizedText(cells[1])).toBe(`$${model.unitPrice!.toFixed(2)} per ${unit}`);
      }
    }
  });
```

- [ ] **Step 11: Update `tests/homepage.test.tsx` for the ninth model and the corrected numbers**

Three edits.

(a) Proof strip, English (lines 32-36) — nine ready routes, and the cheapest *token* input rate is BGE's `$0.02`, not the old per-image `$0.01`:

```tsx
    const proof = screen.getByRole("region", { name: "Marketplace facts" });
    expect(within(proof).queryByText("99.98%")).not.toBeInTheDocument();
    expect(within(proof).getByText("9")).toBeVisible();
    expect(within(proof).getByText("131K")).toBeVisible();
    expect(within(proof).getByText("$0.02")).toBeVisible();
```

(b) Proof strip, Chinese (lines 120-123):

```tsx
    const proof = screen.getByRole("region", { name: "市集事實" });
    expect(within(proof).getByText("9")).toBeVisible();
    expect(within(proof).getByText("131K")).toBeVisible();
    expect(within(proof).getByText("$0.02")).toBeVisible();
```

(c) The `expectedModels` table (lines 42-51). GLM 5.2's max output becomes `32K` — `config.yaml` says `max_output_length: 32768`, so the old hard-coded `16K` was simply wrong — and the new model gets a row:

```tsx
    const expectedModels = [
      ["GLM 5.2 FP8", "$0.93 per 1M input", "$3.00 per 1M output", "131K", "32K", "Primary LLM for chat, reasoning, and coding workloads.", "主力 LLM，用於對話、推理與程式開發。"],
      ["GLM 5.3 Flash Uncensored", "$0.30 per 1M input", "$1.00 per 1M output", "33K", "33K", "Research, red-teaming, and creative work where refusals get in the way.", "用於研究、紅隊測試與創作場景——拒答會妨礙工作的情境。"],
      ["Qwen3-VL 30B", "$0.30 per 1M input", "$1.20 per 1M output", "33K", "4K", "Vision and OCR inference for document and image understanding.", "視覺與 OCR 推理，用於文件與圖片理解。"],
      ["Flux Schnell", "$0.01 per image", null, "—", "1 image", "Text-to-image generation for marketing and creative use.", "文生圖生成，用於行銷與創意場景。"],
      ["Chroma1 HD", "$0.01 per image", null, "—", "1 image", "Premium HD image generation for high-quality output.", "高品質 HD 圖像生成。"],
      ["Whisper Large v3", "$0.01 per minute of audio", null, "—", "transcript", "Audio transcription and subtitle generation.", "音訊轉錄與字幕生成。"],
      ["IndexTTS2", "$0.03 per minute of audio", null, "2K", "audio", "Text-to-speech with voice cloning capabilities.", "文字轉語音與語音克隆。"],
      ["BGE-M3", "$0.02 per 1M input", "$0.00 per 1M output", "8K", "vector", "Embedding generation for RAG and semantic search.", "嵌入向量生成，用於 RAG 與語意搜尋。"],
      ["BGE Reranker v2-m3", "$0.02 per 1M input", "$0.00 per 1M output", "8K", "scores", "Document reranking for retrieval-augmented generation.", "文件重排，用於檢索增強生成。"],
    ] as const;
```

`33K` appears twice in the GLM 5.3 row (context and max output). `getByText` would then find two nodes and throw. Change the two lookups inside the loop to use `getAllByText(...)[0]`:

```tsx
      expect(within(row).getAllByText(context)[0]).toBeVisible();
      expect(within(row).getAllByText(maxOutput)[0]).toBeVisible();
```

- [ ] **Step 12: Run the full suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: all green. Test count is 152 (140 baseline + 9 catalog + 1 content-foundation split + 1 marketplace notice + 1 unit-file net gain).
If a count differs slightly, that is fine — **zero failures** is the gate, not the number.

- [ ] **Step 13: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. In particular, no remaining reference to `MODEL_CATALOG`:
Run: `grep -rn "MODEL_CATALOG" app components lib tests scripts 2>/dev/null`
Expected: no output.

- [ ] **Step 14: Commit**

```bash
git add lib/models.ts app/globals.css components/model-marketplace.tsx components/pricing-page-content.tsx components/pricing-calculator.tsx components/home-content.tsx components/docs-page-content.tsx tests/unit.test.ts tests/content-foundation.test.ts tests/marketplace.test.tsx tests/pricing.test.tsx tests/homepage.test.tsx
git commit -m "refactor(models): split presentation metadata from the gateway catalogue"
```

---

## Task 3: Pages fetch the catalogue and pass it down, with a snapshot notice

**Files:**
- Modify: `lib/content.ts:13` (`shared` keys, both locales)
- Modify: `components/model-marketplace.tsx`, `components/models-page-content.tsx`, `components/pricing-page-content.tsx`, `components/pricing-calculator.tsx`, `components/home-content.tsx`, `components/docs-page-content.tsx` (all gain props)
- Modify: `app/page.tsx`, `app/models/page.tsx`, `app/pricing/page.tsx`, `app/docs/page.tsx`
- Modify: `app/globals.css` (one rule)
- Modify: `tests/marketplace.test.tsx`, `tests/homepage.test.tsx`, `tests/audience-paths.test.tsx`, `tests/pricing.test.tsx`, `tests/docs-console.test.tsx`, `tests/skip-link.test.tsx`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `fetchCatalog`, `CatalogResult` (Task 1); `mergeCatalog`, `SNAPSHOT_CATALOG`, `ModelDefinition` (Task 2).
- Produces:
  - `ModelMarketplace({ models }: { models: ModelDefinition[] })`
  - `ModelsPageContent({ models, snapshotDate }: { models: ModelDefinition[]; snapshotDate: string | null })`
  - `PricingPageContent({ models, snapshotDate }: { models: ModelDefinition[]; snapshotDate: string | null })`
  - `PricingCalculator({ models }: { models: ModelDefinition[] })`
  - `HomeContent({ models, snapshotDate }: { models: ModelDefinition[]; snapshotDate: string | null })`
  - `DocsPageContent({ gateway, models }: { gateway: GatewayStatus | null; models: ModelDefinition[] })`
  - copy keys `COPY[locale].shared.catalogSnapshotNotice` (contains the literal token `{date}`)
  - `snapshotDate` is `null` when the catalogue came back live, otherwise the snapshot's date string.

- [ ] **Step 1: Write the failing test**

Append to `tests/marketplace.test.tsx` (inside the existing `describe("ModelMarketplace")` block is fine, but the notice test belongs to the page, so add a new top-level block at the end of the file):

```tsx
describe("catalogue source notice", () => {
  it("warns when the models come from a snapshot", () => {
    render(
      <LocaleProvider>
        <ModelsPageContent models={SNAPSHOT_CATALOG} snapshotDate="2026-09-09" />
      </LocaleProvider>,
    );

    expect(
      screen.getByText("Catalogue shown from a snapshot taken 2026-09-09; live availability unavailable."),
    ).toBeVisible();
  });

  it("says nothing when the models are live", () => {
    render(
      <LocaleProvider>
        <ModelsPageContent models={SNAPSHOT_CATALOG} snapshotDate={null} />
      </LocaleProvider>,
    );

    expect(screen.queryByText(/snapshot taken/i)).not.toBeInTheDocument();
  });

  it("localizes the snapshot notice", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <ModelsPageContent models={SNAPSHOT_CATALOG} snapshotDate="2026-09-09" />
        </SiteShell>
      </LocaleProvider>,
    );

    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);
    expect(screen.getByText("目錄取自 2026-09-09 的快照；即時可用性目前無法取得。")).toBeVisible();
  });

  it("marks a model the gateway reports as not ready", () => {
    const unavailable = SNAPSHOT_CATALOG.map((model) =>
      model.id === "chroma1-hd" ? { ...model, available: false } : model,
    );
    render(<LocaleProvider><ModelMarketplace models={unavailable} /></LocaleProvider>);

    const row = screen.getByRole("article", { name: "Chroma1 HD" });
    expect(within(row).getByRole("button", { name: "Chroma1 HD" })).toBeInTheDocument();
    expect(row.className).toContain("marketplace-row-chroma1-hd");
  });
});
```

Add `import { ModelsPageContent } from "../components/models-page-content";` to the top of that file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/marketplace.test.tsx`
Expected: FAIL — `ModelsPageContent` does not accept `models`/`snapshotDate`, and the notice text does not exist.

- [ ] **Step 3: Add the copy keys**

In `lib/content.ts`, extend the `shared` member of `CopyDictionary` (line 13) with three keys:

```ts
  shared: { perMillionInput: string; perMillionOutput: string; perImage: string; perMinute: string; illustrative: string; temporarilyUnavailable: string; language: string; copyUnavailable: string; ready: string; preview: string; preparation: string; notReady: string; catalogSnapshotNotice: string; openApiSpec: string };
```

Then in `COPY.en.shared` (line 27), append:

```ts
catalogSnapshotNotice: "Catalogue shown from a snapshot taken {date}; live availability unavailable.", openApiSpec: "OpenAPI specification",
```

and in `COPY.zh.shared` (line 39), append:

```ts
catalogSnapshotNotice: "目錄取自 {date} 的快照；即時可用性目前無法取得。", openApiSpec: "OpenAPI 規格",
```

(`openApiSpec` is unused until Task 8; adding both keys now keeps the dictionary edited once.)

- [ ] **Step 4: Give the components their props**

`components/model-marketplace.tsx` — remove the `SNAPSHOT_CATALOG` import (keep `filterModels`, `ModelCategory`, `ModelDefinition`), change the signature and the filter line:

```tsx
export function ModelMarketplace({ models: catalog }: { models: ModelDefinition[] }) {
  const { copy, locale } = useLocale();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ModelCategory>("all");
  const [expandedId, setExpandedId] = useState<ModelDefinition["id"] | null>(null);
  const models = filterModels(catalog, query, category);
```

`components/models-page-content.tsx` — replace the whole file:

```tsx
"use client";

import type { ModelDefinition } from "../lib/models";
import { CatalogSnapshotNotice } from "./catalog-snapshot-notice";
import { ModelMarketplace } from "./model-marketplace";
import { useLocale } from "./locale-provider";

type Props = {
  models: ModelDefinition[];
  snapshotDate: string | null;
};

export function ModelsPageContent({ models, snapshotDate }: Props) {
  const { copy, locale } = useLocale();

  return (
    <main className="models-page" id="main-content">
      <section aria-labelledby="models-title" className="models-intro">
        <p className="eyebrow">{copy.models.kicker}</p>
        <h1 id="models-title">{copy.models.title}</h1>
        <p>{copy.models.lead}</p>
        <p className="models-notice">{locale === "en" ? "Live catalog — all models served by the b300 gateway." : "即時目錄——所有模型由 b300 閘道提供服務。"}</p>
        <CatalogSnapshotNotice snapshotDate={snapshotDate} />
      </section>
      <ModelMarketplace models={models} />
    </main>
  );
}
```

Create `components/catalog-snapshot-notice.tsx` — one component, used by all three pages, so the wording can never drift between them:

```tsx
"use client";

import { useLocale } from "./locale-provider";

/**
 * Says out loud that the catalogue on screen is a build-time snapshot rather
 * than the gateway's live answer. Renders nothing when the fetch succeeded —
 * silence means live.
 */
export function CatalogSnapshotNotice({ snapshotDate }: { snapshotDate: string | null }) {
  const { copy } = useLocale();
  if (!snapshotDate) return null;

  return (
    <p className="catalog-snapshot-notice" role="status">
      {copy.shared.catalogSnapshotNotice.replace("{date}", snapshotDate)}
    </p>
  );
}
```

`components/pricing-page-content.tsx` — signature and table source:

```tsx
export function PricingPageContent({ models, snapshotDate }: { models: ModelDefinition[]; snapshotDate: string | null }) {
```

Drop the `SNAPSHOT_CATALOG` import, add `import type { ModelDefinition } from "../lib/models";` and `import { CatalogSnapshotNotice } from "./catalog-snapshot-notice";`. In the intro section, after the `pricing-notice` paragraph, add `<CatalogSnapshotNotice snapshotDate={snapshotDate} />`. Change `{SNAPSHOT_CATALOG.map(` in the rate table to `{models.map(`, and change `<PricingCalculator />` to `<PricingCalculator models={models} />`.

`components/pricing-calculator.tsx` — signature and every `SNAPSHOT_CATALOG` reference:

```tsx
export function PricingCalculator({ models }: { models: ModelDefinition[] }) {
  const { copy, locale } = useLocale();
  const [modelId, setModelId] = useState(models[0].id);
  const [inputTokens, setInputTokens] = useState("0");
  const [outputTokens, setOutputTokens] = useState("0");
  const model = models.find((candidate) => candidate.id === modelId) ?? models[0];
```

and both `<select>` option maps become `{models.map((option) => (`. Replace the `SNAPSHOT_CATALOG` import with `import type { ModelDefinition } from "../lib/models";`.

`components/home-content.tsx` — signature, and delete the `const models = SNAPSHOT_CATALOG;` line added in Task 2:

```tsx
export function HomeContent({ models, snapshotDate }: { models: ModelDefinition[]; snapshotDate: string | null }) {
  const { copy, locale } = useLocale();
  const company = COMPANY_CONTENT[locale];
  const trust = TRUST_CONTENT[locale];
  // The proof strip counts what is actually serving right now, and quotes the
  // cheapest *token* rate — media models bill per image/minute, so folding
  // their zero prompt price in would advertise "$0.00".
  const activeRoutes = models.filter((model) => model.available).length;
```

Replace the `SNAPSHOT_CATALOG` import with `import type { ModelDefinition } from "../lib/models";` and add `import { CatalogSnapshotNotice } from "./catalog-snapshot-notice";`. Put the notice at the end of the proof strip section, immediately after the closing `</section>` of `.proof-strip`:

```tsx
      <CatalogSnapshotNotice snapshotDate={snapshotDate} />
```

`components/docs-page-content.tsx` — the gates read the passed catalogue:

```tsx
type Props = {
  gateway: GatewayStatus | null;
  models: ModelDefinition[];
};

export function DocsPageContent({ gateway, models }: Props) {
```

Replace the three `SNAPSHOT_CATALOG` arguments on lines 37/39/40 with `models`, and drop `SNAPSHOT_CATALOG` from the import, leaving `import type { ModelDefinition } from "../lib/models";`.

- [ ] **Step 5: Add the notice style**

Append to `app/globals.css`:

```css
.catalog-snapshot-notice { max-width: 640px; margin: 1rem 0 0; padding: .5rem .75rem; border: 1px dashed var(--line); color: var(--muted); font-size: .875rem; line-height: 1.5; }
```

- [ ] **Step 6: Convert the four pages to async server components**

`app/page.tsx`:

```tsx
import { HomeContent } from "../components/home-content";
import { fetchCatalog } from "../lib/catalog";
import { metadataForRoute } from "../lib/metadata";
import { mergeCatalog } from "../lib/models";

export const metadata = metadataForRoute("/");

// The catalogue is the gateway's answer, not a build-time constant; 60s keeps
// a restarted model visible within a minute without hammering /catalog.json.
export const revalidate = 60;

export default async function Home() {
  const catalog = await fetchCatalog();
  return (
    <HomeContent
      models={mergeCatalog(catalog.models)}
      snapshotDate={catalog.source === "snapshot" ? catalog.updated : null}
    />
  );
}
```

`app/models/page.tsx`:

```tsx
import { ModelsPageContent } from "../../components/models-page-content";
import { fetchCatalog } from "../../lib/catalog";
import { metadataForRoute } from "../../lib/metadata";
import { mergeCatalog } from "../../lib/models";

export const metadata = metadataForRoute("/models");

export const revalidate = 60;

export default async function ModelsPage() {
  const catalog = await fetchCatalog();
  return (
    <ModelsPageContent
      models={mergeCatalog(catalog.models)}
      snapshotDate={catalog.source === "snapshot" ? catalog.updated : null}
    />
  );
}
```

`app/pricing/page.tsx`:

```tsx
import { PricingPageContent } from "../../components/pricing-page-content";
import { fetchCatalog } from "../../lib/catalog";
import { metadataForRoute } from "../../lib/metadata";
import { mergeCatalog } from "../../lib/models";

export const metadata = metadataForRoute("/pricing");

export const revalidate = 60;

export default async function PricingPage() {
  const catalog = await fetchCatalog();
  return (
    <PricingPageContent
      models={mergeCatalog(catalog.models)}
      snapshotDate={catalog.source === "snapshot" ? catalog.updated : null}
    />
  );
}
```

`app/docs/page.tsx`:

```tsx
import { DocsPageContent } from "../../components/docs-page-content";
import { fetchCatalog } from "../../lib/catalog";
import { fetchGatewayStatus, type GatewayStatus } from "../../lib/gateway-status";
import { metadataForRoute } from "../../lib/metadata";
import { mergeCatalog } from "../../lib/models";

export const metadata = metadataForRoute("/docs");

// Release gates track the gateway's live status rather than a static claim.
export const revalidate = 60;

export default async function DocsPage() {
  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null;
  }
  const catalog = await fetchCatalog();
  return <DocsPageContent gateway={gateway} models={mergeCatalog(catalog.models)} />;
}
```

- [ ] **Step 7: Update the test call sites**

These are mechanical. In each file, every render of a component that now takes props gets the snapshot catalogue.

`tests/marketplace.test.tsx` — replace all 10 occurrences of `<ModelMarketplace />` with `<ModelMarketplace models={SNAPSHOT_CATALOG} />` (the import is already there from Task 2), and the one `<SiteShell><ModelMarketplace /></SiteShell>` with `<SiteShell><ModelMarketplace models={SNAPSHOT_CATALOG} /></SiteShell>`.

Run this to confirm none were missed: `grep -n "<ModelMarketplace />" tests/marketplace.test.tsx` → no output.

`tests/homepage.test.tsx` — add `import { SNAPSHOT_CATALOG } from "../lib/models";` and replace all 7 occurrences of `<HomeContent />` with `<HomeContent models={SNAPSHOT_CATALOG} snapshotDate={null} />`.

`tests/audience-paths.test.tsx` — add the same import and replace `<HomeContent />` with `<HomeContent models={SNAPSHOT_CATALOG} snapshotDate={null} />`.

`tests/pricing.test.tsx` — replace all 8 occurrences of `<PricingCalculator />` with `<PricingCalculator models={SNAPSHOT_CATALOG} />`; replace `<SiteShell><PricingPageContent /></SiteShell>` with `<SiteShell><PricingPageContent models={SNAPSHOT_CATALOG} snapshotDate={null} /></SiteShell>`; and replace all 6 occurrences of `<PricingPage />` with `<PricingPageContent models={SNAPSHOT_CATALOG} snapshotDate={null} />` — `PricingPage` is an async server component now and Testing Library cannot render one. Change the page import on line 6 to keep only the metadata:

```tsx
import { metadata } from "../app/pricing/page";
```

Confirm: `grep -n "<PricingPage />" tests/pricing.test.tsx` → no output.

`tests/docs-console.test.tsx` — add `import { SNAPSHOT_CATALOG } from "../lib/models";` and replace both `<DocsPageContent gateway={null} />` with `<DocsPageContent gateway={null} models={SNAPSHOT_CATALOG} />`.

`tests/skip-link.test.tsx` — the `it.each` table renders three now-async pages. Replace the imports on lines 5-7 and the table (lines 26-32) with:

```tsx
import ConsolePage from "../app/console/page";
import { DocsPageContent } from "../components/docs-page-content";
import { HomeContent } from "../components/home-content";
import { LocaleProvider } from "../components/locale-provider";
import { ModelsPageContent } from "../components/models-page-content";
import { PricingPageContent } from "../components/pricing-page-content";
import { SiteShell } from "../components/site-shell";
import { SNAPSHOT_CATALOG } from "../lib/models";
```

```tsx
  it.each([
    ["home", () => <HomeContent models={SNAPSHOT_CATALOG} snapshotDate={null} />],
    ["models", () => <ModelsPageContent models={SNAPSHOT_CATALOG} snapshotDate={null} />],
    ["pricing", () => <PricingPageContent models={SNAPSHOT_CATALOG} snapshotDate={null} />],
    ["docs", () => <DocsPageContent gateway={null} models={SNAPSHOT_CATALOG} />],
    ["console", ConsolePage],
  ])("gives the %s route a stable main-content landmark", (_name, Page) => {
    render(<LocaleProvider><Page /></LocaleProvider>);
    expect(document.querySelector("main#main-content")).toBeInTheDocument();
  });
```

- [ ] **Step 8: Run the full unit suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: all green, 0 failed.

- [ ] **Step 9: Add the server-render assertions**

In `tests/rendered-html.test.mjs`, extend the model-marketplace test (line 277) and add a snapshot-notice test. Replace that test with:

```js
test("server-renders the model marketplace from the catalogue", async () => {
  const response = await render("/models");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Choose the mind for the task/i);
  assert.match(html, /Search models/i);
  assert.match(html, /Qwen/i);
  assert.match(html, /GLM 5\.3 Flash Uncensored/);
  assert.match(html, /No content filtering; you are responsible for compliant use\./);
});

test("says so when the catalogue falls back to the snapshot", async () => {
  // The build has no reachable gateway, so /catalog.json fails and every
  // catalogue page must admit it is showing a snapshot rather than live data.
  for (const pathname of ["/", "/models", "/pricing"]) {
    const response = await render(pathname);
    const html = await response.text();
    assert.match(
      html,
      /Catalogue shown from a snapshot taken \d{4}-\d{2}-\d{2}; live availability unavailable\./,
      `${pathname} discloses the snapshot fallback`,
    );
  }
});
```

- [ ] **Step 10: Build and run the rendered-HTML test**

Run: `npm run build && node --test tests/rendered-html.test.mjs 2>&1 | tail -30`
Expected: build succeeds; all `node --test` assertions pass.

If the snapshot-notice assertion fails because the sandboxed build machine *can* reach `b300.powerchampion.ai` and the gateway already serves `/catalog.json`, that means the live path works — record the observation, and change those three assertions to `assert.ok(html.includes("snapshot taken") || html.includes("GLM 5.3 Flash Uncensored"))`. Report the change in the task summary; do not silently weaken the test.

- [ ] **Step 11: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add app components lib/content.ts app/globals.css tests
git commit -m "feat(catalog): render models, pricing and home from the live gateway catalogue"
```

---

## Task 4: `scripts/sync-catalog-snapshot.mjs` — refresh the snapshot before a release

**Files:**
- Create: `scripts/sync-catalog-snapshot.mjs`
- Create: `tests/sync-catalog-snapshot.test.ts`
- Modify: `package.json` (one script entry)

**Interfaces:**
- Consumes: the `// catalog-snapshot:start` / `// catalog-snapshot:end` markers written into `lib/catalog.ts` in Task 1, and the `CatalogPayload` shape.
- Produces (exported from the `.mjs` so they can be unit-tested without network or disk):
  - `function renderSnapshotBlock(payload: {updated: string, models: object[]}): string`
  - `function replaceSnapshotBlock(source: string, block: string): string`
  - `const SNAPSHOT_START = "// catalog-snapshot:start"`, `const SNAPSHOT_END = "// catalog-snapshot:end"`
- npm script: `npm run sync:catalog`

- [ ] **Step 1: Write the failing test**

Create `tests/sync-catalog-snapshot.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_END,
  SNAPSHOT_START,
  renderSnapshotBlock,
  replaceSnapshotBlock,
} from "../scripts/sync-catalog-snapshot.mjs";

const payload = {
  updated: "2026-10-01T00:00:00Z",
  models: [
    {
      id: "glm-5.2-fp8",
      name: "GLM 5.2 FP8",
      description: "Frontier bilingual reasoning model.",
      modalities: { input: ["text"], output: ["text"] },
      context_length: 131072,
      max_output_length: 32768,
      pricing: { unit: "per_million_tokens", prompt_usd: 0.93, completion_usd: 3.0 },
      billing_note: null,
      ready: true,
      uptime: 0.998,
    },
  ],
};

describe("renderSnapshotBlock", () => {
  it("emits a typed, dated TypeScript block", () => {
    const block = renderSnapshotBlock(payload);

    expect(block.startsWith(SNAPSHOT_START)).toBe(true);
    expect(block.trimEnd().endsWith(SNAPSHOT_END)).toBe(true);
    expect(block).toContain('export const CATALOG_SNAPSHOT_DATE = "2026-10-01";');
    expect(block).toContain("export const CATALOG_SNAPSHOT: CatalogModel[] = [");
    expect(block).toContain('"id": "glm-5.2-fp8"');
    // uptime is a live health reading, not a catalogue fact worth freezing.
    expect(block).toContain('"uptime": null');
  });

  it("rejects a payload with no models rather than emptying the snapshot", () => {
    expect(() => renderSnapshotBlock({ updated: "2026-10-01", models: [] }))
      .toThrow(/at least one model/i);
  });
});

describe("replaceSnapshotBlock", () => {
  it("swaps only the marked region", () => {
    const source = [
      "const before = 1;",
      SNAPSHOT_START,
      "old contents",
      SNAPSHOT_END,
      "const after = 2;",
      "",
    ].join("\n");

    const result = replaceSnapshotBlock(source, `${SNAPSHOT_START}\nnew contents\n${SNAPSHOT_END}`);

    expect(result).toContain("const before = 1;");
    expect(result).toContain("new contents");
    expect(result).not.toContain("old contents");
    expect(result).toContain("const after = 2;");
  });

  it("refuses to write when the markers are missing", () => {
    expect(() => replaceSnapshotBlock("no markers here", "x")).toThrow(/marker/i);
  });
});

describe("lib/catalog.ts", () => {
  it("still carries both markers so the script can find its block", async () => {
    const source = await readFile(resolve(process.cwd(), "lib/catalog.ts"), "utf8");
    expect(source).toContain(SNAPSHOT_START);
    expect(source).toContain(SNAPSHOT_END);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sync-catalog-snapshot.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/sync-catalog-snapshot.mjs"`.

- [ ] **Step 3: Write the script**

Create `scripts/sync-catalog-snapshot.mjs`:

```js
#!/usr/bin/env node
/**
 * Refresh CATALOG_SNAPSHOT in lib/catalog.ts from the live gateway.
 *
 * Run this by hand before a release. The snapshot is only what the site falls
 * back to when /catalog.json cannot be reached, so it should be refreshed
 * deliberately and reviewed in the diff — never fetched at build time, which
 * would make two builds of the same commit produce different sites.
 *
 *   npm run sync:catalog
 *   GATEWAY_ORIGIN=http://localhost:8000 npm run sync:catalog
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SNAPSHOT_START = "// catalog-snapshot:start";
export const SNAPSHOT_END = "// catalog-snapshot:end";

const CATALOG_FIELDS = [
  "id",
  "name",
  "description",
  "modalities",
  "context_length",
  "max_output_length",
  "pricing",
  "billing_note",
  "ready",
  "uptime",
];

/**
 * Build the replacement source block. Field order is pinned so an unchanged
 * gateway produces a byte-identical block and the diff stays reviewable.
 */
export function renderSnapshotBlock(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  if (models.length === 0) {
    throw new Error("Refusing to write a snapshot with no models: the payload must contain at least one model.");
  }

  const date = String(payload.updated ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Payload "updated" is not an ISO date: ${JSON.stringify(payload.updated)}`);
  }

  const entries = models.map((model) => {
    const ordered = {};
    for (const field of CATALOG_FIELDS) {
      // uptime is a rolling health reading; freezing it would publish a stale
      // percentage as if it were current.
      ordered[field] = field === "uptime" ? null : (model[field] ?? null);
    }
    if (!ordered.id || !ordered.pricing) {
      throw new Error(`Gateway model is missing id or pricing: ${JSON.stringify(model)}`);
    }
    return JSON.stringify(ordered, null, 2)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
  });

  return [
    `${SNAPSHOT_START} — regenerated by scripts/sync-catalog-snapshot.mjs`,
    `export const CATALOG_SNAPSHOT_DATE = ${JSON.stringify(date)};`,
    "",
    "export const CATALOG_SNAPSHOT: CatalogModel[] = [",
    `${entries.join(",\n")},`,
    "];",
    SNAPSHOT_END,
    "",
  ].join("\n");
}

export function replaceSnapshotBlock(source, block) {
  const start = source.indexOf(SNAPSHOT_START);
  const end = source.indexOf(SNAPSHOT_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not find the ${SNAPSHOT_START} / ${SNAPSHOT_END} marker pair in lib/catalog.ts`);
  }
  return source.slice(0, start) + block.trimEnd() + source.slice(end + SNAPSHOT_END.length);
}

async function main() {
  const origin = process.env.GATEWAY_ORIGIN ?? "https://b300.powerchampion.ai";
  const url = `${origin}/catalog.json`;
  process.stdout.write(`Fetching ${url}\n`);

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  const payload = await response.json();
  const block = renderSnapshotBlock(payload);

  const target = resolve(dirname(fileURLToPath(import.meta.url)), "../lib/catalog.ts");
  const source = await readFile(target, "utf8");
  const next = replaceSnapshotBlock(source, block);

  if (next === source) {
    process.stdout.write("Snapshot already up to date; nothing written.\n");
    return;
  }
  await writeFile(target, next, "utf8");
  process.stdout.write(
    `Wrote ${payload.models.length} models to lib/catalog.ts. Review the diff, then run: npx vitest run\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Register the npm script**

In `package.json`, add one line to `scripts`, after `"test:unit"`:

```json
    "sync:catalog": "node scripts/sync-catalog-snapshot.mjs",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/sync-catalog-snapshot.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Prove the script is idempotent against the checked-in snapshot**

The gateway does not serve `/catalog.json` yet, so verify against a local fixture instead of the network:

```bash
node --input-type=module -e '
import { readFile } from "node:fs/promises";
import { renderSnapshotBlock, replaceSnapshotBlock } from "./scripts/sync-catalog-snapshot.mjs";
const source = await readFile("lib/catalog.ts", "utf8");
const ids = [...source.matchAll(/"id": "([^"]+)"|id: "([^"]+)"/g)].map((m) => m[1] ?? m[2]);
console.log("snapshot ids found in lib/catalog.ts:", ids.join(", "));
const block = renderSnapshotBlock({ updated: "2026-09-09T00:00:00Z", models: [{ id: "x", name: "X", description: "d", modalities: { input: ["text"], output: ["text"] }, context_length: 1, max_output_length: 1, pricing: { unit: "per_million_tokens", prompt_usd: 1, completion_usd: 1 }, billing_note: null, ready: true, uptime: 0.9 }] });
const rewritten = replaceSnapshotBlock(source, block);
console.log("rewrite kept the module intact:", rewritten.includes("export async function fetchCatalog"));
'
```

Expected: prints the nine snapshot ids and `rewrite kept the module intact: true`. **Do not commit the rewritten file** — this run only prints, it does not write.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run 2>&1 | tail -10`
Expected: 0 failed.

- [ ] **Step 8: Commit**

```bash
git add scripts/sync-catalog-snapshot.mjs tests/sync-catalog-snapshot.test.ts package.json
git commit -m "chore(catalog): add a manual snapshot sync script"
```

---

## Task 5: Legal texts — port the gateway's policies, add `/data-retention`, translate

**Files:**
- Modify: `lib/trust.ts:86-90` (types) and `lib/trust.ts:181-244` (`POLICY_CONTENT`, rewritten)
- Modify: `components/editorial-page.tsx:1-34`
- Create: `app/data-retention/page.tsx`
- Modify: `lib/metadata.ts:3-16, 51-54(only the route union here), 63-70`
- Modify: `lib/content.ts` (`footer.dataRetention`, both locales)
- Modify: `components/site-shell.tsx:15, 44-47, 52-58`
- Modify: `public/sitemap.xml`
- Create: `tests/legal-pages.test.tsx`
- Modify: `tests/trust-pages.test.tsx` (add the data-retention page to the boundary table)
- Modify: `tests/rendered-html.test.mjs` (route list + metadata table)

**Interfaces:**
- Consumes: nothing from Tasks 1-4.
- Produces:
  - `const LEGAL_EFFECTIVE_DATE = "2026-09-09"`, `LEGAL_ENTITY`, `LEGAL_CONTACT_EMAIL`, `LEGAL_GATEWAY_HOST` (all from `lib/trust.ts`)
  - `type PolicyDocument = { kicker: string; title: string; meta: string; lead: string; sections: EditorialSection[]; related: { href: string; label: string }[] }`
  - `POLICY_CONTENT[locale].privacy | .terms | .dataRetention: PolicyDocument`
  - `EditorialPage({ policy }: { policy: "privacy" | "terms" | "dataRetention" })`
  - route `/data-retention`; `RoutePath` gains `"/data-retention"`
  - copy key `COPY[locale].footer.dataRetention`

**Source of the English text (do this first, it is an input to Step 3):** the gateway's inline HTML. Read exactly these lines and nothing else — the file is large, do not open it whole:

```bash
sed -n '2149,2258p' /Users/optyne/repository/b300/sell-panel/.wt-siteinfo/app.py
```

That prints the `/privacy` (2149), `/data-retention` (2185) and `/terms` (2224) handlers. The English strings in Step 3 below were transcribed from that range on 2026-09-09; re-read it and confirm each paragraph still matches before writing. Where the gateway's HTML has an inline `<a href="/data-retention">` the plain-text section drops the anchor and the destination moves to `related` — `EditorialSection.body` is plain text, not HTML, and must stay that way.

Note: `app.py:1586` sets `LEGAL_EFFECTIVE_DATE = "2026-07-08"`. The marketing site uses **2026-09-09** — the date the consolidated policies are published. That is intentional, not a transcription error.

- [ ] **Step 1: Write the failing test**

Create `tests/legal-pages.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import DataRetentionPage from "../app/data-retention/page";
import PrivacyPage from "../app/privacy/page";
import TermsPage from "../app/terms/page";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_ENTITY,
  POLICY_CONTENT,
} from "../lib/trust";

const pages = [
  ["privacy", <PrivacyPage key="privacy" />],
  ["terms", <TermsPage key="terms" />],
  ["dataRetention", <DataRetentionPage key="data-retention" />],
] as const;

describe("published legal pages", () => {
  it.each(pages)("%s carries the entity, effective date and contact", (_id, page) => {
    render(<LocaleProvider>{page}</LocaleProvider>);
    const text = document.body.textContent ?? "";

    expect(text).toContain(LEGAL_ENTITY);
    expect(text).toContain(LEGAL_EFFECTIVE_DATE);
    expect(text).toContain(LEGAL_CONTACT_EMAIL);
  });

  it.each(pages)("%s contains no unfilled placeholder", (_id, page) => {
    render(<LocaleProvider>{page}</LocaleProvider>);
    const text = document.body.textContent ?? "";

    expect(text).not.toMatch(/\[/);
    expect(text).not.toMatch(/TBD/i);
    expect(text).not.toMatch(/yourdomain/i);
    // The .org mailbox is the real contact address; a .org *URL* is the stale
    // domain from the retired static site and must never appear.
    expect(text).not.toMatch(/https?:\/\/[^\s]*powerchampion\.org/i);
    expect(text).not.toMatch(/powerchampion\.org\//i);
  });

  it("cross-links the three policies in both directions", () => {
    render(<LocaleProvider><PrivacyPage /></LocaleProvider>);
    expect(screen.getByRole("link", { name: "Data Retention Policy" })).toHaveAttribute("href", "/data-retention");
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  });

  it("states the no-content-storage guarantee on privacy and data retention", () => {
    render(<LocaleProvider><PrivacyPage /></LocaleProvider>);
    expect(screen.getByText(/We do not store prompt or completion content\./)).toBeVisible();
  });

  it("states the retention rule the gateway actually implements", () => {
    render(<LocaleProvider><DataRetentionPage /></LocaleProvider>);
    expect(screen.getByText(/not written to persistent storage/)).toBeVisible();
    expect(screen.getByText(/not used to train, fine-tune, or evaluate machine-learning models\./)).toBeVisible();
  });

  it("states that there is no uptime guarantee without a signed SLA", () => {
    render(<LocaleProvider><TermsPage /></LocaleProvider>);
    expect(screen.getByText(/no specific uptime or latency is guaranteed\./)).toBeVisible();
  });

  it("renders every section in Traditional Chinese too", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><DataRetentionPage /></SiteShell>
      </LocaleProvider>,
    );

    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);
    expect(screen.getByRole("heading", { level: 1, name: "資料保存政策" })).toBeVisible();
    expect(screen.getByText(/提示內容與模型輸出不會被用於訓練、微調或評估任何機器學習模型。/)).toBeVisible();
  });

  it("keeps both locales structurally parallel", () => {
    for (const policy of ["privacy", "terms", "dataRetention"] as const) {
      const en = POLICY_CONTENT.en[policy];
      const zh = POLICY_CONTENT.zh[policy];
      expect(zh.sections.map((section) => section.id)).toEqual(en.sections.map((section) => section.id));
      expect(zh.related.map((link) => link.href)).toEqual(en.related.map((link) => link.href));
      for (const section of [...en.sections, ...zh.sections]) {
        expect(section.title, section.id).toBeTruthy();
        expect(section.body.length, section.id).toBeGreaterThan(0);
      }
    }
  });

  it("links Data retention from the footer", () => {
    render(
      <LocaleProvider>
        <SiteShell><main id="main-content">Content</main></SiteShell>
      </LocaleProvider>,
    );

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Data retention" }))
      .toHaveAttribute("href", "/data-retention");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/legal-pages.test.tsx`
Expected: FAIL — `Failed to resolve import "../app/data-retention/page"`.

- [ ] **Step 3: Rewrite the policy content in `lib/trust.ts`**

Replace the type block at `lib/trust.ts:86-90` with:

```ts
export type PolicyLink = {
  href: string;
  label: string;
};

export type PolicyDocument = {
  kicker: string;
  title: string;
  /** Entity and effective date, shown under the heading. */
  meta: string;
  lead: string;
  sections: EditorialSection[];
  related: PolicyLink[];
};

export type PolicyLocaleContent = {
  privacy: PolicyDocument;
  terms: PolicyDocument;
  dataRetention: PolicyDocument;
  faq: FaqEntry[];
};
```

Add the constants immediately above `POLICY_CONTENT` (i.e. before line 181):

```ts
/**
 * The published legal identity. These four values used to be duplicated (and
 * to disagree) across the gateway's inline HTML, this file, and a retired
 * static site. One definition, referenced everywhere, is the whole point.
 */
export const LEGAL_EFFECTIVE_DATE = "2026-09-09";
export const LEGAL_ENTITY = "Power Champion Investment Limited";
export const LEGAL_CONTACT_EMAIL = "info@powerchampion.org";
export const LEGAL_GATEWAY_HOST = "b300.powerchampion.ai";

const EN_META = `${LEGAL_ENTITY} · Effective ${LEGAL_EFFECTIVE_DATE}`;
const ZH_META = `${LEGAL_ENTITY} · 生效日期 ${LEGAL_EFFECTIVE_DATE}`;
const EN_CONTACT = `${LEGAL_ENTITY} — ${LEGAL_CONTACT_EMAIL}`;
const ZH_CONTACT = `${LEGAL_ENTITY} — ${LEGAL_CONTACT_EMAIL}`;
```

Now replace the whole of `POLICY_CONTENT` (lines 181-244) with the following. The `faq` arrays are unchanged from the current file and are reproduced in full below, including the `COMPANY_CAPACITY_MW` template literals — the existing `import { COMPANY_CAPACITY_MW } from "./company";` on line 2 stays.

```ts
export const POLICY_CONTENT: Record<Locale, PolicyLocaleContent> = {
  en: {
    privacy: {
      kicker: "Privacy",
      title: "Privacy Policy",
      meta: EN_META,
      lead: `This policy describes how ${LEGAL_ENTITY} ("we") handles data for its inference API at ${LEGAL_GATEWAY_HOST}, and what this marketing site itself processes.`,
      sections: [
        {
          id: "current-interactions",
          title: "What this site processes",
          body: ["The pricing estimator runs in your browser. The balance checker sends your API key only to the b300 gateway (POST /api/balance) to look up your balance; it is not transmitted to this site's server and is not persisted or logged."],
        },
        {
          id: "what-we-process",
          title: "What we process",
          body: ["To serve a request, we transiently process the prompt and parameters you send in order to generate a completion. Inference runs on our own GPU nodes."],
        },
        {
          id: "what-we-log",
          title: "What we log",
          body: ["We log usage metadata only — timestamps, API-key identifiers, model identifiers, measured token or media usage, a billing record identifier, and an operational status note when needed — for billing and reconciliation. We do not store prompt or completion content."],
        },
        {
          id: "no-training",
          title: "No training on your data",
          body: ["We do not use requests, prompts, or completions to train or fine-tune any model."],
        },
        {
          id: "retention",
          title: "Retention",
          body: ["Usage-metadata billing records are retained only as long as needed for billing, accounting, and reconciliation. No conversation content is retained. The specific handling rules are published in our Data Retention Policy."],
        },
        {
          id: "security",
          title: "Security",
          body: ["All traffic is served over HTTPS. GPU nodes are not publicly exposed and are reached only through a private channel. API access requires a bearer key."],
        },
        {
          id: "third-parties",
          title: "Third parties",
          body: ["If you reach our API through a marketplace such as OpenRouter, that provider routes and bills the request under its own policies before it reaches us."],
        },
        {
          id: "future-changes",
          title: "Future changes",
          body: ["If a future release changes data handling, this notice and the relevant service controls will be updated before that release."],
        },
        { id: "contact", title: "Contact", body: [EN_CONTACT] },
      ],
      related: [
        { href: "/data-retention", label: "Data Retention Policy" },
        { href: "/terms", label: "Terms of Service" },
      ],
    },
    terms: {
      kicker: "Terms",
      title: "Terms of Service",
      meta: EN_META,
      lead: `These terms govern use of the inference API at ${LEGAL_GATEWAY_HOST} and of this site.`,
      sections: [
        {
          id: "informational-site",
          title: "Site scope",
          body: ["Marketing pages provide public context. The API service at b300.powerchampion.ai is a live, transactional service billed on measured usage; commercial terms for API usage are formed when a key is issued."],
        },
        {
          id: "service",
          title: "Service",
          body: [`${LEGAL_ENTITY} provides an OpenAI-compatible inference API for hosted open-weight models at ${LEGAL_GATEWAY_HOST}. Access requires a valid API key.`],
        },
        {
          id: "acceptable-use",
          title: "Acceptable use",
          body: ["You agree not to use the service for unlawful purposes, to comply with the licenses of the underlying models, and not to attempt to disrupt, overload, or gain unauthorized access to the service or its infrastructure."],
        },
        {
          id: "pricing-billing",
          title: "Pricing and billing",
          body: [
            "Usage is billed in USD by the metered unit published on our pricing page and model catalog, either through a marketplace such as OpenRouter or under a direct agreement.",
            "API keys and redeem-code top-ups are issued manually by email. Usage is billed per the live published rates from your prepaid balance; failed requests are not billed.",
          ],
        },
        {
          id: "data-processing",
          title: "Data processing",
          body: ["Our Privacy Policy and Data Retention Policy describe how request data and usage metadata are handled."],
        },
        {
          id: "availability",
          title: "Availability",
          body: ["The service is provided on a best-effort basis. Unless a separate service-level agreement is signed, no specific uptime or latency is guaranteed."],
        },
        {
          id: "warranty-liability",
          title: "Warranty and liability",
          body: [`The service is provided "as is" without warranties of any kind. To the extent permitted by law, ${LEGAL_ENTITY} is not liable for indirect or consequential damages arising from use of the service.`],
        },
        {
          id: "external-sources",
          title: "External sources",
          body: ["Company and capacity context is qualified by the cited external sources and does not create a promise of deployment, capacity, or service."],
        },
        {
          id: "changes",
          title: "Changes",
          body: ["We may update these terms; continued use after an update constitutes acceptance."],
        },
        { id: "contact", title: "Contact", body: [EN_CONTACT] },
      ],
      related: [
        { href: "/privacy", label: "Privacy Policy" },
        { href: "/data-retention", label: "Data Retention Policy" },
      ],
    },
    dataRetention: {
      kicker: "Data retention",
      title: "Data Retention Policy",
      meta: EN_META,
      lead: "Prompt content is not persisted. The usage metadata that billing needs is, and this policy says for how long and why.",
      sections: [
        {
          id: "scope",
          title: "Scope",
          body: [`This policy supplements our Privacy Policy and describes how data is retained for the inference API at ${LEGAL_GATEWAY_HOST}.`],
        },
        {
          id: "prompt-content",
          title: "Prompt and output content",
          body: ["Prompt content and model output are processed only to complete the inference request. They are released when request processing finishes and are not written to persistent storage. Conversation content is not kept in billing records or operational usage logs."],
        },
        {
          id: "usage-metadata",
          title: "Usage metadata",
          body: ["We retain metering metadata such as timestamps, API-key identifiers, model identifiers, measured token or media usage, a billing record identifier, and an operational status note when needed, only as long as needed for billing and reconciliation purposes. These records do not contain prompt or output content."],
        },
        {
          id: "no-training",
          title: "No training use",
          body: ["Prompt content and model output are not used to train, fine-tune, or evaluate machine-learning models."],
        },
        {
          id: "deletion",
          title: "Deletion and legal obligations",
          body: ["When records are no longer needed for their stated billing, accounting, security, or legal purpose, they are deleted or de-identified. If applicable law requires a record to be preserved, we keep only the minimum required scope for the required period."],
        },
        { id: "contact", title: "Contact", body: [EN_CONTACT] },
      ],
      related: [
        { href: "/privacy", label: "Privacy Policy" },
        { href: "/terms", label: "Terms of Service" },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "Can I buy tokens now?", answer: "Yes. Keys are prepaid with a balance in nano-USD; top up by requesting a redeem code via email, then POST /v1/redeem with your key." },
      { id: "rates-final", question: "Are the displayed rates final?", answer: "Yes. The listed rates are the live chargeable rates the meter bills from — input and output priced separately, per million tokens (or per image/minute for media models)." },
      { id: "api-live", question: "Is the API live?", answer: "The OpenAI-compatible endpoint is deployed at b300.powerchampion.ai — text, vision, image, speech, embeddings, and reranking behind one key. Whether models are currently serving is shown live on the status page; this site does not claim availability it cannot observe." },
      { id: "entered-information", question: "What happens to information entered here?", answer: "The balance checker sends your key only to the b300 gateway (POST /api/balance) to look up your balance; it is never stored or logged by this site." },
      { id: "capacity-deployed", question: `Is ${COMPANY_CAPACITY_MW} already deployed?`, answer: "No. The figure is counterparty-reported expected capacity, not completed deployment.", href: "/company", linkLabel: "Read company context" },
      { id: "deployment-review", question: "What is a deployment review?", answer: "It is a non-binding channel for discussing deployment inputs; it does not reserve capacity or create a service commitment." },
      { id: "launch-access", question: "How do I request launch access?", answer: "Click \u201cGet API access\u201d \u2014 it opens a prefilled email to request your key. Keys and redeem-code top-ups are issued manually." },
    ],
  },
  zh: {
    privacy: {
      kicker: "隱私權",
      title: "隱私權政策",
      meta: ZH_META,
      lead: `本政策說明 ${LEGAL_ENTITY} 就其推理 API（${LEGAL_GATEWAY_HOST}）如何處理資料，以及本行銷網站本身處理哪些資料。`,
      sections: [
        {
          id: "current-interactions",
          title: "本站處理的資料",
          body: ["價格估算器在你的瀏覽器中執行。餘額查詢只會把你的 API 金鑰送到 b300 閘道（POST /api/balance）查詢餘額；金鑰不會傳輸至本站伺服器，也不會被儲存或記錄。"],
        },
        {
          id: "what-we-process",
          title: "我們處理什麼",
          body: ["為完成一次請求，我們會暫時處理你所傳送的提示內容與參數，以產生回應。推理運算執行於本公司自有的 GPU 節點。"],
        },
        {
          id: "what-we-log",
          title: "我們記錄什麼",
          body: ["我們僅記錄使用中繼資料 — 時間戳記、API 金鑰識別碼、模型識別碼、實測 Token 或媒體用量、計費紀錄識別碼，以及必要時的營運狀態註記 — 供計費與對帳之用。我們不儲存提示或回應的內容本文。"],
        },
        {
          id: "no-training",
          title: "不以你的資料訓練模型",
          body: ["我們不會將請求、提示內容或回應內容用於訓練或微調任何模型。"],
        },
        {
          id: "retention",
          title: "保存期間",
          body: ["使用中繼資料之計費紀錄，僅於計費、會計與對帳所需期間內保存。對話內容一律不予保存。具體處理規則公布於本公司《資料保存政策》。"],
        },
        {
          id: "security",
          title: "資料安全",
          body: ["所有流量均以 HTTPS 傳輸。GPU 節點不對公網暴露，僅透過私有通道連線。存取 API 須持有 Bearer 金鑰。"],
        },
        {
          id: "third-parties",
          title: "第三方",
          body: ["若你透過 OpenRouter 等市集連線至本服務，該供應商會依其自身政策先行路由與計費，之後請求才會抵達我們。"],
        },
        {
          id: "future-changes",
          title: "未來變更",
          body: ["若未來版本變更資料處理方式，會在發布前更新本聲明與相關服務控制。"],
        },
        { id: "contact", title: "聯絡我們", body: [ZH_CONTACT] },
      ],
      related: [
        { href: "/data-retention", label: "資料保存政策" },
        { href: "/terms", label: "服務條款" },
      ],
    },
    terms: {
      kicker: "條款",
      title: "服務條款",
      meta: ZH_META,
      lead: `本條款規範 ${LEGAL_GATEWAY_HOST} 推理 API 及本網站之使用。`,
      sections: [
        {
          id: "informational-site",
          title: "網站範圍",
          body: ["行銷頁面提供公開脈絡。b300.powerchampion.ai 的 API 服務是即時、交易性的服務，依實際用量計費；API 使用的商業條款於金鑰發放時成立。"],
        },
        {
          id: "service",
          title: "服務說明",
          body: [`${LEGAL_ENTITY} 於 ${LEGAL_GATEWAY_HOST} 提供相容於 OpenAI 規格的推理 API，服務託管之開源權重模型。存取本服務須持有有效的 API 金鑰。`],
        },
        {
          id: "acceptable-use",
          title: "可接受使用",
          body: ["你同意不將本服務用於違法目的，遵守底層模型之授權條款，且不得試圖干擾、超載本服務或其基礎設施，或未經授權存取之。"],
        },
        {
          id: "pricing-billing",
          title: "費用與計費",
          body: [
            "用量以美元計價，依本公司價格頁與模型目錄所公布之計費單位收費，可透過 OpenRouter 等市集或依個別協議進行。",
            "API 金鑰與儲值碼以 email 人工發放。用量依公布之即時費率從預付餘額扣款；失敗的請求不計費。",
          ],
        },
        {
          id: "data-processing",
          title: "資料處理",
          body: ["本公司《隱私權政策》與《資料保存政策》說明請求資料與使用中繼資料之處理方式。"],
        },
        {
          id: "availability",
          title: "服務可用性",
          body: ["本服務以合理努力（best-effort）為基礎提供。除另行簽訂服務水準協議（SLA）外，不保證特定之可用率或延遲。"],
        },
        {
          id: "warranty-liability",
          title: "保證與責任限制",
          body: [`本服務以「現狀」（AS IS）提供，不附任何明示或默示之保證。於法律允許之最大範圍內，${LEGAL_ENTITY} 對因使用本服務所生之間接或衍生性損害不負賠償責任。`],
        },
        {
          id: "external-sources",
          title: "外部來源",
          body: ["公司與容量脈絡受引用外部來源的限定，並不構成部署、容量或服務的承諾。"],
        },
        {
          id: "changes",
          title: "條款修訂",
          body: ["我們可能更新本條款；於更新後繼續使用本服務，即視為接受修訂後之條款。"],
        },
        { id: "contact", title: "聯絡我們", body: [ZH_CONTACT] },
      ],
      related: [
        { href: "/privacy", label: "隱私權政策" },
        { href: "/data-retention", label: "資料保存政策" },
      ],
    },
    dataRetention: {
      kicker: "資料保存",
      title: "資料保存政策",
      meta: ZH_META,
      lead: "提示內容不落地保存；計費所需的使用中繼資料則有明確的保存期間與目的，本政策逐項說明。",
      sections: [
        {
          id: "scope",
          title: "政策範圍",
          body: [`本政策為《隱私權政策》之補充，說明推理 API（${LEGAL_GATEWAY_HOST}）之資料保存方式。`],
        },
        {
          id: "prompt-content",
          title: "提示內容與模型輸出",
          body: ["提示內容與模型輸出僅為完成該次推理請求而處理，請求處理完畢後即釋放，不寫入持久化儲存。對話內容不會保留於計費紀錄或營運用量日誌中。"],
        },
        {
          id: "usage-metadata",
          title: "使用中繼資料",
          body: ["我們保存計量中繼資料，例如時間戳記、API 金鑰識別碼、模型識別碼、實測 Token 或媒體用量、計費紀錄識別碼，以及必要時的營運狀態註記，且僅於計費與對帳所需期間內保存。這些紀錄不含提示或輸出內容。"],
        },
        {
          id: "no-training",
          title: "不用於訓練",
          body: ["提示內容與模型輸出不會被用於訓練、微調或評估任何機器學習模型。"],
        },
        {
          id: "deletion",
          title: "刪除與法定義務",
          body: ["當紀錄已無計費、會計、資安或法律目的之必要時，即予刪除或去識別化。若適用法律要求保存特定紀錄，我們僅於法定最小範圍與期間內保存。"],
        },
        { id: "contact", title: "聯絡我們", body: [ZH_CONTACT] },
      ],
      related: [
        { href: "/privacy", label: "隱私權政策" },
        { href: "/terms", label: "服務條款" },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "我現在可以購買 Token 嗎？", answer: "可以。金鑰以 nano-USD 預付餘額運作；透過 email 申請儲值碼後，用金鑰 POST /v1/redeem 即可加值。" },
      { id: "rates-final", question: "顯示的費率是最終價格嗎？", answer: "是。表列費率即為計費表實際扣款的即時費率 — 輸入與輸出分開計價，以每百萬 Token 計（媒體模型以每張圖/每分鐘計）。" },
      { id: "api-live", question: "API 已經上線了嗎？", answer: "OpenAI 相容端點已部署於 b300.powerchampion.ai — 文字、視覺、圖像、語音、嵌入與重排序，一把金鑰全部搞定。模型目前是否正在服務，以狀態頁即時呈現為準；本站不宣稱無法觀測的可用性。" },
      { id: "entered-information", question: "我在這裡輸入的資訊會怎麼處理？", answer: "餘額查詢只會把你的金鑰送到 b300 閘道（POST /api/balance）查詢餘額；本站不會儲存或記錄金鑰。" },
      { id: "capacity-deployed", question: `${COMPANY_CAPACITY_MW} 已經部署了嗎？`, answer: "沒有。該數字是交易對手報告的預期容量，並非已完成部署。", href: "/company", linkLabel: "閱讀公司脈絡" },
      { id: "deployment-review", question: "什麼是部署審查？", answer: "這是非約束性的洽談管道，用於討論部署輸入；不會預留容量或形成服務承諾。" },
      { id: "launch-access", question: "如何申請啟動存取？", answer: "點擊「取得 API 存取」— 會開啟預填 email 申請金鑰。金鑰與儲值碼以人工發放。" },
    ],
  },
};
```

- [ ] **Step 4: Render `meta` and `related` in `EditorialPage`**

Replace `components/editorial-page.tsx` entirely:

```tsx
"use client";

import { useLocale } from "./locale-provider";
import { POLICY_CONTENT } from "../lib/trust";

type PolicyPage = "privacy" | "terms" | "dataRetention";

export function EditorialPage({ policy }: { policy: PolicyPage }) {
  const { locale } = useLocale();
  const content = POLICY_CONTENT[locale][policy];
  const relatedLabel = locale === "en" ? "Related policies" : "相關政策";

  return (
    <main className="editorial-page" id="main-content">
      <header aria-labelledby="editorial-title" className="editorial-hero">
        <p className="eyebrow">{content.kicker}</p>
        <h1 id="editorial-title">{content.title}</h1>
        <p className="editorial-meta">{content.meta}</p>
        <p>{content.lead}</p>
      </header>
      <nav aria-label={content.title} className="editorial-section-navigation">
        <ul>
          {content.sections.map((section) => (
            <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
          ))}
        </ul>
      </nav>
      {content.sections.map((section) => (
        <section aria-labelledby={`${section.id}-title`} id={section.id} key={section.id}>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
      <nav aria-label={relatedLabel} className="editorial-related">
        <h2>{relatedLabel}</h2>
        <ul>
          {content.related.map((link) => (
            <li key={link.href}><a href={link.href}>{link.label}</a></li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
```

Append to `app/globals.css`:

```css
.editorial-meta { margin: .75rem 0 0; color: var(--muted); font-family: var(--font-geist-mono), monospace; font-size: .8125rem; letter-spacing: .04em; }
.editorial-related { margin: 2.5rem 0 0; padding-top: 1.5rem; border-top: 1px solid var(--line); }
.editorial-related h2 { margin: 0 0 .75rem; font-size: 1rem; }
.editorial-related ul { display: flex; flex-wrap: wrap; gap: 1.25rem; margin: 0; padding: 0; list-style: none; }
```

- [ ] **Step 5: Add the route**

Create `app/data-retention/page.tsx`:

```tsx
import { EditorialPage } from "../../components/editorial-page";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/data-retention");

export default function DataRetentionPage() {
  return <EditorialPage policy="dataRetention" />;
}
```

In `lib/metadata.ts`, add `| "/data-retention"` to the `RoutePath` union (after `"/privacy"` on line 16) and add the entry after the `/privacy` block (line 70):

```ts
  "/data-retention": {
    title: "Data retention | Power Champion",
    description: "How long the b300 gateway keeps usage metadata, and why prompt content is never persisted.",
  },
```

- [ ] **Step 6: Add the footer link**

`lib/content.ts` — add `dataRetention: string;` to the `footer` member of `CopyDictionary` (line 12), then in `COPY.en.footer` add `dataRetention: "Data retention",` and in `COPY.zh.footer` add `dataRetention: "資料保存",`.

`components/site-shell.tsx` — line 15 becomes:

```tsx
type FooterDestinationKey = NavigationKey | "about" | "terms" | "privacy" | "dataRetention";
```

The policies group (line 46) becomes:

```tsx
    destinations: [["faq", "/faq"], ["terms", "/terms"], ["privacy", "/privacy"], ["dataRetention", "/data-retention"]],
```

and `footerDestinationLabel` (lines 52-58) becomes:

```tsx
function footerDestinationLabel(copy: CopyDictionary, key: FooterDestinationKey) {
  if (key === "about" || key === "terms" || key === "privacy" || key === "status" || key === "dataRetention") {
    return copy.footer[key];
  }

  return copy.nav[key];
}
```

- [ ] **Step 7: Add the route to the sitemap**

In `public/sitemap.xml`, after the `/privacy` entry (line 74), before `</urlset>`:

```xml
  <url>
    <loc>https://powerchampion.ai/data-retention</loc>
    <lastmod>2026-09-09</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
```

- [ ] **Step 8: Run the new test**

Run: `npx vitest run tests/legal-pages.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 9: Fix the two existing assertions that referenced the old lead text**

`tests/trust-pages.test.tsx:62-68` asserts phrases from the old policy leads. The phrases still exist, but they have moved into the `informational-site` / `current-interactions` sections. Replace that `it.each` with:

```tsx
  it.each([
    [<TermsPage key="terms" />, /commercial terms for API usage are formed when a key is issued/i],
    [<PrivacyPage key="privacy" />, /not transmitted to this site's server and is not persisted or logged/i],
    [<DataRetentionPage key="data-retention" />, /not written to persistent storage/i],
  ])(
    "preserves the live-service boundary",
    (page, boundary) => {
      localized(page);
      expect(screen.getByText(boundary)).toBeVisible();
    },
  );
```

and add `import DataRetentionPage from "../app/data-retention/page";` to that file's imports.

- [ ] **Step 10: Add the route to the server-render test**

In `tests/rendered-html.test.mjs`:
- add to `routeMetadata` (after the `/privacy` entry):

```js
  "/data-retention": {
    title: "Data retention | Power Champion",
    description: "How long the b300 gateway keeps usage metadata, and why prompt content is never persisted.",
  },
```

- add `"/data-retention"` to the `routes` array (line 95).
- add a new test at the end of the file:

```js
test("server-renders the three policies without placeholders", async () => {
  for (const pathname of ["/privacy", "/terms", "/data-retention"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} returns 200`);
    const html = await response.text();

    assert.match(html, /Power Champion Investment Limited/, `${pathname} names the entity`);
    assert.match(html, /Effective 2026-09-09/, `${pathname} states the effective date`);
    assert.match(html, /info@powerchampion\.org/, `${pathname} publishes the contact address`);
    assert.doesNotMatch(html, /TBD|yourdomain/i, `${pathname} has no placeholder`);
    assert.doesNotMatch(html, /https?:\/\/[^"'\s]*powerchampion\.org/i, `${pathname} has no .org URL`);
    assert.match(html, /href="\/privacy"|href="\/terms"|href="\/data-retention"/, `${pathname} cross-links`);
  }
});
```

Note: the `[` placeholder check is deliberately **not** repeated against raw HTML — attribute syntax and JSON-LD both contain `[`. That check lives in `tests/legal-pages.test.tsx`, where it runs against rendered text.

- [ ] **Step 11: Full verification**

Run: `npx vitest run 2>&1 | tail -15`
Expected: 0 failed.

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Run: `npm run build && node --test tests/rendered-html.test.mjs 2>&1 | tail -25`
Expected: build succeeds, all assertions pass.

- [ ] **Step 12: Commit**

```bash
git add lib/trust.ts lib/metadata.ts lib/content.ts components/editorial-page.tsx components/site-shell.tsx app/data-retention app/globals.css public/sitemap.xml tests/legal-pages.test.tsx tests/trust-pages.test.tsx tests/rendered-html.test.mjs
git commit -m "feat(legal): publish the full privacy, terms and data-retention policies in both locales"
```

---

## Task 6: Locale — server-resolved `initialLocale`, cookie precedence, `<html lang>` on the server

**Files:**
- Create: `lib/locale.ts`
- Create: `tests/locale-resolution.test.ts`
- Modify: `components/locale-provider.tsx:1-83` (whole file rewritten)
- Modify: `app/layout.tsx:111-131` (Path A) **or** `app/layout.tsx:116-120` (Path B) — the probe in Step 1 decides
- Modify: `tests/setup.ts:83-90` (clear the locale cookie between tests)
- Modify: `tests/locale-detection.test.tsx` (3 new tests; the 5 existing ones keep passing unchanged)
- Modify: `tests/rendered-html.test.mjs:4-30` (the `request`/`render` helpers gain an extra-headers argument) and the end of the file (two new tests)

**Interfaces:**
- Consumes: `type Locale` from `../lib/content` (`"en" | "zh"`). Nothing from Tasks 1-5.
- Produces, from `lib/locale.ts`:
  - `const LOCALE_COOKIE = "pc-locale"`
  - `const LOCALE_STORAGE_KEY = "pc-locale"`
  - `const LOCALE_COOKIE_MAX_AGE = 31536000`
  - `function normalizeLocale(value: string | null | undefined): Locale | null`
  - `function localeFromAcceptLanguage(header: string | null | undefined): Locale | null`
  - `function resolveInitialLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale`
  - `function htmlLangFor(locale: Locale): "en" | "zh-Hant"`
  - `function readLocaleCookie(): Locale | null`
  - `function writeLocaleCookie(locale: Locale): void`
  - `function readBootstrapLocale(): Locale | null`
- Produces, from `components/locale-provider.tsx`:
  - `function detectLocale(fallback?: Locale): Locale` — **now exported** (it was module-private); precedence is cookie → localStorage → navigator → `fallback`
  - `LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale })` — `initialLocale` is optional, so every existing `<LocaleProvider>` call site in the test suite keeps compiling
  - `useLocale(): LocaleContextValue` — unchanged

**Note on `<html lang>` values:** the site already uses `"en"` and `"zh-Hant"` (`components/locale-provider.tsx:51`, asserted at `tests/locale-detection.test.tsx:53`). `htmlLangFor()` is the single definition of that mapping from now on; do not invent `zh-TW` or `zh-Hant-TW`.

**Note on caching:** `app/layout.tsx:50-62` already calls `headers()` inside `generateMetadata`, so this app is already rendered per-request and the `export const revalidate = 60` that Task 3 put on the pages is already advisory. Reading `cookies()` in the layout body does not change that. Do not "fix" it by removing the revalidate exports.

- [ ] **Step 1: Probe — does this vinext build ship `next/headers`?**

vinext is *not* official Next.js, so `cookies()`/`headers()` in a layout cannot be assumed. Run all four commands:

```bash
grep -n '"next/headers"' node_modules/vinext/dist/shims/public-shim-map.json.js
grep -oE 'declare function (cookies|headers)\(\)[^;]*' node_modules/vinext/dist/shims/headers.d.ts
grep -n 'next/headers' app/layout.tsx
grep -n '"next/navigation"' vitest.config.ts
```

How to read the output:

- Command 1 must print a `"next/headers": { "shim": "headers", ... }` entry. That is vinext's public module map: if `next/headers` is listed, the import resolves at build time.
- Command 2 must print **two** lines — one `declare function headers()` and one `declare function cookies()`. Both are needed; `headers()` alone is not enough, because the cookie is the higher-precedence source.
- Command 3 must print `import { headers } from "next/headers";` (line 2). This is the strongest evidence: the layout already imports it and `npm run build` already passes today, so the shim works in this exact file.
- Command 4 prints the `next/navigation` alias vitest already has. There is **no** `next/headers` alias for vitest — that is why no test in this task may import `app/layout.tsx`. All locale logic that tests touch lives in `lib/locale.ts` and `components/locale-provider.tsx`, neither of which imports `next/headers`.

**Verified 2026-09-10: all four commands succeed, so Path A (Step 8a) is the expected route.** Take Path B (Step 8b) only if command 1 or 2 comes back empty (a vinext upgrade dropped the shim), or if Step 9's build/render test fails with a thrown dynamic-API error naming `cookies()`.

Record which path you took in the commit message.

- [ ] **Step 2: Write the failing test for the pure resolution helpers**

Create `tests/locale-resolution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  htmlLangFor,
  localeFromAcceptLanguage,
  normalizeLocale,
  resolveInitialLocale,
} from "../lib/locale";

describe("normalizeLocale", () => {
  it("accepts exactly the two supported values", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh")).toBe("zh");
  });

  it("rejects everything else instead of guessing", () => {
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale("zh-TW")).toBeNull();
    expect(normalizeLocale("EN")).toBeNull();
    expect(normalizeLocale("ja")).toBeNull();
  });
});

describe("localeFromAcceptLanguage", () => {
  it("maps a Traditional Chinese browser to zh", () => {
    expect(localeFromAcceptLanguage("zh-TW,zh;q=0.9,en;q=0.8")).toBe("zh");
  });

  it("maps a plain English browser to en", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("honours q-values rather than raw header order", () => {
    expect(localeFromAcceptLanguage("en;q=0.4,zh-TW;q=0.9")).toBe("zh");
    expect(localeFromAcceptLanguage("zh-TW;q=0.4,en-GB;q=0.9")).toBe("en");
  });

  it("skips unsupported languages and keeps looking", () => {
    expect(localeFromAcceptLanguage("ja-JP,fr-FR,en-GB")).toBe("en");
    expect(localeFromAcceptLanguage("ja-JP,fr-FR,zh-HK")).toBe("zh");
  });

  it("returns null when nothing usable is offered", () => {
    expect(localeFromAcceptLanguage("ja-JP,fr-FR")).toBeNull();
    expect(localeFromAcceptLanguage("*")).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });
});

describe("resolveInitialLocale", () => {
  it("prefers the cookie over the header", () => {
    expect(resolveInitialLocale({ cookie: "en", acceptLanguage: "zh-TW,zh;q=0.9" })).toBe("en");
    expect(resolveInitialLocale({ cookie: "zh", acceptLanguage: "en-US,en;q=0.9" })).toBe("zh");
  });

  it("falls through a junk cookie to the header", () => {
    expect(resolveInitialLocale({ cookie: "zh-TW", acceptLanguage: "zh-TW,zh;q=0.9" })).toBe("zh");
  });

  it("falls through to English when neither source decides", () => {
    expect(resolveInitialLocale({ cookie: null, acceptLanguage: "ja-JP" })).toBe("en");
    expect(resolveInitialLocale({})).toBe("en");
  });
});

describe("htmlLangFor", () => {
  it("uses the document language tags the site already ships", () => {
    expect(htmlLangFor("en")).toBe("en");
    expect(htmlLangFor("zh")).toBe("zh-Hant");
  });
});

describe("cookie constants", () => {
  it("keeps the cookie name aligned with the localStorage key and lasts a year", () => {
    expect(LOCALE_COOKIE).toBe("pc-locale");
    expect(LOCALE_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/locale-resolution.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/locale"`.

- [ ] **Step 4: Write `lib/locale.ts`**

Create `lib/locale.ts`:

```ts
/**
 * One definition of "which language is this request in".
 *
 * The server (app/layout.tsx) resolves the locale from the request before the
 * first byte of HTML, so <html lang> and the first paint are already correct;
 * the client (components/locale-provider.tsx) resolves the same thing from the
 * browser. Both read the same cookie, so a visitor who picks a language once
 * gets it on every subsequent server render — that is the whole point of the
 * cookie, and why localStorage alone was not enough.
 *
 * This module is deliberately framework-free: it must be importable from a
 * server component, a "use client" component, and a plain vitest file. Nothing
 * here may import "next/headers" (vitest has no alias for it) or React.
 */

import type { Locale } from "./content";

/** Shared with the server. Read on every request in app/layout.tsx. */
export const LOCALE_COOKIE = "pc-locale";

/**
 * Same string, different store. Kept as its own constant because the two have
 * independent lifetimes: the cookie is what the server can see, localStorage is
 * the pre-cookie preference that still has to keep working for returning
 * visitors who have not toggled the language since this shipped.
 */
export const LOCALE_STORAGE_KEY = "pc-locale";

/** One year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Set by the Path B bootstrap script before hydration; absent under Path A. */
export const LOCALE_BOOTSTRAP_ATTRIBUTE = "data-locale";

export function normalizeLocale(value: string | null | undefined): Locale | null {
  return value === "en" || value === "zh" ? value : null;
}

export function htmlLangFor(locale: Locale): "en" | "zh-Hant" {
  return locale === "zh" ? "zh-Hant" : "en";
}

type WeightedTag = { tag: string; quality: number; order: number };

function parseAcceptLanguage(header: string): WeightedTag[] {
  return header
    .split(",")
    .map((part, order) => {
      const [rawTag, ...params] = part.split(";");
      const tag = rawTag.trim().toLowerCase();
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const parsed = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      const quality = Number.isFinite(parsed) ? parsed : 0;
      return { tag, quality, order };
    })
    .filter((entry) => entry.tag.length > 0 && entry.quality > 0)
    // Array.prototype.sort is stable, so equal q-values keep header order —
    // which is what a browser means when it omits q entirely.
    .sort((a, b) => b.quality - a.quality || a.order - b.order);
}

/**
 * The first tag the gateway's two locales can serve wins. Ordering is by
 * q-value, not raw header order, so "en;q=0.4,zh-TW;q=0.9" is a Chinese
 * browser. Anything else (ja, fr, "*") yields null so the caller can decide.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  for (const { tag } of parseAcceptLanguage(header)) {
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("en")) return "en";
  }
  return null;
}

/**
 * Server-side precedence: an explicit choice (cookie) beats the browser's
 * advertised preference (Accept-Language), which beats English.
 */
export function resolveInitialLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  return (
    normalizeLocale(input.cookie)
    ?? localeFromAcceptLanguage(input.acceptLanguage)
    ?? "en"
  );
}

export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`),
  );
  return match ? normalizeLocale(decodeURIComponent(match[1])) : null;
}

export function writeLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  // Secure only over https — jsdom and `vinext dev` both serve over http and
  // would silently drop a Secure cookie, which would make the toggle look
  // like it works and then forget the choice on the next request.
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/**
 * Path B only: the inline bootstrap script stamps data-locale on <html> before
 * hydration. Returns null under Path A, where the server already passed
 * initialLocale down as a prop.
 */
export function readBootstrapLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  return normalizeLocale(
    document.documentElement.getAttribute(LOCALE_BOOTSTRAP_ATTRIBUTE),
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/locale-resolution.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Clear the cookie between tests**

The suite-wide `afterEach` in `tests/setup.ts:83-90` already clears `localStorage` so a language switch cannot leak into the next test. The cookie needs exactly the same treatment, and without it `tests/locale-detection.test.tsx`'s **existing** fifth case ("falls back through the preference list to English") starts failing, because the fourth case toggles to `zh` and the cookie would survive.

In `tests/setup.ts`, replace the `afterEach` block at lines 83-90 with:

```ts
afterEach(() => {
  cleanup();
  document.body.style.removeProperty("overflow");
  // LocaleProvider persists the user's locale choice; clear it between tests
  // so a test that switches to zh-Hant does not leak into the next one.
  window.localStorage.clear();
  // Same choice, second store: the cookie is what the server reads, and it
  // outranks localStorage, so leaving it set would silently pin every later
  // test in this file to one language.
  document.cookie = "pc-locale=; Path=/; Max-Age=0";
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("data-locale");
});
```

- [ ] **Step 7: Write the failing provider tests**

Append to `tests/locale-detection.test.tsx`, after the closing `});` of the existing `describe("LocaleProvider auto-detection and persistence")` block (line 106):

```tsx
describe("LocaleProvider cookie precedence and server-resolved initial locale", () => {
  it("lets the cookie outrank localStorage and the browser language", async () => {
    document.cookie = "pc-locale=zh; Path=/";
    window.localStorage.setItem(STORAGE_KEY, "en");
    setBrowserLanguages(["en-US", "en"]);
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(
      await within(screen.getByRole("banner")).findByRole("button", { name: "取得 API 存取" }),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
  });

  it("keeps the server's initialLocale when the browser offers no opinion", () => {
    setBrowserLanguages(["ja-JP", "fr-FR"]);
    render(
      <LocaleProvider initialLocale="zh">
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(
      within(screen.getByRole("banner")).getByRole("button", { name: "取得 API 存取" }),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
  });

  it("writes the cookie as well as localStorage when the user toggles language", async () => {
    setBrowserLanguages(["en-US"]);
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getAllByRole("button", { name: "繁中" })[0]);

    expect(document.cookie).toMatch(/(?:^|;\s*)pc-locale=zh(?:;|$)/);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("zh");
  });
});
```

Why the second case sets `["ja-JP", "fr-FR"]`: `detectLocale` still consults the browser *before* falling back to `initialLocale`, because a returning visitor's browser is a stronger signal than a header the CDN may have mangled. Japanese and French match neither branch, so the fallback is the only thing left — which is exactly the behaviour under test. Do not weaken `detectLocale` to make a simpler test pass.

- [ ] **Step 8: Run the tests to verify they fail**

Run: `npx vitest run tests/locale-detection.test.tsx`
Expected: FAIL — 3 failures. The cookie case renders English (`Unable to find role="button" and name "取得 API 存取"`), the `initialLocale` case fails to type-check / renders English, and the toggle case finds no `pc-locale` cookie.

- [ ] **Step 9: Rewrite `components/locale-provider.tsx`**

Replace the whole of `components/locale-provider.tsx` with:

```tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { COPY, type CopyDictionary, type Locale } from "../lib/content";
import {
  LOCALE_STORAGE_KEY,
  htmlLangFor,
  normalizeLocale,
  readBootstrapLocale,
  readLocaleCookie,
  writeLocaleCookie,
} from "../lib/locale";

type LocaleContextValue = {
  locale: Locale;
  copy: CopyDictionary;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Client-side precedence, deliberately parallel to resolveInitialLocale():
 *
 *   1. cookie        — the explicit choice the server can also see
 *   2. localStorage  — the same choice from before the cookie existed
 *   3. navigator     — what the browser advertises
 *   4. fallback      — whatever the server already decided (initialLocale), or
 *                      what the Path B bootstrap script stamped on <html>
 *
 * The fallback comes last, not first: a visitor whose browser says zh should
 * see Chinese even if a cache handed them an English-resolved shell.
 */
export function detectLocale(fallback: Locale = "en"): Locale {
  const fromCookie = readLocaleCookie();
  if (fromCookie) return fromCookie;

  if (typeof window !== "undefined") {
    const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    if (stored) return stored;
  }

  if (typeof navigator !== "undefined") {
    const langs = navigator.languages ?? [navigator.language];
    for (const lang of langs) {
      const lower = lang.toLowerCase();
      if (lower.startsWith("zh")) return "zh";
      if (lower.startsWith("en")) return "en";
    }
  }

  return fallback;
}

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  // The server already resolved the request's locale, so the first render — and
  // therefore the SSR HTML — is in the right language. Absent the prop (tests,
  // and Path B) this is "en", exactly as before.
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? "en");
  const [hydrated, setHydrated] = useState(false);

  // On mount: re-resolve from the browser, falling back to whatever the server
  // (Path A) or the bootstrap script (Path B) decided.
  useEffect(() => {
    setLocaleState(detectLocale(initialLocale ?? readBootstrapLocale() ?? "en"));
    setHydrated(true);
  }, [initialLocale]);

  // Persist choice + sync <html lang>, handing the attribute back to the
  // host page on unmount (capture/restore on every run keeps the chain
  // intact across locale switches).
  useEffect(() => {
    const previousLanguage = document.documentElement.getAttribute("lang");
    document.documentElement.lang = htmlLangFor(locale);
    if (hydrated) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }

    return () => {
      if (previousLanguage === null) {
        document.documentElement.removeAttribute("lang");
      } else {
        document.documentElement.lang = previousLanguage;
      }
    };
  }, [locale, hydrated]);

  // Only an explicit toggle writes the cookie. Auto-detection must not, or a
  // Chinese-browser visitor who never touched the switch would be pinned to zh
  // on every later device-independent server render.
  const setLocale = (next: Locale) => {
    writeLocaleCookie(next);
    setLocaleState(next);
  };

  const value = useMemo(
    () => ({ locale, copy: COPY[locale], setLocale }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }

  return context;
}
```

- [ ] **Step 10: Run the provider tests to verify they pass**

Run: `npx vitest run tests/locale-detection.test.tsx`
Expected: PASS, 8 tests (the 5 original + the 3 new).

- [ ] **Step 11a: Wire the server-resolved locale into the layout — PATH A (probe succeeded)**

In `app/layout.tsx`, extend the import on line 2 and add the locale import after line 7:

```tsx
import { cookies, headers } from "next/headers";
```

```tsx
import { LOCALE_COOKIE, htmlLangFor, resolveInitialLocale } from "../lib/locale";
```

Then replace `RootLayout` (lines 111-131) with:

```tsx
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const initialLocale = resolveInitialLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: requestHeaders.get("accept-language"),
  });

  return (
    <html lang={htmlLangFor(initialLocale)}>
      <head>
        <StructuredData />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LocaleProvider initialLocale={initialLocale}>
          <SiteShell>{children}</SiteShell>
          <LaunchAccessDialog />
        </LocaleProvider>
      </body>
    </html>
  );
}
```

Do **not** also add the Step 11b script. The two paths are alternatives; running both would set `data-locale` and then have `detectLocale` prefer a prop that says the same thing — harmless but two sources of truth for one decision.

- [ ] **Step 11b: Wire the locale into the layout — PATH B (probe failed: no `next/headers` shim, or `cookies()` throws at render)**

Leave `RootLayout` synchronous and leave `<html lang="en">` as the server default. Add the bootstrap constant above `StructuredData` (after line 94):

```tsx
// Path B: vinext could not give this layout the request, so the locale is
// resolved in the browser before hydration instead. This script runs in <head>,
// ahead of first paint, and stamps the answer where LocaleProvider's
// readBootstrapLocale() will find it. It is a byte-for-byte re-implementation
// of lib/locale.ts's precedence — cookie, then localStorage, then navigator —
// written inline because nothing may be imported this early.
const LOCALE_BOOTSTRAP = `(function(){try{var l=null;var m=document.cookie.match(/(?:^|;\\s*)pc-locale=(en|zh)(?:;|$)/);if(m){l=m[1];}if(!l){try{var s=window.localStorage.getItem("pc-locale");if(s==="en"||s==="zh"){l=s;}}catch(e){}}if(!l){var n=navigator.languages||[navigator.language||""];for(var i=0;i<n.length;i++){var v=String(n[i]||"").toLowerCase();if(v.indexOf("zh")===0){l="zh";break;}if(v.indexOf("en")===0){l="en";break;}}}if(!l){l="en";}var d=document.documentElement;d.lang=(l==="zh")?"zh-Hant":"en";d.setAttribute("data-locale",l);}catch(e){}})();`;

function LocaleBootstrap() {
  return <script dangerouslySetInnerHTML={{ __html: LOCALE_BOOTSTRAP }} />;
}
```

Then change the `<head>` block (lines 118-120) to:

```tsx
      <head>
        <LocaleBootstrap />
        <StructuredData />
      </head>
```

`LocaleProvider` needs no change: it is already written to call `readBootstrapLocale()` when no `initialLocale` prop arrives.

**Path B's cost, stated plainly so nobody mistakes it for equivalent:** the server still emits English HTML and `<html lang="en">`; the script corrects the attribute before paint but the *text* only becomes Chinese after hydration. The Step 13 acceptance test must therefore be weakened to assert `<html lang="zh-Hant">` only (drop the two Chinese-text assertions) and the shortfall must be reported to the user, not silently absorbed.

- [ ] **Step 12: Teach the server-render test to send request headers**

In `tests/rendered-html.test.mjs`, replace the `request` and `render` helpers (lines 4-30) with:

```js
async function request(pathname, host = "localhost", forwardedHost, extraHeaders = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: {
        accept: "text/html",
        host,
        ...(forwardedHost === undefined ? {} : { "x-forwarded-host": forwardedHost }),
        ...extraHeaders,
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function render(pathname, host = "localhost", forwardedHost, extraHeaders) {
  return request(pathname, host, forwardedHost, extraHeaders);
}
```

Every existing call site passes three arguments or fewer, so nothing else in the file changes.

- [ ] **Step 13: Add the acceptance test for `Accept-Language: zh-TW`**

Append to the end of `tests/rendered-html.test.mjs`:

```js
test("server-renders Traditional Chinese for a zh-TW browser", async () => {
  const response = await render("/", "localhost", undefined, {
    "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
  });
  assert.equal(response.status, 200, "the zh request still renders");

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="zh-Hant"/, "the server sets the document language");
  assert.match(html, /取得 API 存取/, "the first paint carries the Chinese header CTA");
  assert.match(html, /價格/, "the first paint carries the Chinese nav labels");
});

test("lets the pc-locale cookie override Accept-Language on the server", async () => {
  const response = await render("/", "localhost", undefined, {
    "accept-language": "zh-TW,zh;q=0.9",
    cookie: "pc-locale=en",
  });
  assert.equal(response.status, 200, "the cookie request still renders");

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="en"/, "the explicit choice wins");
  assert.match(html, /Get API access/, "the first paint stays English");
});

test("still defaults to English when the browser sends no Accept-Language", async () => {
  const response = await render("/");
  const html = await response.text();
  assert.match(html, /<html[^>]*lang="en"/, "no header means English");
  assert.match(html, /Get API access/, "and English copy");
});
```

The Chinese strings are the ones already in the dictionary: `lib/content.ts:30` has `getTokens: "取得 API 存取"` and `pricing: "價格"`. If either changes, update this test rather than the dictionary.

- [ ] **Step 14: Build and run the server-render test**

Run: `npm run build && node --test tests/rendered-html.test.mjs 2>&1 | tail -25`
Expected: build succeeds; all tests pass, including the three new ones.

If the build or the run fails with a thrown error naming `cookies()` or a dynamic-API restriction, you are on the Path B branch: revert Step 11a, apply Step 11b, weaken Step 13's first test to the `<html lang="zh-Hant">` assertion only, and re-run.

- [ ] **Step 15: Full verification**

Run: `npx vitest run 2>&1 | tail -15`
Expected: 0 failed. Test count is the Task 5 total plus 16 (13 in `tests/locale-resolution.test.ts`, 3 in `tests/locale-detection.test.tsx`).

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 16: Commit**

```bash
git add lib/locale.ts components/locale-provider.tsx app/layout.tsx tests/setup.ts tests/locale-resolution.test.ts tests/locale-detection.test.tsx tests/rendered-html.test.mjs
git commit -m "feat(locale): resolve the request locale on the server and share the choice through a cookie"
```

---

## Task 7: Metadata and small fixes — contact title, gateway-derived status link, sitemap, `/about` redirect

**Files:**
- Modify: `lib/metadata.ts:51-54` (the `/contact` entry only)
- Modify: `components/live-status-content.tsx:7-10, 30, 95-99` (new `gatewayOrigin` prop)
- Modify: `app/status/page.tsx:1-19` (pass `GATEWAY_ORIGIN` down)
- Modify: `public/sitemap.xml` (add `/console`)
- Create: `app/about/page.tsx`
- Create: `tests/metadata.test.ts`
- Modify: `tests/trust-pages.test.tsx:33, 42, 47` (the three `LiveStatusContent` call sites)
- Modify: `tests/rendered-html.test.mjs:66-69` (the `/contact` title in `routeMetadata`) and the end of the file (one new test)

**Interfaces:**
- Consumes from Task 1: `const GATEWAY_ORIGIN: string`, exported from `lib/gateway-status.ts` (`process.env.GATEWAY_ORIGIN ?? "https://b300.powerchampion.ai"`). Task 1 made that constant public; it is module-private in the pre-Task-1 tree, so if `import { GATEWAY_ORIGIN }` fails to resolve, Task 1 was not applied — stop and report BLOCKED rather than re-exporting it here.
- Consumes from Task 5: `RoutePath` already contains `"/data-retention"`, and `public/sitemap.xml` already contains a `/data-retention` `<url>` block.
- Produces:
  - `LiveStatusContent({ gateway, fetchedAt, gatewayOrigin }: { gateway: GatewayStatus | null; fetchedAt: number; gatewayOrigin: string })` — `gatewayOrigin` is **required**, so a future caller cannot silently fall back to a hard-coded host
  - `app/about/page.tsx` default export — a component that never returns; it calls `permanentRedirect("/company")`
  - `ROUTE_METADATA["/contact"].title === "Contact | Power Champion"`

- [ ] **Step 1: Probe — confirm what Task 5 already did, and how vinext spells a redirect**

Run all four:

```bash
grep -n 'data-retention\|console' public/sitemap.xml
grep -n 'export const GATEWAY_ORIGIN' lib/gateway-status.ts
grep -oE '(permanentRedirect|redirect)\b' node_modules/vinext/dist/shims/navigation-errors.d.ts | sort -u
grep -n 'status(303|307|308)|;(303|307|308);' node_modules/vinext/dist/utils/redirect-digest.js || grep -n '303|307|308' node_modules/vinext/dist/utils/redirect-digest.js
```

How to read it:

- Command 1 must show a `/data-retention` `<loc>` and **no** `/console` `<loc>`. That is the expected post-Task-5 state, and it is why Step 8 adds only `/console`. If `/console` is already there, skip Step 8 and say so in the commit message. If `/data-retention` is missing, Task 5 was not applied — stop and report BLOCKED.
- Command 2 must print the export. If it prints nothing, Task 1 was not applied — stop and report BLOCKED.
- Command 3 must list both `permanentRedirect` and `redirect`. vinext re-exports both through `next/navigation`; `permanentRedirect` is the one to use, because `/about` is going away for good and search engines should be told 308, not 307.
- Command 4 shows vinext's digest parser accepting a `;308` suffix. **Verified 2026-09-10:** `permanentRedirect(url)` throws digest `NEXT_REDIRECT;replace;<encoded url>;308`, and `dist/server/app-page-execution.js:57-62` turns that into `statusCode: 308`. That is what Step 11's assertion pins.

`vitest.config.ts` already aliases `next/navigation` to vinext's shim, so `tests/metadata.test.ts` can import the page and catch the thrown redirect without a build.

- [ ] **Step 2: Write the failing test**

Create `tests/metadata.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isRedirectError } from "next/navigation";
import { metadataForRoute } from "../lib/metadata";
import { GATEWAY_ORIGIN } from "../lib/gateway-status";

async function sitemap(): Promise<string> {
  return readFile(resolve(process.cwd(), "public/sitemap.xml"), "utf8");
}

describe("route metadata", () => {
  it("titles /contact as Contact, not as the old internal review name", () => {
    const meta = metadataForRoute("/contact");
    expect(meta.title).toBe("Contact | Power Champion");
    expect(meta.openGraph?.title).toBe("Contact | Power Champion");
    expect(meta.twitter?.title).toBe("Contact | Power Champion");
  });

  it("leaves the other route titles alone", () => {
    expect(metadataForRoute("/").title).toBe("Power Champion — OpenAI-compatible API · Live");
    expect(metadataForRoute("/console").title).toBe("Console | Power Champion");
  });
});

describe("sitemap", () => {
  it("lists every indexable public route", async () => {
    const xml = await sitemap();
    for (const pathname of [
      "/", "/models", "/pricing", "/docs", "/company", "/infrastructure",
      "/trust", "/status", "/faq", "/contact", "/console", "/terms",
      "/privacy", "/data-retention",
    ]) {
      const loc = pathname === "/"
        ? "https://powerchampion.ai/"
        : `https://powerchampion.ai${pathname}`;
      expect(xml).toContain(`<loc>${loc}</loc>`);
    }
  });

  it("does not list /about, which is a redirect and not a page", async () => {
    expect(await sitemap()).not.toContain("powerchampion.ai/about");
  });
});

describe("/about", () => {
  it("permanently redirects to /company", async () => {
    const { default: AboutPage } = await import("../app/about/page");

    let thrown: unknown;
    try {
      AboutPage();
    } catch (error) {
      thrown = error;
    }

    expect(isRedirectError(thrown)).toBe(true);
    const digest = String((thrown as { digest: string }).digest);
    expect(digest).toContain(encodeURIComponent("/company"));
    // permanentRedirect() appends the status; redirect() would not, and a 307
    // here would tell crawlers the old URL is coming back.
    expect(digest.endsWith(";308")).toBe(true);
  });
});

describe("gateway origin", () => {
  it("is the single definition the status link and the catalogue share", () => {
    expect(GATEWAY_ORIGIN).toMatch(/^https?:\/\//);
    expect(`${GATEWAY_ORIGIN}/status.json`).not.toContain("//status.json");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/metadata.test.ts`
Expected: FAIL — the `/contact` title is still `"Deployment review | Power Champion"`, the sitemap has no `/console`, and the `/about` import fails to resolve.

- [ ] **Step 4: Fix the `/contact` title**

In `lib/metadata.ts`, replace the `/contact` entry (lines 51-54):

```ts
  "/contact": {
    title: "Contact | Power Champion",
    description: "Review non-binding deployment interests locally in your browser.",
  },
```

The description is unchanged — only the title was wrong. `metadataForRoute()` already copies the title into `openGraph` and `twitter` (`lib/metadata.ts:79, 86`), so the two extra assertions in Step 2 come along for free.

- [ ] **Step 5: Write the `/about` redirect page**

Create `app/about/page.tsx`:

```tsx
import { permanentRedirect } from "next/navigation";

/**
 * /about is a legacy path: the gateway used to link to it, and it is still
 * quoted in older material. The page lives at /company now, so this is a 308 —
 * permanent, method-preserving, and safe for crawlers to fold into /company.
 *
 * There is no metadata export on purpose: nothing here ever renders, and a
 * title would only invite the route into the sitemap.
 */
export default function AboutPage(): never {
  permanentRedirect("/company");
}
```

- [ ] **Step 6: Give `LiveStatusContent` the gateway origin**

In `components/live-status-content.tsx`, replace the `Props` type (lines 7-10):

```tsx
type Props = {
  gateway: GatewayStatus | null;
  fetchedAt: number;
  /**
   * Where the machine-readable status lives. Passed in rather than imported so
   * this client component never reads process.env, and so the link can never
   * drift from the origin lib/gateway-status.ts actually fetched.
   */
  gatewayOrigin: string;
};
```

Change the signature on line 30:

```tsx
export function LiveStatusContent({ gateway, fetchedAt, gatewayOrigin }: Props) {
```

And replace the `status.json` link (lines 95-99):

```tsx
          <p>
            <a href={`${gatewayOrigin}/status.json`} rel="noreferrer">
              {trust.machineReadable}
            </a>
          </p>
```

- [ ] **Step 7: Pass it in from the page**

Replace the whole of `app/status/page.tsx`:

```tsx
import { LiveStatusContent } from "../../components/live-status-content";
import { metadataForRoute } from "../../lib/metadata";
import { GATEWAY_ORIGIN, fetchGatewayStatus, type GatewayStatus } from "../../lib/gateway-status";

export const metadata = metadataForRoute("/status");

// Live status: re-fetched on every request (ISR window keeps it cheap while
// still tracking model restarts within a minute).
export const revalidate = 60;

export default async function StatusPage() {
  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null; // render static readiness rows with a "unreachable" note
  }
  return (
    <LiveStatusContent
      gateway={gateway}
      fetchedAt={Date.now()}
      gatewayOrigin={GATEWAY_ORIGIN}
    />
  );
}
```

- [ ] **Step 8: Add `/console` to the sitemap**

In `public/sitemap.xml`, insert after the `/contact` entry (which ends at line 62) and before the `/terms` entry:

```xml
  <url>
    <loc>https://powerchampion.ai/console</loc>
    <lastmod>2026-09-09</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>
```

Do not add `/about` — it is a 308, and Step 2 asserts its absence.

- [ ] **Step 9: Update the three existing `LiveStatusContent` call sites**

`gatewayOrigin` is required, so `tests/trust-pages.test.tsx` no longer type-checks. In that file, change lines 33, 42 and 47 to:

```tsx
    localized(<LiveStatusContent gateway={null} fetchedAt={0} gatewayOrigin="https://gateway.test" />);
```

```tsx
    localized(<LiveStatusContent gateway={gatewayWith("down")} fetchedAt={0} gatewayOrigin="https://gateway.test" />);
```

```tsx
    localized(<LiveStatusContent gateway={gatewayWith("ok")} fetchedAt={0} gatewayOrigin="https://gateway.test" />);
```

Then add one test inside the same `describe("public trust pages")` block, after the "reports gateway ok as ready" case (which ends at line 52):

```tsx
  it("points the machine-readable status link at the origin it actually fetched", () => {
    localized(<LiveStatusContent gateway={gatewayWith("ok")} fetchedAt={0} gatewayOrigin="https://gateway.test" />);
    expect(screen.getByRole("link", { name: /machine-readable status/i }))
      .toHaveAttribute("href", "https://gateway.test/status.json");
  });
```

A deliberately fake origin is used so the assertion fails if the component ever falls back to the hard-coded `https://b300.powerchampion.ai` again.

- [ ] **Step 10: Run the unit tests**

Run: `npx vitest run tests/metadata.test.ts tests/trust-pages.test.tsx`
Expected: PASS. `tests/metadata.test.ts` reports 6 tests; `tests/trust-pages.test.tsx` reports its Task 5 count plus 1.

- [ ] **Step 11: Update the server-render test**

In `tests/rendered-html.test.mjs`, change the `/contact` entry in `routeMetadata` (lines 66-69) to:

```js
  "/contact": {
    title: "Contact | Power Champion",
    description: "Review non-binding deployment interests locally in your browser.",
  },
```

And append one test at the end of the file:

```js
test("permanently redirects the legacy /about path to /company", async () => {
  const response = await render("/about");
  assert.equal(response.status, 308, "/about is gone for good, not moved temporarily");
  assert.match(
    response.headers.get("location") ?? "",
    /\/company$/,
    "/about points at the company page",
  );
});
```

The `Location` header may be absolutised against the request origin (vinext resolves redirect targets in `dist/server/app-page-execution.js`), which is why the assertion matches the suffix rather than the exact string. Before this task `/about` returns 404, so the assertion cannot pass by accident.

- [ ] **Step 12: Build and run the server-render test**

Run: `npm run build && node --test tests/rendered-html.test.mjs 2>&1 | tail -25`
Expected: build succeeds; all tests pass.

- [ ] **Step 13: Full verification**

Run: `npx vitest run 2>&1 | tail -15`
Expected: 0 failed. Test count is the Task 6 total plus 7.

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 14: Commit**

```bash
git add lib/metadata.ts app/about app/status/page.tsx components/live-status-content.tsx public/sitemap.xml tests/metadata.test.ts tests/trust-pages.test.tsx tests/rendered-html.test.mjs
git commit -m "fix(site): correct the contact title, derive the status.json link, index /console, redirect /about"
```

---

## Task 8: `public/openapi.json` — publish the gateway's OpenAPI 3.1 description

**Files:**
- Create: `public/openapi.json`
- Create: `tests/openapi.test.ts`
- Modify: `components/docs-page-content.tsx:87-100` (a link at the end of the endpoints section)
- Modify: `tests/docs-console.test.tsx` (one new test)

**Interfaces:**
- Consumes from Task 3: `COPY[locale].shared.openApiSpec` — `"OpenAPI specification"` (en) / `"OpenAPI 規格"` (zh). Task 3 added both keys and left `openApiSpec` unused; this task is where it gets used. If `copy.shared.openApiSpec` does not type-check, Task 3 was not applied — stop and report BLOCKED.
- Consumes from Task 3: `DocsPageContent({ gateway, models })`. Do not change that signature.
- Produces:
  - the static asset `/openapi.json`, served straight out of `public/`
  - `const GATEWAY_PUBLIC_PATHS: string[]` inside `tests/openapi.test.ts` — the pinned whitelist. It lives in the test on purpose: the marketing site cannot import from the gateway repo, so the list is a copy that a human re-checks against `app.py`.

**Scope note:** this file documents the *gateway* (`b300.powerchampion.ai`), but it is published from the *marketing site* (`powerchampion.ai/openapi.json`). That is deliberate — it is documentation, not a served API, and the Global Constraints forbid editing the gateway repo in this plan. Do not add a rewrite, a proxy, or a `worker/index.ts` route for it.

- [ ] **Step 1: Probe — which of these endpoints does the gateway actually serve?**

The spec lists `/v1/rerank` as conditional. Confirm it, and confirm the rest, before writing anything:

```bash
grep -n '"/v1/rerank"' /Users/optyne/repository/b300/sell-panel/.wt-siteinfo/app.py
grep -nE '@app\.(get|post)\("/(v1/[a-z/]+|status\.json|catalog\.json)"\)' /Users/optyne/repository/b300/sell-panel/.wt-siteinfo/app.py
```

How to read it:

- Command 1 prints a line only if `/v1/rerank` exists. **Verified 2026-09-10: it does — `app.py:2676` (`@app.post("/v1/rerank")`), with a second hit at `app.py:1639` where it appears in the endpoint table.** Keep the `/v1/rerank` block. If a future check comes back empty, delete the `/v1/rerank` entry from `public/openapi.json` **and** from `GATEWAY_PUBLIC_PATHS` in the test, and say so in the commit message.
- Command 2 should list `/v1/models`, `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/rerank`, `/v1/images/generations`, `/v1/audio/speech`, `/v1/audio/transcriptions` and `/status.json`. **`/catalog.json` will NOT appear — it does not exist yet.** That is expected: it is the sibling gateway plan's deliverable (see the Global Constraints). Document it anyway, exactly as the spec asks; the marketing site already ships a snapshot fallback for the same reason.
- The command also prints paths this file deliberately omits — `/v1/images` (an undocumented alias of `/v1/images/generations`), `/v1/personas/{persona_id}`, `/v1/redeem` and the billing endpoints. Those are not part of the OpenAI-compatible public surface the spec scopes, so they belong in neither the JSON nor the whitelist.

Reading this file is allowed by the Global Constraints ("read `app.py` and `config.yaml`"). Do not edit it.

- [ ] **Step 2: Write the failing test**

Create `tests/openapi.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The gateway's public OpenAI-compatible surface, copied here by hand on
 * 2026-09-10 from `@app.get`/`@app.post` decorators in
 * /Users/optyne/repository/b300/sell-panel/.wt-siteinfo/app.py.
 *
 * The marketing site cannot import from the gateway repo, so this is a pinned
 * copy, not a live read. Its job is to fail loudly when someone documents an
 * endpoint the gateway does not serve — publishing a path that 404s is worse
 * than publishing nothing. When the gateway genuinely gains an endpoint,
 * update this list in the same commit that adds it to public/openapi.json.
 *
 * /catalog.json is on the list ahead of the gateway shipping it: it is the
 * agreed contract (design spec §3.1) and the sibling gateway plan's
 * deliverable. Everything else was verified present.
 */
const GATEWAY_PUBLIC_PATHS = [
  "/v1/models",
  "/v1/chat/completions",
  "/v1/completions",
  "/v1/embeddings",
  "/v1/rerank",
  "/v1/images/generations",
  "/v1/audio/speech",
  "/v1/audio/transcriptions",
  "/status.json",
  "/catalog.json",
];

type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string };
  servers: { url: string }[];
  security: Record<string, string[]>[];
  paths: Record<string, Record<string, { operationId?: string; security?: unknown[] }>>;
  components: {
    securitySchemes: Record<string, { type: string; scheme?: string }>;
    schemas: Record<string, unknown>;
    responses: Record<string, unknown>;
  };
};

async function loadSpec(): Promise<{ raw: string; doc: OpenApiDocument }> {
  const raw = await readFile(resolve(process.cwd(), "public/openapi.json"), "utf8");
  return { raw, doc: JSON.parse(raw) as OpenApiDocument };
}

describe("public/openapi.json", () => {
  it("is parseable JSON declaring OpenAPI 3.1", async () => {
    const { doc } = await loadSpec();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Power Champion Gateway API");
  });

  it("points at the gateway, not at the marketing site", async () => {
    const { doc } = await loadSpec();
    expect(doc.servers).toHaveLength(1);
    expect(doc.servers[0].url).toBe("https://b300.powerchampion.ai");
  });

  it("documents only endpoints the gateway actually serves", async () => {
    const { doc } = await loadSpec();
    for (const path of Object.keys(doc.paths)) {
      expect(GATEWAY_PUBLIC_PATHS, `${path} is not on the gateway whitelist`).toContain(path);
    }
  });

  it("documents every OpenAI-compatible endpoint the spec listed", async () => {
    const { doc } = await loadSpec();
    for (const path of GATEWAY_PUBLIC_PATHS) {
      expect(Object.keys(doc.paths), `${path} is missing`).toContain(path);
    }
  });

  it("gives every operation a unique operationId", async () => {
    const { doc } = await loadSpec();
    const ids = Object.values(doc.paths)
      .flatMap((methods) => Object.values(methods))
      .map((operation) => operation.operationId);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("secures the API with a bearer key and leaves the public JSON open", async () => {
    const { doc } = await loadSpec();
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths["/status.json"].get.security).toEqual([]);
    expect(doc.paths["/catalog.json"].get.security).toEqual([]);
    // A protected endpoint must NOT opt out of the document-level requirement.
    expect(doc.paths["/v1/chat/completions"].post.security).toBeUndefined();
  });

  it("resolves every internal $ref", async () => {
    const { raw, doc } = await loadSpec();
    const defined = new Set([
      ...Object.keys(doc.components.schemas).map((k) => `schemas/${k}`),
      ...Object.keys(doc.components.responses).map((k) => `responses/${k}`),
    ]);
    const referenced = [...raw.matchAll(/#\/components\/(schemas|responses)\/([A-Za-z0-9_]+)/g)]
      .map((m) => `${m[1]}/${m[2]}`);
    expect(referenced.length).toBeGreaterThan(0);
    const dangling = [...new Set(referenced)].filter((ref) => !defined.has(ref));
    expect(dangling).toEqual([]);
  });

  it("describes the OpenAI-compatible request fields callers actually send", async () => {
    const { doc } = await loadSpec();
    const chat = doc.components.schemas.ChatCompletionRequest as {
      properties: Record<string, unknown>;
      required: string[];
    };
    for (const field of ["model", "messages", "stream", "max_tokens", "temperature", "top_p", "stop", "tools"]) {
      expect(Object.keys(chat.properties), `chat request is missing ${field}`).toContain(field);
    }
    expect(chat.required).toEqual(["model", "messages"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/openapi.test.ts`
Expected: FAIL — all 8 cases error with `ENOENT: no such file or directory ... public/openapi.json`.

- [ ] **Step 4: Write `public/openapi.json`**

Create `public/openapi.json` with exactly this content:

```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "Power Champion Gateway API",
    "version": "2026-09-09",
    "summary": "OpenAI-compatible inference for the open models Power Champion serves.",
    "description": "One OpenAI-compatible endpoint for text, vision, image, speech, embedding and reranking models. Authenticate with a bearer API key; usage is billed from a prepaid balance. Only the publicly documented subset of each request body is described here — the gateway forwards the OpenAI-compatible fields it recognises and ignores the rest.",
    "contact": {
      "name": "Power Champion",
      "email": "info@powerchampion.org",
      "url": "https://powerchampion.ai/contact"
    },
    "license": {
      "name": "Terms of service",
      "url": "https://powerchampion.ai/terms"
    }
  },
  "servers": [
    {
      "url": "https://b300.powerchampion.ai",
      "description": "Production gateway"
    }
  ],
  "security": [
    {
      "bearerAuth": []
    }
  ],
  "tags": [
    { "name": "Models", "description": "Discovery of the served catalogue." },
    { "name": "Text", "description": "Chat, completion and embedding endpoints." },
    { "name": "Image", "description": "Text-to-image generation." },
    { "name": "Audio", "description": "Text-to-speech and speech-to-text." },
    { "name": "Status", "description": "Unauthenticated machine-readable service data." }
  ],
  "paths": {
    "/v1/models": {
      "get": {
        "tags": ["Models"],
        "operationId": "listModels",
        "summary": "List the models this key may call.",
        "responses": {
          "200": {
            "description": "The served model list.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ModelList" }
              }
            }
          },
          "401": { "$ref": "#/components/responses/Unauthorized" }
        }
      }
    },
    "/v1/chat/completions": {
      "post": {
        "tags": ["Text"],
        "operationId": "createChatCompletion",
        "summary": "Chat, reasoning, coding and vision requests.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/ChatCompletionRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "A completion, or a text/event-stream of deltas when `stream` is true.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ChatCompletion" }
              },
              "text/event-stream": {
                "schema": {
                  "type": "string",
                  "description": "Server-sent events, each `data:` line carrying a chat.completion.chunk object, terminated by `data: [DONE]`."
                }
              }
            }
          },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/ModelNotAvailable" },
          "429": { "$ref": "#/components/responses/RateLimited" },
          "503": { "$ref": "#/components/responses/CapacityExhausted" }
        }
      }
    },
    "/v1/completions": {
      "post": {
        "tags": ["Text"],
        "operationId": "createCompletion",
        "summary": "Legacy prompt completion.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CompletionRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "A completion, or a text/event-stream of deltas when `stream` is true.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Completion" }
              }
            }
          },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/ModelNotAvailable" },
          "429": { "$ref": "#/components/responses/RateLimited" },
          "503": { "$ref": "#/components/responses/CapacityExhausted" }
        }
      }
    },
    "/v1/embeddings": {
      "post": {
        "tags": ["Text"],
        "operationId": "createEmbedding",
        "summary": "Embed text for retrieval.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/EmbeddingRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "One embedding per input.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/EmbeddingList" }
              }
            }
          },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/ModelNotAvailable" },
          "429": { "$ref": "#/components/responses/RateLimited" },
          "503": { "$ref": "#/components/responses/CapacityExhausted" }
        }
      }
    },
    "/v1/rerank": {
      "post": {
        "tags": ["Text"],
        "operationId": "createRerank",
        "summary": "Score documents against a query.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/RerankRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Documents ordered by relevance.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/RerankResponse" }
              }
            }
          },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/ModelNotAvailable" },
          "429": { "$ref": "#/components/responses/RateLimited" },
          "503": { "$ref": "#/components/responses/CapacityExhausted" }
        }
      }
    },
    "/v1/images/generations": {
      "post": {
        "tags": ["Image"],
        "operationId": "createImage",
        "summary": "Generate an image from a text prompt.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/ImageGenerationRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The generated image or images.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ImageGenerationResponse" }
              }
            }
          },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/ModelNotAvailable" },
          "429": { "$ref": "#/components/responses/RateLimited" },
          "503": { "$ref": "#/components/responses/CapacityExhausted" }
        }
      }
    },
    "/v1/audio/speech": {
      "post": {
        "tags": ["Audio"],
        "operationId": "createSpeech",
        "summary": "Synthesise speech from text.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/SpeechRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The synthesised audio. Billed tokens are returned in the X-Usage-Tokens response header.",
            "headers": {
              "X-Usage-Tokens": {
                "description": "Tokens billed for this request.",
                "schema": { "type": "integer" }
              }
            },
            "content": {
              "audio/mpeg": {
                "schema": { "type": "string", "format": "binary" }
              },
              "audio/wav": {
                "schema": { "type": "string", "format": "binary" }
              }
            }
          },
          "400": { "$ref": "#/components/responses/BadRequest" },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/ModelNotAvailable" },
          "429": { "$ref": "#/components/responses/RateLimited" },
          "503": { "$ref": "#/components/responses/CapacityExhausted" }
        }
      }
    },
    "/v1/audio/transcriptions": {
      "post": {
        "tags": ["Audio"],
        "operationId": "createTranscription",
        "summary": "Transcribe an uploaded audio file.",
        "requestBody": {
          "required": true,
          "content": {
            "multipart/form-data": {
              "schema": { "$ref": "#/components/schemas/TranscriptionRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The transcript.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Transcription" }
              },
              "text/plain": {
                "schema": { "type": "string" }
              }
            }
          },
          "401": { "$ref": "#/components/responses/Unauthorized" },
          "404": { "$ref": "#/components/responses/ModelNotAvailable" },
          "429": { "$ref": "#/components/responses/RateLimited" },
          "503": { "$ref": "#/components/responses/CapacityExhausted" }
        }
      }
    },
    "/status.json": {
      "get": {
        "tags": ["Status"],
        "operationId": "getStatus",
        "summary": "Machine-readable service status.",
        "security": [],
        "responses": {
          "200": {
            "description": "Current readiness and per-model uptime.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Status" }
              }
            }
          }
        }
      }
    },
    "/catalog.json": {
      "get": {
        "tags": ["Status"],
        "operationId": "getCatalog",
        "summary": "Machine-readable model catalogue with prices.",
        "security": [],
        "responses": {
          "200": {
            "description": "Every model on sale, with modalities, limits and prices.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Catalog" }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "Send your API key as `Authorization: Bearer <key>`."
      }
    },
    "responses": {
      "BadRequest": {
        "description": "The request body could not be parsed.",
        "content": {
          "application/json": { "schema": { "$ref": "#/components/schemas/Error" } }
        }
      },
      "Unauthorized": {
        "description": "Missing or invalid API key.",
        "content": {
          "application/json": { "schema": { "$ref": "#/components/schemas/Error" } }
        }
      },
      "ModelNotAvailable": {
        "description": "The requested model is not on sale, or is draining.",
        "content": {
          "application/json": { "schema": { "$ref": "#/components/schemas/Error" } }
        }
      },
      "RateLimited": {
        "description": "The key's rate or balance limit was exceeded.",
        "content": {
          "application/json": { "schema": { "$ref": "#/components/schemas/Error" } }
        }
      },
      "CapacityExhausted": {
        "description": "No replica was available to serve the request.",
        "content": {
          "application/json": { "schema": { "$ref": "#/components/schemas/Error" } }
        }
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "object",
            "properties": {
              "message": { "type": "string" },
              "type": { "type": ["string", "null"] },
              "param": { "type": ["string", "null"] },
              "code": { "type": ["string", "null"] }
            },
            "required": ["message"]
          }
        },
        "required": ["error"]
      },
      "Usage": {
        "type": "object",
        "properties": {
          "prompt_tokens": { "type": "integer" },
          "completion_tokens": { "type": "integer" },
          "total_tokens": { "type": "integer" }
        },
        "required": ["prompt_tokens", "total_tokens"]
      },
      "ModelList": {
        "type": "object",
        "properties": {
          "object": { "type": "string", "const": "list" },
          "data": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string", "examples": ["glm-5.2-fp8"] },
                "object": { "type": "string", "const": "model" },
                "created": { "type": "integer" },
                "owned_by": { "type": "string" }
              },
              "required": ["id", "object"]
            }
          }
        },
        "required": ["object", "data"]
      },
      "ChatMessage": {
        "type": "object",
        "properties": {
          "role": { "type": "string", "enum": ["system", "user", "assistant", "tool"] },
          "content": {
            "description": "Plain text, or an array of content parts for vision models.",
            "oneOf": [
              { "type": "string" },
              {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "type": { "type": "string", "enum": ["text", "image_url"] },
                    "text": { "type": "string" },
                    "image_url": {
                      "type": "object",
                      "properties": { "url": { "type": "string" } },
                      "required": ["url"]
                    }
                  },
                  "required": ["type"]
                }
              }
            ]
          },
          "name": { "type": "string" },
          "tool_call_id": { "type": "string" }
        },
        "required": ["role", "content"]
      },
      "ChatCompletionRequest": {
        "type": "object",
        "properties": {
          "model": { "type": "string", "examples": ["glm-5.2-fp8"] },
          "messages": {
            "type": "array",
            "minItems": 1,
            "items": { "$ref": "#/components/schemas/ChatMessage" }
          },
          "stream": { "type": "boolean", "default": false },
          "max_tokens": { "type": "integer", "minimum": 1 },
          "temperature": { "type": "number", "minimum": 0, "maximum": 2 },
          "top_p": { "type": "number", "minimum": 0, "maximum": 1 },
          "n": { "type": "integer", "minimum": 1, "default": 1 },
          "stop": {
            "oneOf": [
              { "type": "string" },
              { "type": "array", "items": { "type": "string" } }
            ]
          },
          "seed": { "type": "integer" },
          "presence_penalty": { "type": "number" },
          "frequency_penalty": { "type": "number" },
          "response_format": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "enum": ["text", "json_object", "json_schema"] },
              "json_schema": { "type": "object" }
            },
            "required": ["type"]
          },
          "tools": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": { "type": "string", "const": "function" },
                "function": {
                  "type": "object",
                  "properties": {
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "parameters": { "type": "object" }
                  },
                  "required": ["name"]
                }
              },
              "required": ["type", "function"]
            }
          },
          "tool_choice": {
            "oneOf": [
              { "type": "string", "enum": ["none", "auto", "required"] },
              { "type": "object" }
            ]
          }
        },
        "required": ["model", "messages"]
      },
      "ChatCompletion": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "object": { "type": "string", "const": "chat.completion" },
          "created": { "type": "integer" },
          "model": { "type": "string" },
          "choices": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "index": { "type": "integer" },
                "message": { "$ref": "#/components/schemas/ChatMessage" },
                "finish_reason": { "type": ["string", "null"] }
              },
              "required": ["index", "message"]
            }
          },
          "usage": { "$ref": "#/components/schemas/Usage" }
        },
        "required": ["id", "object", "model", "choices"]
      },
      "CompletionRequest": {
        "type": "object",
        "properties": {
          "model": { "type": "string" },
          "prompt": {
            "oneOf": [
              { "type": "string" },
              { "type": "array", "items": { "type": "string" } }
            ]
          },
          "stream": { "type": "boolean", "default": false },
          "max_tokens": { "type": "integer", "minimum": 1 },
          "temperature": { "type": "number", "minimum": 0, "maximum": 2 },
          "top_p": { "type": "number", "minimum": 0, "maximum": 1 },
          "stop": {
            "oneOf": [
              { "type": "string" },
              { "type": "array", "items": { "type": "string" } }
            ]
          }
        },
        "required": ["model", "prompt"]
      },
      "Completion": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "object": { "type": "string", "const": "text_completion" },
          "created": { "type": "integer" },
          "model": { "type": "string" },
          "choices": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "index": { "type": "integer" },
                "text": { "type": "string" },
                "finish_reason": { "type": ["string", "null"] }
              },
              "required": ["index", "text"]
            }
          },
          "usage": { "$ref": "#/components/schemas/Usage" }
        },
        "required": ["id", "object", "model", "choices"]
      },
      "EmbeddingRequest": {
        "type": "object",
        "properties": {
          "model": { "type": "string", "examples": ["bge-m3"] },
          "input": {
            "oneOf": [
              { "type": "string" },
              { "type": "array", "items": { "type": "string" } }
            ]
          },
          "encoding_format": { "type": "string", "enum": ["float", "base64"], "default": "float" }
        },
        "required": ["model", "input"]
      },
      "EmbeddingList": {
        "type": "object",
        "properties": {
          "object": { "type": "string", "const": "list" },
          "model": { "type": "string" },
          "data": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "object": { "type": "string", "const": "embedding" },
                "index": { "type": "integer" },
                "embedding": { "type": "array", "items": { "type": "number" } }
              },
              "required": ["object", "index", "embedding"]
            }
          },
          "usage": { "$ref": "#/components/schemas/Usage" }
        },
        "required": ["object", "data"]
      },
      "RerankRequest": {
        "type": "object",
        "properties": {
          "model": { "type": "string", "examples": ["bge-reranker-v2-m3"] },
          "query": { "type": "string" },
          "documents": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
          "top_n": { "type": "integer", "minimum": 1 },
          "return_documents": { "type": "boolean", "default": false }
        },
        "required": ["model", "query", "documents"]
      },
      "RerankResponse": {
        "type": "object",
        "properties": {
          "model": { "type": "string" },
          "results": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "index": { "type": "integer" },
                "relevance_score": { "type": "number" },
                "document": { "type": ["string", "null"] }
              },
              "required": ["index", "relevance_score"]
            }
          },
          "usage": { "$ref": "#/components/schemas/Usage" }
        },
        "required": ["results"]
      },
      "ImageGenerationRequest": {
        "type": "object",
        "properties": {
          "model": { "type": "string", "examples": ["flux-schnell"] },
          "prompt": { "type": "string" },
          "n": { "type": "integer", "minimum": 1, "default": 1 },
          "size": { "type": "string", "examples": ["1024x1024"] },
          "response_format": { "type": "string", "enum": ["b64_json", "url"], "default": "b64_json" }
        },
        "required": ["model", "prompt"]
      },
      "ImageGenerationResponse": {
        "type": "object",
        "properties": {
          "created": { "type": "integer" },
          "data": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "b64_json": { "type": "string" },
                "url": { "type": "string" },
                "revised_prompt": { "type": "string" }
              }
            }
          }
        },
        "required": ["data"]
      },
      "SpeechRequest": {
        "type": "object",
        "properties": {
          "model": { "type": "string", "examples": ["indextts2"] },
          "input": { "type": "string" },
          "voice": { "type": "string" },
          "response_format": { "type": "string", "enum": ["mp3", "wav"], "default": "mp3" },
          "speed": { "type": "number", "minimum": 0.25, "maximum": 4, "default": 1 }
        },
        "required": ["model", "input"]
      },
      "TranscriptionRequest": {
        "type": "object",
        "properties": {
          "file": { "type": "string", "format": "binary" },
          "model": { "type": "string", "examples": ["whisper-large-v3"] },
          "language": { "type": "string", "description": "ISO-639-1 code; omit to auto-detect." },
          "prompt": { "type": "string" },
          "response_format": { "type": "string", "enum": ["json", "text", "verbose_json"], "default": "json" },
          "temperature": { "type": "number", "minimum": 0, "maximum": 1 }
        },
        "required": ["file", "model"]
      },
      "Transcription": {
        "type": "object",
        "properties": {
          "text": { "type": "string" }
        },
        "required": ["text"]
      },
      "Status": {
        "type": "object",
        "properties": {
          "status": { "type": "string", "enum": ["ok", "warn", "down"] },
          "summary": { "type": "string" },
          "updated": { "type": "integer" },
          "uptime_window_days": { "type": "integer" },
          "models": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "name": { "type": ["string", "null"] },
                "ready": { "type": "boolean" },
                "context_length": { "type": ["integer", "null"] },
                "uptime": { "type": ["number", "null"] }
              },
              "required": ["id", "ready"]
            }
          }
        },
        "required": ["status", "summary", "updated", "uptime_window_days", "models"]
      },
      "Catalog": {
        "type": "object",
        "properties": {
          "updated": { "type": "string", "format": "date-time" },
          "models": {
            "type": "array",
            "items": { "$ref": "#/components/schemas/CatalogModel" }
          }
        },
        "required": ["updated", "models"]
      },
      "CatalogModel": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "modalities": {
            "type": "object",
            "properties": {
              "input": { "type": "array", "items": { "type": "string" } },
              "output": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["input", "output"]
          },
          "context_length": { "type": ["integer", "null"] },
          "max_output_length": { "type": ["integer", "null"] },
          "pricing": {
            "type": "object",
            "properties": {
              "unit": { "type": "string", "const": "per_million_tokens" },
              "prompt_usd": { "type": "number" },
              "completion_usd": { "type": "number" }
            },
            "required": ["unit", "prompt_usd", "completion_usd"]
          },
          "billing_note": { "type": ["string", "null"] },
          "ready": { "type": "boolean" },
          "uptime": { "type": ["number", "null"] }
        },
        "required": ["id", "name", "modalities", "pricing", "ready"]
      }
    }
  }
}
```

Two things not to "tidy up" while transcribing:

- `"type": ["string", "null"]` is valid OpenAPI **3.1** (it is JSON Schema 2020-12). Do not rewrite it as `"nullable": true`, which is the 3.0 spelling and would be wrong here.
- The `Catalog`/`CatalogModel` schemas mirror `CatalogPayload`/`CatalogModel` from `lib/catalog.ts` (Task 1) field for field. If Task 1's shape ever changes, change both.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/openapi.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Write the failing test for the `/docs` link**

Append to `tests/docs-console.test.tsx`, inside the existing top-level `describe("CodeSamples")` block (it is the block that already renders `DocsPageContent`), after the last `it(...)` in that block:

```tsx
  it("links to the published OpenAPI specification from the endpoint list", () => {
    render(<LocaleProvider><DocsPageContent gateway={null} models={SNAPSHOT_CATALOG} /></LocaleProvider>);

    const link = screen.getByRole("link", { name: "OpenAPI specification" });
    expect(link).toHaveAttribute("href", "/openapi.json");
    expect(within(screen.getByRole("region", { name: "Available endpoints" })).getByRole("link", { name: "OpenAPI specification" }))
      .toBe(link);
  });
```

Add `import { SNAPSHOT_CATALOG } from "../lib/models";` to that file's imports if Task 3 did not already add it (`grep -n 'SNAPSHOT_CATALOG' tests/docs-console.test.tsx`). `within` is already imported at line 1.

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run tests/docs-console.test.tsx -t "OpenAPI"`
Expected: FAIL — `Unable to find an accessible element with the role "link" and name "OpenAPI specification"`.

- [ ] **Step 8: Add the link to the docs page**

In `components/docs-page-content.tsx`, inside the `endpoints-title` section, immediately after the closing `</dl>` and before that section's closing `</section>`:

```tsx
        <p className="docs-guidance">
          <a href="/openapi.json">{copy.shared.openApiSpec}</a>
        </p>
```

`copy` is already in scope in this component (it comes from `useLocale()`), and `docs-guidance` is the class the other explanatory paragraphs in this file already use, so no CSS change is needed.

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run tests/docs-console.test.tsx`
Expected: PASS, the file's Task 3 count plus 1.

- [ ] **Step 10: Confirm the asset is actually served**

Run: `npm run build && ls -l dist/client/openapi.json && node -e "JSON.parse(require('node:fs').readFileSync('dist/client/openapi.json','utf8'));console.log('built copy parses')"`
Expected: the file exists in the build output and parses. Anything under `public/` is copied verbatim by the build; if it is missing, check that you created it under `public/` and not `app/`.

- [ ] **Step 11: Full verification**

Run: `npx vitest run 2>&1 | tail -15`
Expected: 0 failed. Test count is the Task 7 total plus 9.

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Run: `node --test tests/rendered-html.test.mjs 2>&1 | tail -20`
Expected: all assertions pass (the build from Step 10 is still current).

- [ ] **Step 12: Commit**

```bash
git add public/openapi.json tests/openapi.test.ts components/docs-page-content.tsx tests/docs-console.test.tsx
git commit -m "feat(docs): publish an OpenAPI 3.1 description of the gateway's public surface"
```

---

## Task 9: Final acceptance — run the suite, record the numeric anchors, hand off

**Files:**
- Create: `docs/superpowers/plans/2026-09-09-marketing-site-info-anchors.md` (the recorded pre-deploy values)
- Modify: nothing else. **This task writes no source code.** If a check fails, fix it in the task that owns the file and re-run this one from Step 1 — do not patch around a failure here.

**Interfaces:**
- Consumes: everything Tasks 1-8 produced.
- Produces: the anchors file, and the final report.

**Hard boundary — no deployment.** This task ends at "ready to deploy". Do **not** run any Dokploy action, docker build/push, `wrangler deploy`, `git push`, or branch merge. Deployment and its ordering (spec §10.4: marketing site first, gateway second) are the user's call, confirmed step by step with them. Say so explicitly in the final report.

- [ ] **Step 1: Confirm the tree is clean and on the right branch**

```bash
git status -sb
git log --oneline -9
```

Expected: branch `fix/site-info-2026-09-09`, no uncommitted changes, and nine commits on top of the base — one per task from Task 1 through Task 8, plus the plan file. If anything is uncommitted, the task that owns it did not finish; go back and commit it there.

- [ ] **Step 2: Run the unit suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: `0 failed`. The baseline before this plan was **140 passed across 16 files** (Global Constraints, verified at commit `2c1161d`); every task added tests, so the number must be strictly greater than 140 and no file may be skipped.

Record the exact `Tests  N passed (N)` line — it goes in the report.

- [ ] **Step 3: Run the type-checker and the linter**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -20`
Expected: no output from `tsc`, and eslint exits 0.

- [ ] **Step 4: Run the full gate exactly as CI does**

Run: `npm test 2>&1 | tail -30`

`npm test` is `vitest run && npm run build && node --test tests/rendered-html.test.mjs` (`package.json:12`). Expected: all three stages succeed. This is the single command spec §10.2 names, so its output is what the report quotes.

- [ ] **Step 5: Prove the Accept-Language acceptance case specifically**

Run: `node --test tests/rendered-html.test.mjs 2>&1 | grep -A3 "Traditional Chinese"`
Expected: `ok ... server-renders Traditional Chinese for a zh-TW browser`.

This is spec §10.2's third clause and Task 6's acceptance condition; quote the line rather than the aggregate pass count, because an aggregate hides a skipped test.

- [ ] **Step 6: Scan the built HTML for placeholders that must never ship**

```bash
node --test tests/rendered-html.test.mjs 2>&1 | grep -E "policies without placeholders|not ok" | head
npx vitest run tests/legal-pages.test.tsx 2>&1 | tail -5
grep -rn "yourdomain\|TBD" lib/trust.ts public/openapi.json || echo "no placeholder tokens in source"
```

Expected: the Task 5 placeholder test passes, `tests/legal-pages.test.tsx` is green, and the grep prints the "no placeholder tokens" line. A hit from the grep is a blocker, not a warning.

- [ ] **Step 7: Record the pre-deploy numeric anchors**

These are the values that must still be true **after** deployment (spec §10.3). Capture them now, from the local build, so the post-deploy check has something to compare against instead of a memory.

```bash
grep -n 'export const CATALOG_SNAPSHOT_DATE' lib/catalog.ts
awk '/catalog-snapshot:start/,/catalog-snapshot:end/' lib/catalog.ts | grep -c '^    id: '
npx vitest run tests/catalog.test.ts tests/unit.test.ts 2>&1 | tail -5
curl -s --max-time 6 https://b300.powerchampion.ai/catalog.json | head -c 200; echo
curl -s --max-time 6 https://b300.powerchampion.ai/status.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print("status models:", len(d["models"]), "unavailable:", sum(1 for m in d["models"] if not m["ready"]))'
grep -c "<loc>" public/sitemap.xml
```

The `/catalog.json` curl is **expected to fail or 404 today** — the gateway has not shipped it (Global Constraints). That is the anchor's starting state, not an error: it means the site is serving `CATALOG_SNAPSHOT` and every catalogue page must be showing the snapshot notice.

Create `docs/superpowers/plans/2026-09-09-marketing-site-info-anchors.md`:

```markdown
# Post-deploy numeric anchors — marketing site, 2026-09-09

Recorded before deploying. Each row is checked again after the marketing-site
deploy, and again after the gateway deploy (spec §10.3, §10.4). A mismatch is a
rollback trigger, not a "look into it later".

| # | Anchor | How to check after deploy | Expected |
|---|---|---|---|
| 1 | Model count on `/models` | count the model cards on `https://powerchampion.ai/models` | equals `curl -s https://b300.powerchampion.ai/catalog.json \| jq '.models \| length'`; while `/catalog.json` is absent, equals `CATALOG_SNAPSHOT.length` (9) **and** the snapshot notice is visible |
| 2 | Snapshot notice | visible text on `/models`, `/pricing`, `/` | present while the catalogue is a snapshot; **gone** once the gateway serves `/catalog.json` |
| 3 | Every price on `/pricing` | compare each row against the catalogue | token models: `prompt_usd` / `completion_usd` verbatim; image models: `completion_usd / 1000` per image; audio: `completion_usd * 3 / 1000` per minute (Global Constraints) |
| 4 | `/status` unavailable count | count rows labelled unavailable | equals `curl -s https://b300.powerchampion.ai/status.json \| jq '[.models[] \| select(.ready == false)] \| length'` |
| 5 | `/status` machine-readable link | the link at the foot of the model table | `href` is `https://b300.powerchampion.ai/status.json` |
| 6 | `/contact` title | `curl -s https://powerchampion.ai/contact \| grep -o '<title>[^<]*'` | `Contact \| Power Champion` |
| 7 | Sitemap routes | `curl -s https://powerchampion.ai/sitemap.xml \| grep -c '<loc>'` | 14 entries, including `/console` and `/data-retention`, and **no** `/about` |
| 8 | `/about` redirect | `curl -sI https://powerchampion.ai/about` | `308`, `Location` ending `/company` |
| 9 | Legal pages clean | fetch `/privacy`, `/terms`, `/data-retention` | each contains `Power Champion Investment Limited`, `Effective 2026-09-09`, `info@powerchampion.org`; none contains `TBD`, `yourdomain`, or an `https://...powerchampion.org` URL |
| 10 | Locale | `curl -s -H 'Accept-Language: zh-TW' https://powerchampion.ai/ \| grep -o '<html[^>]*lang="[^"]*"'` | `lang="zh-Hant"`, and the body carries `取得 API 存取` |
| 11 | OpenAPI | `curl -s https://powerchampion.ai/openapi.json \| jq '.servers[0].url, (.paths \| keys \| length)'` | `"https://b300.powerchampion.ai"` and `10` |

## Values recorded before deploy

- `npm test`: <paste the `Tests  N passed` line and the node --test summary>
- `/catalog.json` reachable: <yes/no — expected "no" until the gateway plan ships>
- `/status.json` model count / unavailable count: <paste>
- `<loc>` count in `public/sitemap.xml`: <paste>
- `CATALOG_SNAPSHOT.length` / `CATALOG_SNAPSHOT_DATE`: <paste>
```

Fill every `<paste>` with the real command output before committing the file. An anchors file with unfilled placeholders is worse than none — it reads as verified when it is not.

- [ ] **Step 8: Commit the anchors**

```bash
git add docs/superpowers/plans/2026-09-09-marketing-site-info-anchors.md
git commit -m "docs: record the pre-deploy numeric anchors for the site-info work"
```

- [ ] **Step 9: Write the final report and stop**

The report must contain, in this order:

1. One sentence: complete / partially complete, and the branch name.
2. The literal output of `npm test`'s three stages (trimmed to the summary lines).
3. Per task (1-8), one line: what shipped and its commit hash.
4. The anchors file path.
5. **The deployment sentence, verbatim:** "Nothing has been deployed and nothing has been pushed. Deployment order is marketing site first, gateway second (spec §10.4); both steps need your confirmation before anyone runs them."
6. Anything cut from scope, and why.

Do not offer to deploy. Do not push the branch. Do not open a PR unless the user asks.

---

## Spec coverage self-audit

Every requirement in the design spec that falls inside this plan's scope, mapped to
the task that implements it. Checked against
`/Users/optyne/repository/b300/sell-panel/.wt-siteinfo/docs/superpowers/specs/2026-09-09-website-info-consistency-design.md`
on 2026-09-10.

### §3.2 — Marketing site consumes the catalogue

| Spec requirement | Task |
|---|---|
| `lib/catalog.ts` with `fetchCatalog()`, 4 s timeout, `revalidate: 60`, `CatalogResult` | Task 1 |
| `lib/models.ts` split into `MODEL_PRESENTATION` + `CATALOG_SNAPSHOT` + `ModelDefinition` | Task 2 |
| Merge rule: iterate gateway models, default presentation by modality, presentation-only ids not rendered | Task 2 (`mergeCatalog`, `billingUnitFor`, `unitPriceFor`) |
| `available` on a card = `ready`; `/models`, `/pricing`, home list and proof strip all derive from the same array; proof strip counts `ready` | Task 3 |
| Snapshot notice, both locales, literal `{date}` token | Task 3 (`shared.catalogSnapshotNotice`) |
| Components changed + pages become async server components + `revalidate = 60` | Task 3 |
| `scripts/sync-catalog-snapshot.mjs` + its unit test | Task 4 |
| Tests: mocked live payload, snapshot fallback on reject/timeout, proof-strip numbers, `ready: false` renders "unavailable" | Tasks 1 and 3 |

### §4 — `glm-5.3-flash-uncensored` (presentation half only)

| Spec requirement | Task |
|---|---|
| `MODEL_PRESENTATION` entry: category general, tier fast, capability flags | Task 2 |
| `notice` key on `ModelPresentation`, surfaced as `ModelDefinition.notice` | Task 2 |
| The notice rendered on the model card in both locales, plus `.marketplace-model-notice` styling | Task 3 |
| Test: the model renders with its usage note | Task 3 |

**Out of this plan (gateway repo):** the `config.yaml` `description` field for this model. It belongs to the sibling gateway plan, and the Global Constraints forbid editing `sell-panel/` here. The site does not depend on it: `mergeCatalog` renders `description` from whatever `/catalog.json` returns, so the text appears on the site the moment the gateway ships it, with no marketing-site change.

### §5 — Legal texts

| Spec requirement | Task |
|---|---|
| English texts ported from `app.py:2149-2258` into `POLICY_CONTENT.en` as structured sections | Task 5 |
| Third policy `dataRetention` + route `app/data-retention/page.tsx` via `EditorialPage` | Task 5 |
| Traditional Chinese translation of the same sections | Task 5 |
| Constants `LEGAL_EFFECTIVE_DATE` / entity / contact / gateway host replacing all placeholders | Task 5 |
| Test greps rendered policy text for `[`, `TBD`, `yourdomain`, `.org` URLs (mail address allowed) | Task 5 (`tests/legal-pages.test.tsx` for `[` against rendered text; `tests/rendered-html.test.mjs` for the rest against HTML) |
| Cross-links privacy ↔ data-retention ↔ terms; footer gains "Data retention" | Task 5 |
| `sitemap.xml` gains `/data-retention` | Task 5 |

### §7 — Locale

| Spec requirement | Task |
|---|---|
| Cookie `pc-locale`, `SameSite=Lax`, one year, written on toggle alongside `localStorage` | Task 6 (`writeLocaleCookie`, called only from `setLocale`) |
| Server-side initial locale in `app/layout.tsx`: cookie → `Accept-Language` → `en` | Task 6 (`resolveInitialLocale`, Step 11a) |
| `initialLocale` passed to `LocaleProvider`; used for the first render; `<html lang>` set on the server | Task 6 |
| `detectLocale()` order becomes cookie → localStorage → navigator | Task 6 (plus a fourth step, `fallback`, so `initialLocale` has an effect) |
| Existing `tests/locale-detection.test.tsx` keeps passing; new tests for cookie precedence and `initialLocale` | Task 6 (Steps 6-10) |
| Fallback path if vinext cannot read request headers in the layout | Task 6 Step 11b (probe in Step 1 decides; probed 2026-09-10 as Path A) |
| Acceptance: `Accept-Language: zh-TW` → `<html lang="zh-Hant">` + Chinese first paint | Task 6 Step 13, re-checked in Task 9 Step 5 |

### §8 — Metadata and small fixes

| Spec requirement | Task |
|---|---|
| `/contact` title → "Contact \| Power Champion" | Task 7 |
| `/status` link → `${GATEWAY_ORIGIN}/status.json` | Task 7 |
| `sitemap.xml` adds `/console` (and `/data-retention`); `/about` deliberately absent | Task 7 (`/console`, absence test) + Task 5 (`/data-retention`) |
| `app/about/page.tsx` permanent redirect to `/company` | Task 7 |
| `public/openapi.json`, OpenAPI 3.1, servers `https://b300.powerchampion.ai`, the ten listed paths, bearer scheme, OpenAI-compatible subset | Task 8 |
| `/v1/rerank` included only if it exists in `app.py` | Task 8 Step 1 (probed 2026-09-10: it exists at `app.py:2676`, so it is included) |
| `/docs` gains an "OpenAPI specification" link | Task 8 |
| A test parses the file and checks every path against a whitelist copied into the test | Task 8 (`GATEWAY_PUBLIC_PATHS`) |

### §10.2 — Marketing verification

| Spec requirement | Task |
|---|---|
| `npm test` green | Task 9 Step 4 |
| `npm run build` succeeds | Task 9 Step 4 (second stage of `npm test`) |
| Rendered-HTML test for `Accept-Language: zh-TW` | Task 6 Step 13; re-asserted in Task 9 Step 5 |
| Numeric anchors recorded before deploy (§10.3) | Task 9 Step 7 |

### Known gaps — deliberate, and where they live instead

1. **§3.1 `/catalog.json` gateway endpoint** — not in this plan. The Global Constraints scope this plan to the marketing site; the endpoint is the sibling gateway plan's first deliverable. The site ships a snapshot fallback plus a visible notice precisely so it can go first (spec §10.4a).
2. **§4 `config.yaml` description** — gateway repo, sibling plan. Explained above.
3. **§6 gateway redirects** — gateway repo, sibling plan. Note that Task 7's `/about` → `/company` redirect is the *marketing site's* own legacy path, which is a different thing from the gateway's `/about` → `https://powerchampion.ai/company` 301 in §6. Both are needed; only the first is in this plan.
4. **§9 sell-panel cleanup (`git rm -r site/`)** — gateway repo, sibling plan.
5. **§10.1 gateway acceptance** (`python3 -m unittest discover -s tests -q`, `curl /catalog.json`, `curl -sI /about`) — runs against the gateway; belongs to the sibling plan's final task.
6. **§10.4 rollout and §10.5 rollback** — user-confirmed operations, deliberately outside every task. Task 9 Step 9 states this in the handoff report.
7. **§11 non-goals** — nothing in this plan redesigns a page, changes a price or the model set, exposes FastAPI's generated OpenAPI (the hand-written `public/openapi.json` is a static description, not a generated one), or translates admin pages.

**One reconciled discrepancy:** spec §10.2 says "140 tests fail before any change" because of a jsdom `localStorage` problem. That was already fixed before this plan was written — `tests/setup.ts:44-55` carries the polyfill, and the Global Constraints record the verified baseline as **140 passed, 16 files** at commit `2c1161d`. Read §10.2's parenthetical as historical. Task 6 Step 6 edits that same `afterEach` block; do not remove the storage polyfill while you are in there.
