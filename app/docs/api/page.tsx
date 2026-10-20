import { ApiReferenceContent } from "../../../components/api-reference-content";
import { fetchGatewayStatus, type GatewayStatus } from "../../../lib/gateway-status";
import { metadataForRoute } from "../../../lib/metadata";

export const metadata = metadataForRoute("/docs/api");

// The models table shows live readiness from the gateway's status feed.
export const revalidate = 60;

export default async function ApiReferencePage() {
  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null;
  }
  return <ApiReferenceContent gateway={gateway} />;
}
