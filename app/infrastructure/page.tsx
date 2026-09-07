import { InfrastructureContent } from "../../components/infrastructure-content";
import { fetchGatewayStatus, type GatewayStatus } from "../../lib/gateway-status";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/infrastructure");

// The serving stage's readiness label follows the gateway's live status,
// same feed as /status (unreachable → "Not verified", never a static claim).
export const revalidate = 60;

export default async function InfrastructurePage() {
  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null;
  }
  return <InfrastructureContent gateway={gateway} />;
}
