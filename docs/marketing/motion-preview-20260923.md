# Promotional Motion preview — 2026-09-23

The public brand homepage and agent gallery now use Motion 13.4.0. The graphite and champagne visual system, model/API positioning, GPU service, existing routes, and five homepage languages remain in place.

## Experience

- Hero: staggered entrance, layered model core, pointer-driven spring tilt, floating layers, orbit and light effects, and model selection transitions.
- Agent showcase: research, operations, and document scenarios with four manually selectable stages, animated source connections, a sample deliverable, and human review. Autoplay runs only while the scene is visible and motion is enabled; manual selection pauses it.
- Existing homepage sections use Motion for scroll reveals. Keyboard focus reveals content immediately.
- The showcase is explicitly an illustrative capability walkthrough. It does not submit model requests or represent a live customer task.

## Playback and accessibility

Server HTML contains readable content before JavaScript. Manual pause, system reduced-motion preference, and document visibility feed a shared reactive playback policy. Hero timelines pause offscreen; the showcase stops its timer and ambient animation offscreen. Controls remain usable without autoplay.

Motion caches `MotionConfig.reducedMotion` when visual elements mount. The config is therefore stable, while the shared policy explicitly controls timelines and transition durations. This avoids incorrectly freezing transforms after hydration. The showcase replaces only its decorative artwork when the policy changes to cancel an in-flight transition while retaining control focus and selected stage.

## Verification

- ESLint and TypeScript: passed.
- Frontend unit tests: 353 passed across 39 files, including playback policy, keyboard focus, manual takeover, and all five showcase languages.
- Production build: passed. Vinext still prints its existing static route-classification notice.
- Built server rendering: 20 tests passed, including meaningful static showcase content on all five homepages.
- Browser: 320px homepages in English, Traditional Chinese, Simplified Chinese, Japanese, and Korean have no horizontal page overflow. Agent gallery checked at 320px and 1440px. Traditional Chinese artwork also visually checked at 390px.
- Actual hero transform samples changed over 600ms, then remained identical over 500ms after pause; pointer input changed core rotation.
- Actual showcase transform samples confirmed floating artwork and stage interpolation. Mid-transition global pause and OS reduced-motion changes stopped movement and retained the selected stage.
- Document visibility was tested with a simulated visibility event, not an operating-system background-tab transition.
- Review found and fixed a queued scroll observer that could re-hide keyboard-focused content. Responsive verification also found and fixed an existing agent capability grid expanding to a code block's intrinsic width; code retains its own internal scrolling.

Local screenshots and measurement JSON are in ignored `outputs/promo-motion/`. Preview: `http://localhost:3012/`; Traditional Chinese: `http://localhost:3012/zh-Hant`.

This is a local preview on `codex/agent-runtime-20260922`. No production deployment or live model execution was performed for this promotional update.
