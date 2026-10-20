import type { GatewayStatus } from "./gateway-status";

/** The text model the homepage features when no live status is available. */
export const DEFAULT_FEATURED_TEXT_MODEL_ID = "glm-5.2-fp8";

/** Text models the homepage may feature, most preferred first. */
export const FEATURED_TEXT_MODEL_PREFERENCE: readonly string[] = [
  "glm-5.2-fp8",
  "glm-5.3-flash-uncensored",
  "qwen3-vl-30b",
];

/**
 * Picks the text model the homepage hero and featured grid should show.
 *
 * - Returns the first preferred model the gateway reports as ready.
 * - If none is ready, returns the first preference (never blank).
 * - If the status feed is unavailable, returns the default model.
 */
export function pickFeaturedTextModel(
  status: Pick<GatewayStatus, "models"> | null | undefined,
  preference: readonly string[] = FEATURED_TEXT_MODEL_PREFERENCE,
): string {
  if (!status || !Array.isArray(status.models)) return DEFAULT_FEATURED_TEXT_MODEL_ID;
  const ready = new Set(
    status.models.filter((model) => model?.ready === true).map((model) => model.id),
  );
  return preference.find((id) => ready.has(id)) ?? preference[0] ?? DEFAULT_FEATURED_TEXT_MODEL_ID;
}
