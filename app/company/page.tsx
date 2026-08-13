import { CompanyContent } from "../../components/company-content";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/company");

export default function CompanyPage() {
  return <CompanyContent />;
}
