import { HomeContent } from "../components/home-content";
import { JsonLd } from "../components/json-ld";
import { pickFeaturedTextModel } from "../lib/featured-model";
import { fetchGatewayStatus, type GatewayStatus } from "../lib/gateway-status";
import { HOME_COPY } from "../lib/home-copy";
import { metadataForRoute } from "../lib/metadata";
import { faqPageJsonLd } from "../lib/structured-data";

export const metadata = metadataForRoute("/");

// The featured text model follows the gateway's live status.
export const revalidate = 60;

// The canonical English page describes the English questions it renders.
const homeFaq = faqPageJsonLd("/", HOME_COPY.en.faqs.map(([question, answer]) => ({ question, answer })));

export default async function Home() {
  let gateway: GatewayStatus | null = null;
  try {
    gateway = await fetchGatewayStatus();
  } catch {
    gateway = null;
  }
  return (
    <>
      <JsonLd data={homeFaq} />
      <HomeContent featuredTextModelId={pickFeaturedTextModel(gateway)} />
    </>
  );
}
