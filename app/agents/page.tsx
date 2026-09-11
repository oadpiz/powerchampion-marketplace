import { AgentsGallery } from "../../components/agents-gallery";
import { metadataForRoute } from "../../lib/metadata";
export const metadata = metadataForRoute("/agents");

export default function AgentsPage() {
  return <AgentsGallery />;
}
