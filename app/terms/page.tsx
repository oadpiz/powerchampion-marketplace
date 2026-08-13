import { EditorialPage } from "../../components/editorial-page";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/terms");

export default function TermsPage() {
  return <EditorialPage policy="terms" />;
}
