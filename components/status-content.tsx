"use client";

import { TRUST_CONTENT, SERVICE_READINESS, isReady } from "../lib/trust";
import { useLocale } from "./locale-provider";

export function StatusContent() {
  const { locale } = useLocale();
  const content = TRUST_CONTENT[locale].status;
  const rows = [
    [content.labels.website, SERVICE_READINESS.website],
    [content.labels.manifest, SERVICE_READINESS.manifest],
    [content.labels.inference, SERVICE_READINESS.inference],
    [content.labels.payments, SERVICE_READINESS.payments],
    [content.labels.enterpriseReview, SERVICE_READINESS.enterpriseReview],
  ] as const;

  return (
    <main className="status-page" id="main-content">
      <header aria-labelledby="status-title" className="status-hero">
        <p className="eyebrow">{content.kicker}</p>
        <h1 id="status-title">{content.title}</h1>
        <p>{content.lead}</p>
      </header>
      <ul className="status-ledger">
        {rows.map(([label, state]) => (
          <li data-ready={isReady(state)} key={label}>
            <span>{label}</span>
            <strong>{content.states[state]}</strong>
          </li>
        ))}
      </ul>
    </main>
  );
}
