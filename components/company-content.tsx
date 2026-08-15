"use client";

import {
  COMPANY_CONTENT,
  COMPANY_SOURCES,
} from "../lib/company";
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
              <time dateTime={content.announcement.dateTime}>{content.announcement.date}</time>
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
            <dt>{content.capacity.depositLabel}</dt>
            <dd className="capacity-context-value">{content.capacity.depositContext}</dd>
          </div>
        </dl>
        <p className="capacity-qualification">{content.capacity.qualification}</p>
      </section>

      <section aria-labelledby="sources-title" className="source-disclosures">
        <h2 id="sources-title">{content.sources.title}</h2>
        <ul>
          {COMPANY_SOURCES.map((source) => {
            const sourceCopy = source.copy[locale];

            return (
              <li aria-label={sourceCopy.label} key={source.id}>
                <a href={source.href} rel="noreferrer" target="_blank">{sourceCopy.label}</a>
                <dl className="source-metadata">
                  <div>
                    <dt>{content.sources.typeLabel}</dt>
                    <dd>{sourceCopy.kind}</dd>
                  </div>
                  <div>
                    <dt>{sourceCopy.dateLabel}</dt>
                    <dd><time dateTime={source.dateTime}>{sourceCopy.date}</time></dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
        <p>{content.disclosure}</p>
      </section>

      <section aria-labelledby="company-contact-title" className="company-record">
        <h2 id="company-contact-title">{locale === "en" ? "Contact" : "聯絡資訊"}</h2>
        <p>7F, No. 38-1, Section 1, Ren&rsquo;ai Rd, Zhongzheng District, Taipei City 100, Taiwan</p>
        <p>Tel +886 2 2396 0605 · info@powerchampion.org</p>
        <p><a href="https://b300.powerchampion.ai">{locale === "en" ? "API Platform →" : "API 平台 →"}</a></p>
      </section>

      <section aria-labelledby="company-identity-title" className="company-record">
        <h2 id="company-identity-title">{locale === "en" ? "Company identity" : "公司資訊"}</h2>
        <p>{locale === "en" ? "Founded 2018 · Taipei City, Taiwan" : "成立於 2018 · 台灣台北市"}</p>
        <p>{locale === "en" ? "Website by 一點子創意工作室 (CatchATW)" : "網站由一點子創意工作室（CatchATW）製作"}</p>
      </section>

      <section aria-labelledby="company-partners-title" className="company-record">
        <h2 id="company-partners-title">{locale === "en" ? "Technology partners" : "技術合作夥伴"}</h2>
        <p>
          <a href="https://www.albatron.com.tw" rel="noreferrer" target="_blank">Albatron Technology Co. Ltd.</a>
          {" — "}
          {locale === "en" ? "Supermicro servers, NVIDIA GPU systems, and Micron storage solutions. +886-2-8227-3277 · sales@albatron.com.tw" : "Supermicro 伺服器、NVIDIA GPU 系統與 Micron 儲存方案。+886-2-8227-3277 · sales@albatron.com.tw"}
        </p>
      </section>

      <nav aria-label={content.related.title} className="company-related-links">
        <a href="/infrastructure">{content.related.infrastructureLink}</a>
        <a href="/contact">{content.related.deploymentReviewLink}</a>
      </nav>
    </main>
  );
}
