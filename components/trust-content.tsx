"use client";

import { TRUST_CONTENT, deriveGatewayReadiness, isReady } from "../lib/trust";
import type { GatewayStatus } from "../lib/gateway-status";
import { useLocale } from "./locale-provider";

type Props = {
  gateway: GatewayStatus | null;
};

export function TrustContent({ gateway }: Props) {
  const { locale, copy } = useLocale();
  const content = TRUST_CONTENT[locale];
  const derived = deriveGatewayReadiness(gateway);
  const readiness = [
    { id: "manifest", state: derived.manifest },
    { id: "inference", state: derived.inference },
    { id: "payments", state: derived.payments },
  ] as const;

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
                {readiness.map(({ id, state }) => (
                  <li
                    aria-label={`${content.status.labels[id]}${locale === "en" ? ": " : "："}${content.status.states[state]}`}
                    data-ready={isReady(state)}
                    data-service={id}
                    key={id}
                  >
                    <span>{content.status.labels[id]}</span>
                    <span aria-hidden="true"> — </span>
                    <strong>{content.status.states[state]}</strong>
                  </li>
                ))}
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
