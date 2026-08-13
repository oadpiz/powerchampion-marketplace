"use client";

import { SERVICE_READINESS, TRUST_CONTENT, isReady } from "../lib/trust";
import { useLocale } from "./locale-provider";

export function TrustContent() {
  const { locale, copy } = useLocale();
  const content = TRUST_CONTENT[locale];
  const readiness = [SERVICE_READINESS.manifest, SERVICE_READINESS.inference, SERVICE_READINESS.payments] as const;

  return (
    <main className="enterprise-review-page" id="main-content">
      <div className="enterprise-review-hero">
        <p className="eyebrow">{content.kicker}</p>
        <h1 id="trust-title">{content.title}</h1>
        <p>{content.lead}</p>
        <p className="enterprise-qualification">{content.releaseBoundary}</p>
      </div>

      <div className="trust-evidence-sections">
        {content.sections.map((section) => (
          <section aria-labelledby={`${section.id}-title`} key={section.id}>
            <h2 id={`${section.id}-title`}>{section.title}</h2>
            {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.id === "controls" && (
              <ul className="trust-readiness-list">
                {readiness.map((state) => <li data-ready={isReady(state)} key={state}>{content.status.states[state]}</li>)}
              </ul>
            )}
            {section.id === "policies" && (
              <nav aria-label={section.title} className="trust-policy-links">
                <a href="/privacy">{copy.footer.privacy}</a>
                <a href="/terms">{copy.footer.terms}</a>
                <a href="/status">{copy.footer.status}</a>
                <a href="/company">{locale === "en" ? "Company" : "公司"}</a>
              </nav>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
