import { StatusContent } from "../../components/status-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/status");

export default function StatusPage() {
  return <StatusContent />;
}
