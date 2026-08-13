import { DocsPageContent } from "../../components/docs-page-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/docs");

export default function DocsPage() {
  return <DocsPageContent />;
}
