# Playground refinement — 2026-09-23

This update brings the existing API workbench closer to the graphite and champagne brand presentation while improving its actual request workflow. It remains a single-turn text tool for the existing GLM and Qwen catalog entries. Tool copy is English and Traditional Chinese; the five-language public homepage is unchanged.

## Delivered

- Three fill-only prompt scenarios: compare deployment trade-offs, review asynchronous JavaScript, and extract structured project data. Loading a scenario does not call the model or replace custom system settings.
- Readiness guidance, character counts, collapsed advanced settings, and mobile layouts with usable field sizes.
- Motion feedback on scenario controls, language selection, response transitions, and a rotating request indicator. Reduced-motion and hidden-document policy stops movement while preserving response state and focus.
- Response copy and measured client request time. A completed answer retains the model that actually generated it when the next request's model selector changes.
- Keyboard-accessible cURL, Python standard-library, and Node.js code tabs. Generated requests reflect current settings and obtain credentials from `POWERCHAMPION_API_KEY` at execution time.

## Correctness fixes

- Prevented the native Cancel click from submitting again when React reuses its button node as the Send button. Browser verification reproduced a second request before the fix; afterward the request count stayed at one through cancellation.
- Kept expanded reasoning and focus intact when motion availability changes.
- Ignored late clipboard success/failure after settings, language, request, or copy operation changes.
- Redacted the current key from raw prompt/system values before code serialization, including quote and backslash credentials. Response text is also scrubbed before display/copy.

## Verification

- ESLint and TypeScript passed.
- Full `npm test` passed: 367 unit tests in 40 files, production build, and 20 built-server rendering tests.
- Generated cURL, Python, and JavaScript were executed with intercepted network boundaries; Unicode, quotes, newlines, shell-like text, settings, and environment-only credentials were checked.
- Browser checks confirmed scenario selection makes no request, actual Motion transform changes while waiting, cancellation leaves one request, the next explicit Send makes the second request, and old results retain their original model. Keyboard arrows moved between code languages.
- Real browser reduced-motion emulation stopped the request animation. Returning to the normal preference restored the policy. Visibility state preservation is covered by the component regression test.
- English and Traditional Chinese layouts checked at 320, 390, 768, and 1440px, including expanded advanced settings and long generated code. No page-level horizontal overflow.

Browser response verification used clearly marked local UI fixtures and synthetic keys. No real model gateway request or paid inference was performed. The fixture override was removed by reloading the test page. Screenshots and measurements are in ignored `outputs/playground-refinement/`.

Preview: `http://localhost:3012/playground`. No deployment was performed.
