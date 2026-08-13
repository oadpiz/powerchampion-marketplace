import { TrustContent } from "../../components/trust-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/trust");

export default function TrustPage() {
  return <TrustContent />;
}
