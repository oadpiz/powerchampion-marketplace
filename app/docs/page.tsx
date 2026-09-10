import { DocsPageContent } from "../../components/docs-page-content";
import { fetchCatalog } from "../../lib/catalog";
import { fetchGatewayStatus, type GatewayStatus } from "../../lib/gateway-status";
import { metadataForRoute } from "../../lib/metadata";
import { mergeCatalog } from "../../lib/models";

export const metadata = metadataForRoute("/docs");

// Release gates track the gateway's live status rather than a static claim.
export const revalidate = 60;

export default async function DocsPage() {
  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null;
  }
  const catalog = await fetchCatalog();
  return <DocsPageContent gateway={gateway} models={mergeCatalog(catalog.models)} />;
}
