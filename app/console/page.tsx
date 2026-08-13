import { ConsolePageContent } from "../../components/console-page-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/console");

export default function ConsolePage() {
  return <ConsolePageContent />;
}
