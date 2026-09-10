import { ModelsPageContent } from "../../components/models-page-content";
import { fetchCatalog } from "../../lib/catalog";
import { metadataForRoute } from "../../lib/metadata";
import { mergeCatalog } from "../../lib/models";

export const metadata = metadataForRoute("/models");

export const revalidate = 60;

export default async function ModelsPage() {
  const catalog = await fetchCatalog();
  return (
    <ModelsPageContent
      models={mergeCatalog(catalog.models)}
      snapshotDate={catalog.source === "snapshot" ? catalog.updated : null}
    />
  );
}
