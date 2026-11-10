import { PricingPageContent } from "../../components/pricing-page-content";
import { JsonLd } from "../../components/json-ld";
import { metadataForRoute } from "../../lib/metadata";
import { offerCatalogJsonLd } from "../../lib/structured-data";

export const metadata = metadataForRoute("/pricing");

// The rate table on this URL states the published catalog input rate per model.
const offerCatalog = offerCatalogJsonLd("/pricing");

export default function PricingPage() {
  return (
    <>
      <JsonLd data={offerCatalog} />
      <PricingPageContent />
    </>
  );
}
