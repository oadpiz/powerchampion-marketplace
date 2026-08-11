import { EnterpriseEnquiry } from "../../components/enterprise-enquiry";

export const metadata = {
  title: "Contact | Power Champion",
  description: "Explore launch-only infrastructure and partnership enquiries that stay local to your browser.",
};

export default function ContactPage() {
  return (
    <main className="contact-page" id="main-content">
      <EnterpriseEnquiry />
    </main>
  );
}
