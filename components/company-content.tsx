"use client";

import { COMPANY_CONTENT, COMPANY_SOURCES } from "../lib/company";
import { useLocale } from "./locale-provider";

export function CompanyContent() {
  const { locale } = useLocale();
  const content = COMPANY_CONTENT[locale];

  return (
    <main className="company-page" id="main-content">
      <section aria-labelledby="company-title" className="company-hero">
        <p className="eyebrow">{content.kicker}</p>
        <h1 id="company-title">{content.title}</h1>
        <p>{content.lead}</p>
      </section>

      <section aria-labelledby="company-record-title" className="company-record">
        <h2 id="company-record-title">{content.record.heading}</h2>
        <ol className="company-timeline">
          <li>
            <article>
              <h3>{content.record.name}</h3>
              <p>{content.record.directoryQualification}</p>
            </article>
          </li>
          <li>
            <article>
              <h3>{content.announcement.heading}</h3>
              <time dateTime="2026-07-10">{content.announcement.date}</time>
              <p>{content.announcement.summary}</p>
            </article>
          </li>
        </ol>
      </section>

      <section aria-labelledby="capacity-title" className="capacity-brief">
        <h2 id="capacity-title">{content.capacity.title}</h2>
        <dl className="capacity-sequence">
          <div>
            <dt>{content.capacity.initialLabel}</dt>
            <dd>{content.capacity.initialMw}</dd>
            <dd>{content.capacity.initialReservation}</dd>
          </div>
          <div>
            <dt>{content.capacity.expansionLabel}</dt>
            <dd>{content.capacity.expansion}</dd>
            <dd>{content.capacity.potentialValue}</dd>
          </div>
        </dl>
        <p className="capacity-deposit-context">{content.capacity.depositContext}</p>
        <p className="capacity-qualification">{content.capacity.qualification}</p>
      </section>

      <section aria-labelledby="sources-title" className="source-disclosures">
        <h2 id="sources-title">{content.sourcesTitle}</h2>
        <ul>
          {COMPANY_SOURCES.map((source) => (
            <li key={source.id}>
              <a href={source.href} rel="noreferrer" target="_blank">{source.label}</a>
              <span>{source.kind}</span>
            </li>
          ))}
        </ul>
        <p>{content.disclosure}</p>
      </section>
    </main>
  );
}
