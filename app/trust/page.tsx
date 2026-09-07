import { TrustContent } from "../../components/trust-content";
import { fetchGatewayStatus, type GatewayStatus } from "../../lib/gateway-status";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/trust");

// Readiness rows must reflect the gateway, so this page reads the same live
// feed as /status (gateway unreachable falls back to "Not verified" rows
// instead of claiming readiness).
export const revalidate = 60;

export default async function TrustPage() {
  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null;
  }
  return <TrustContent gateway={gateway} />;
}
