import { ApiReferenceHub } from "../../../components/api-reference-hub";
import { metadataForRoute } from "../../../lib/metadata";

export const metadata = metadataForRoute("/docs/api");

// The guide's 14 sections each live on their own /docs/api/<slug> page;
// this hub lists them with a one-line summary per section.
export default function ApiReferencePage() {
  return <ApiReferenceHub />;
}
