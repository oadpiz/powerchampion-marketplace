import { FaqContent } from "../../components/faq-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/faq");

export default function FaqPage() {
  return <FaqContent />;
}
