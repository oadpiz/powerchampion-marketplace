# Video model listing (`wan2.2-ti2v-5b-720p`) on powerchampion.ai

**Goal:** List the Wan 2.2 TI2V-5B video generation model and its price (US$0.05 per output second) on `/models`, `/models/[modelId]`, `/pricing`, `/compare`, `/integrations`, the regional (zh-Hant / ja / ko) catalog pages, structured data, the sitemap, and the `/docs/api` developer guide.

> **MERGE ORDER: merge only after the gateway reports the model enabled and smoke-tested.**
> The gateway config entry (`enabled: false` today) must be switched on by the owner, `GET /v1/models` must list it with `output_modalities` containing `video`, and `scripts/video_smoke.sh` must pass. Merging this branch to `main` auto-deploys the marketing site. This branch is local only: no push, no PR.

**Facts (source: gateway `docs/api-videos.md` and the `wan2.2-ti2v-5b-720p` entry in gateway `config.yaml`; quote, do not extend):** text-to-video and image-to-video; MP4 1280×704 at 24 fps, fixed; 1–10 s per clip (integer `seconds`, default 5); US$0.05 per output second, billed on actual output length capped at 1.1× the requested seconds (5 s = 121 frames ≈ 5.04 s ≈ US$0.252); reservation of requested seconds × 1.1 at submit, difference refunded on completion; failed, timed-out, or queued-cancelled jobs are not charged; async API `POST /v1/videos` (202) → `GET /v1/videos/{id}` (poll about every 5 s) → `GET /v1/videos/{id}/content` (MP4, supports `Range`); `DELETE /v1/videos/{id}` cancels only `queued` jobs; downloads available at least 24 h (see `expires_at`), expired jobs return 410, job records removed about 7 days later (404); prompt ≤ 2000 chars, image ≤ 6,000,000 bytes decoded (413), max 4 concurrent video jobs per key; `negative_prompt` is accepted but currently ignored; listing on `GET /v1/models` is the authority for availability. Apache-2.0 open weights (task brief).

## Design decisions

- **Catalog type** (`lib/models.ts`): add category `"video"`. Keep the existing per-unit convention (image 0.01, audio 0.03 are stored in `inputPerMillion`): the video entry stores `inputPerMillion: 0.05` with `outputPerMillion: 0`, and every consumer gets an explicit video branch meaning "per second". This keeps the `inputPerMillion > 0` catalog invariant test valid. No shared billing helper is introduced; each consumer already has its own image/audio branch and gets a video branch next to it.
- Home page (`home-content.tsx`) is intentionally not changed: it shows fixed featured IDs plus category filters, and the video model is in none of them, so it does not appear there. (Owner may want it under "Image & audio".)
- `available: true` and provenance `live`, consistent with the catalog invariant tests. This is why the merge-order note above matters.

## Files to change

1. `lib/models.ts` — `ModelCategory` gains `"video"`; new catalog entry `wan2.2-ti2v-5b-720p` (name "Wan 2.2 TI2V-5B 720p"; maxOutput "10 s video"; context "—"; speed "Deep"; features all false).
2. `lib/content.ts` — `copy.models.video` (en "Video", zh "影片") and `copy.shared.perSecond` (en "per second of video", zh "每秒影片").
3. `lib/international-content.ts` — `modelDescriptions` entry for the new model in zh-Hant, ja, ko; `catalog.second` unit string in all three (type + values).
4. `components/model-marketplace.tsx` — add the `video` filter chip, label, and a "video" billing mode rendering `$0.05 per second of video`.
5. `components/pricing-page-content.tsx` — rate-table row `$0.05 per second of video` (English) / `每秒影片` (zh); billing explanation sentence mentions video.
6. `components/pricing-calculator.tsx` — media note names the right unit for video.
7. `components/model-detail-content.tsx` — `MODEL_GUIDES` entry (endpoint `/v1/videos`, input/output, use cases, integration note incl. async flow and refund rule), `isVideo` unit, output label.
8. `components/model-comparison.tsx` and `lib/model-comparison.ts` — `billingKind` "video", a "seconds of video" usage field, cost = seconds × rate, unit labels.
9. `components/international-site.tsx` — `ModelPrice` unit for video (regional catalog and pricing pages).
10. `lib/structured-data.ts` — `unitText` "second of video".
11. `lib/integration-examples.ts` and `components/integration-builder.tsx` — `kind: "video"` (endpoint `/videos`, payload `{model, prompt, seconds}`), curl / Python `httpx` / JS `fetch` samples (submit plus pointer to polling), no OpenAI-SDK install hint for video.
12. `lib/api-reference.ts` — `/docs/api` guide (en + zh): capability row, models-section video table, new section "9. Video generation API" (renumber old 9–13 to 10–14 and fix the two cross-references), appendix endpoint rows, a billing-section pointer, intro sentence; remove "Video generation" from the appendix "not currently supported" list (it is now supported). Version/date stamp (1.0, 2026-10-20) is left for the owner to bump at merge time. Does not touch `API_REFERENCE_MODEL_IDS` / live-status tables (the video model is not in the live status feed).
13. `components/docs-page-content.tsx` — `POST /v1/videos` row in the endpoint list.
14. `public/sitemap.xml` — regenerate with `npm run seo:sitemap` (adds `/models/wan2.2-ti2v-5b-720p`; 47 → 48 URLs).
15. Tests: `tests/seo.test.ts` (48 URLs), `tests/marketplace.test.tsx`, `tests/structured-data.test.ts`, `tests/model-detail.test.tsx`, `tests/pricing.test.tsx`, `tests/platform-tools.test.tsx` (new `seconds` field), `tests/api-reference.test.tsx` (14 sections; video no longer unsupported), `tests/rendered-html.test.mjs` (14 sections; `/models` and `/pricing` SSR show `$0.05 per second of video`), and a new `tests/video-model.test.tsx` (catalog, marketplace, detail page en/zh, calculator, compare, integration samples, regional pages, structured data, API guide section).

## Copy (mirrors how existing models are described; factual, no claims beyond the gateway doc)

- tagline en: "Text-to-video and image-to-video. 1280×704 at 24 fps, 1–10 second clips through an async job API." / zh: "文生影片與圖生影片，1280×704、24 fps，單支 1–10 秒，以非同步任務 API 提供。"
- servingRole en: "Short text-to-video and image-to-video clips from open-weight Wan 2.2 TI2V-5B (Apache-2.0)." / zh: "以開放權重的 Wan 2.2 TI2V-5B（Apache-2.0）生成短影片，支援文生影片與圖生影片。"
- price display: `$0.05 per second of video` / `$0.05 每秒影片`; en units on regional pages: ja `動画 1 秒あたり`, ko `영상 1초당`, zh-Hant `每秒影片`.
- Billing sentence on `/pricing`: "Video models bill per second of output video." / "影片模型依每秒輸出影片計費。"

## Verification

- Baseline on `origin/main` (`35d0821`), recorded before any change: `npx tsc --noEmit` 0 errors; `npx eslint .` 0 problems; `npx vitest run` 46 files / 487 tests pass. After the change the counts must not exceed 0 / 0 and tests must all pass.
- Render check: vitest component tests render `/models`, `/pricing`, regional catalog, detail page and assert the `$0.05` plus unit text; `npm run build` then `node --test tests/rendered-html.test.mjs` (24 pass) checks the server-rendered HTML of `/models` and `/pricing`.
- After the change: tsc 0 errors, eslint 0 problems, vitest 47 files / 502 tests pass, build OK, rendered-html 24/24.
- Never `git add tsconfig.tsbuildinfo`.
