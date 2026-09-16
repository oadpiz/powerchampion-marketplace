/**
 * Cloudflare Web Analytics: page-view counts with no cookie, no cross-site
 * identifier and no per-person profile. The beacon is opt-in per deployment
 * and is only rendered on public pages.
 */
export const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/** A site token as issued by Cloudflare; anything else disables the beacon. */
export function webAnalyticsToken(value = process.env.WEB_ANALYTICS_TOKEN): string | null {
  const token = value?.trim();
  return token && /^[a-f0-9]{32}$/i.test(token) ? token : null;
}
