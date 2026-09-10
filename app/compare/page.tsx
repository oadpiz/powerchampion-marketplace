import { ModelComparison } from "../../components/model-comparison";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/compare");
export default function ComparePage() {
  return <ModelComparison />;
}
