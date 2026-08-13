import { EditorialPage } from "../../components/editorial-page";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/privacy");

export default function PrivacyPage() {
  return <EditorialPage policy="privacy" />;
}
