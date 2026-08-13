import { PricingPageContent } from "../../components/pricing-page-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/pricing");

export default function PricingPage() {
  return <PricingPageContent />;
}
