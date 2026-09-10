import { HomeContent } from "../components/home-content";
import { fetchCatalog } from "../lib/catalog";
import { metadataForRoute } from "../lib/metadata";
import { mergeCatalog } from "../lib/models";

export const metadata = metadataForRoute("/");

// The catalogue is the gateway's answer, not a build-time constant; 60s keeps
// a restarted model visible within a minute without hammering /catalog.json.
export const revalidate = 60;

export default async function Home() {
  const catalog = await fetchCatalog();
  return (
    <HomeContent
      models={mergeCatalog(catalog.models)}
      snapshotDate={catalog.source === "snapshot" ? catalog.updated : null}
    />
  );
}
