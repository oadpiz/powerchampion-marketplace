import { EditorialPage } from "../../components/editorial-page";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/data-retention");

export default function DataRetentionPage() {
  return <EditorialPage policy="dataRetention" />;
}
