import { FaqContent } from "../../components/faq-content";
import { JsonLd } from "../../components/json-ld";
import { metadataForRoute } from "../../lib/metadata";
import { faqPageJsonLd } from "../../lib/structured-data";
import { POLICY_CONTENT } from "../../lib/trust";

export const metadata = metadataForRoute("/faq");

// English is this URL's canonical language; the page also offers a zh reading.
const faq = faqPageJsonLd("/faq", POLICY_CONTENT.en.faq);

export default function FaqPage() {
  return (
    <>
      <JsonLd data={faq} />
      <FaqContent />
    </>
  );
}
