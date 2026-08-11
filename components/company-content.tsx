"use client";

import {
  COMPANY_CONTENT,
  COMPANY_SOURCES,
  type CompanyLocale,
} from "../lib/company";
import { useLocale } from "./locale-provider";

type CompanySourceId = (typeof COMPANY_SOURCES)[number]["id"];

const CAPACITY_FACT_LABELS = {
  en: { deposit: "Counterparty-reported initial deposit context" },
  zh: { deposit: "交易對手報告的初始訂金脈絡" },
} satisfies Record<CompanyLocale, { deposit: string }>;

const SOURCE_KIND_COPY = {
  en: {
    "azio-sec-exhibit": "Counterparty SEC-filed disclosure",
    "bvi-directory": "Third-party public directory",
  },
  zh: {
    "azio-sec-exhibit": "交易對手向 SEC 提交的揭露",
    "bvi-directory": "第三方公開公司目錄",
  },
} satisfies Record<CompanyLocale, Record<CompanySourceId, string>>;

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
          <div>
            <dt>{CAPACITY_FACT_LABELS[locale].deposit}</dt>
            <dd className="capacity-context-value">{content.capacity.depositContext}</dd>
          </div>
        </dl>
        <p className="capacity-qualification">{content.capacity.qualification}</p>
      </section>

      <section aria-labelledby="sources-title" className="source-disclosures">
        <h2 id="sources-title">{content.sourcesTitle}</h2>
        <ul>
          {COMPANY_SOURCES.map((source) => (
            <li key={source.id}>
              <a href={source.href} rel="noreferrer" target="_blank">{source.label}</a>
              <span>{SOURCE_KIND_COPY[locale][source.id]}</span>
            </li>
          ))}
        </ul>
        <p>{content.disclosure}</p>
      </section>
    </main>
  );
}
