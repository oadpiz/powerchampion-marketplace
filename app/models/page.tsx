import { ModelsPageContent } from "../../components/models-page-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/models");

export default function ModelsPage() {
  return <ModelsPageContent />;
}
