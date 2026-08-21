import { metadataForRoute } from "../lib/metadata";

export const metadata = metadataForRoute("/");

const SUGGESTED_LINKS = [
  { href: "/", label: "Home", description: "Overview of models, pricing, and access" },
  { href: "/models", label: "Model catalog", description: "Compare live token rates and features" },
  { href: "/pricing", label: "Pricing", description: "Pay per use from prepaid balance" },
  { href: "/docs", label: "Documentation", description: "Quick start with cURL, Python, JavaScript" },
  { href: "/status", label: "Service status", description: "Live gateway and model availability" },
  { href: "/contact", label: "Contact", description: "Deployment review and enterprise inquiries" },
] as const;

export default function NotFound() {
  return (
    <main className="not-found-page" id="main-content">
      <section className="not-found-hero">
        <p className="eyebrow">404</p>
        <h1>This page could not be found.</h1>
        <p className="not-found-lead">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
          Try one of these instead:
        </p>
      </section>
      <nav aria-label="Suggested pages" className="not-found-links">
        {SUGGESTED_LINKS.map((link) => (
          <a key={link.href} href={link.href} className="not-found-link-card">
            <span className="not-found-link-label">{link.label}</span>
            <span className="not-found-link-desc">{link.description}</span>
          </a>
        ))}
      </nav>
    </main>
  );
}
