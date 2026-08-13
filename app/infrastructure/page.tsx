import { InfrastructureContent } from "../../components/infrastructure-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/infrastructure");

export default function InfrastructurePage() {
  return <InfrastructureContent />;
}
