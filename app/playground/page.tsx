import { PlaygroundContent } from "../../components/playground-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/playground");

export default function PlaygroundPage() {
  return <PlaygroundContent />;
}
