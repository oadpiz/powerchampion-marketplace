import { PlatformOverview } from "../../components/platform-overview";
import { fetchGatewayStatus } from "../../lib/gateway-status";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/platform");
export const dynamic = "force-dynamic";

export default async function PlatformPage() {
  const gateway = await fetchGatewayStatus().catch(() => null);
  return <PlatformOverview gateway={gateway} />;
}
