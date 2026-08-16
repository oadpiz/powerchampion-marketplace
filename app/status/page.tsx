import { LiveStatusContent } from "../../components/live-status-content";
import { metadataForRoute } from "../../lib/metadata";
import { fetchGatewayStatus, type GatewayStatus } from "../../lib/gateway-status";

export const metadata = metadataForRoute("/status");

// Live status: re-fetched on every request (ISR window keeps it cheap while
// still tracking model restarts within a minute).
export const revalidate = 60;

export default async function StatusPage() {
  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null; // render static readiness rows with a "unreachable" note
  }
  return <LiveStatusContent gateway={gateway} fetchedAt={Date.now()} />;
}
