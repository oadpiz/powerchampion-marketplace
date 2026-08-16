/**
 * Server-side reader for the b300 gateway's public /status.json.
 *
 * The marketplace and the API gateway are separate deployments; this module is
 * the single integration point between them. Machine-readable status stays the
 * gateway's job — this just renders it, so the numbers on the marketing site
 * can never disagree with what the API is actually reporting.
 *
 * Fetches happen server-side (no CORS is published on the gateway) with a
 * short timeout so a slow gateway degrades to static readiness rows instead
 * of hanging the page.
 */

export type GatewayModelStatus = {
  id: string;
  name: string | null;
  ready: boolean;
  context_length: number | null;
  uptime: number | null;
};

export type GatewayStatus = {
  status: "ok" | "warn" | "down";
  summary: string;
  updated: number;
  uptime_window_days: number;
  models: GatewayModelStatus[];
};

const GATEWAY_ORIGIN =
  process.env.GATEWAY_ORIGIN ?? "https://b300.powerchampion.ai";

export async function fetchGatewayStatus(): Promise<GatewayStatus> {
  const res = await fetch(`${GATEWAY_ORIGIN}/status.json`, {
    // Status JSON is no-store on the gateway; revalidate here every request
    // but let Next dedupe within a render pass.
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    throw new Error(`gateway status ${res.status}`);
  }
  const data = (await res.json()) as GatewayStatus;
  return data;
}
