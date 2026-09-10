import { PricingPageContent } from "../../components/pricing-page-content";
import { fetchCatalog } from "../../lib/catalog";
import { metadataForRoute } from "../../lib/metadata";
import { mergeCatalog } from "../../lib/models";

export const metadata = metadataForRoute("/pricing");

export const revalidate = 60;

export default async function PricingPage() {
  const catalog = await fetchCatalog();
  return (
    <PricingPageContent
      models={mergeCatalog(catalog.models)}
      snapshotDate={catalog.source === "snapshot" ? catalog.updated : null}
    />
  );
}
