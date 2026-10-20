import { DocsPageContent } from "../../components/docs-page-content";
import { fetchGatewayStatus, type GatewayStatus } from "../../lib/gateway-status";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/docs");

// The service-status line summarizes the gateway's live status.
export const revalidate = 60;

export default async function DocsPage() {
  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null;
  }
  return <DocsPageContent gateway={gateway} />;
}
