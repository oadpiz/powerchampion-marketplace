import { EnterpriseEnquiry } from "../../components/enterprise-enquiry";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/contact");

export default function ContactPage() {
  return (
    <main className="contact-page" id="main-content">
      <EnterpriseEnquiry />
    </main>
  );
}
