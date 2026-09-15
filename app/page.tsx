import { HomeContent } from "../components/home-content";
import { JsonLd } from "../components/json-ld";
import { HOME_COPY } from "../lib/home-copy";
import { metadataForRoute } from "../lib/metadata";
import { faqPageJsonLd } from "../lib/structured-data";

export const metadata = metadataForRoute("/");

// The canonical English page describes the English questions it renders.
const homeFaq = faqPageJsonLd("/", HOME_COPY.en.faqs.map(([question, answer]) => ({ question, answer })));

export default function Home() {
  return (
    <>
      <JsonLd data={homeFaq} />
      <HomeContent />
    </>
  );
}
