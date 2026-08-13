import { EnterpriseEnquiry } from "../../components/enterprise-enquiry";

export const metadata = {
  title: "Deployment review | Power Champion",
  description: "Review non-binding deployment interests locally in your browser.",
};

export default function ContactPage() {
  return (
    <main className="contact-page" id="main-content">
      <EnterpriseEnquiry />
    </main>
  );
}
