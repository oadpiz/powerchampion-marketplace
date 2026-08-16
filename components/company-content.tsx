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
      {/* Hero */}
      <section aria-labelledby="company-title" className="company-hero">
        <p className="eyebrow">{content.kicker}</p>
        <h1 id="company-title">{content.title}</h1>
        <p>{content.lead}</p>
      </section>

      {/* Services — from .org integration */}
      <section aria-labelledby="services-title" className="company-services">
        <h2 id="services-title">{content.services.title}</h2>
        <p className="section-lead">{content.services.lead}</p>
        <div className="services-grid">
          {content.services.items.map((item, i) => (
            <article key={i} className="service-card">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* GPU Platforms */}
      <section aria-labelledby="gpu-title" className="company-gpu">
        <h2 id="gpu-title">{content.gpuPlatforms.title}</h2>
        <p className="section-lead">{content.gpuPlatforms.lead}</p>
        <div className="gpu-table-wrapper">
          <table className="gpu-table">
            <thead>
              <tr>
                <th>{content.gpuPlatforms.headers.category}</th>
                <th>{content.gpuPlatforms.headers.platform}</th>
                <th>{content.gpuPlatforms.headers.useCase}</th>
              </tr>
            </thead>
            <tbody>
              {content.gpuPlatforms.rows.map((row, i) => (
                <tr key={i}>
                  <td data-label={content.gpuPlatforms.headers.category}>{row.category}</td>
                  <td data-label={content.gpuPlatforms.headers.platform} className="mono">{row.platform}</td>
                  <td data-label={content.gpuPlatforms.headers.useCase}>{row.useCase}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="gpu-note">{content.gpuPlatforms.note}</p>
      </section>

      {/* Deployment Models */}
      <section aria-labelledby="deploy-title" className="company-deployment">
        <h2 id="deploy-title">{content.deploymentModels.title}</h2>
        <p className="section-lead">{content.deploymentModels.lead}</p>
        <div className="deployment-grid">
          {content.deploymentModels.items.map((item, i) => (
            <article key={i} className="deployment-card">
              <span className="deployment-number">{String(i + 1).padStart(2, "0")}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Company record */}
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

      {/* Capacity context */}
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

      {/* Sources */}
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

      {/* Structured contact + identity + partners */}
      <section aria-labelledby="company-contact-title" className="company-contact-grid">
        <div className="contact-block">
          <h2 id="company-contact-title">{content.contact.title}</h2>
          <dl className="contact-details">
            <div>
              <dt>{content.contact.addressLabel}</dt>
              <dd>{content.contact.address}</dd>
            </div>
            <div>
              <dt>{content.contact.phoneLabel}</dt>
              <dd><a href={`tel:${content.contact.phone.replace(/\s/g, "")}`}>{content.contact.phone}</a></dd>
            </div>
            <div>
              <dt>{content.contact.emailLabel}</dt>
              <dd><a href={`mailto:${content.contact.email}`}>{content.contact.email}</a></dd>
            </div>
            <div>
              <dt>{content.contact.apiLabel}</dt>
              <dd><a href="https://b300.powerchampion.ai">{content.contact.apiLink}</a></dd>
            </div>
          </dl>
        </div>

        <div className="contact-block">
          <h2>{content.identity.title}</h2>
          <dl className="contact-details">
            <div>
              <dt>{locale === "en" ? "Founded" : "成立時間"}</dt>
              <dd>{content.identity.founded}</dd>
            </div>
            <div>
              <dt>{locale === "en" ? "Built by" : "製作"}</dt>
              <dd>{content.identity.websiteBy}</dd>
            </div>
          </dl>
        </div>

        <div className="contact-block">
          <h2>{content.partners.title}</h2>
          {content.partners.items.map((partner, i) => (
            <div key={i} className="partner-card">
              <a href={partner.href} rel="noreferrer" target="_blank">{partner.name}</a>
              <p>{partner.description}</p>
              <p className="partner-contact">
                <a href={`tel:${partner.phone.replace(/[-\s]/g, "")}`}>{partner.phone}</a>
                {" · "}
                <a href={`mailto:${partner.email}`}>{partner.email}</a>
              </p>
            </div>
          ))}
        </div>
      </section>

      <nav aria-label={content.related.title} className="company-related-links">
        <a href="/infrastructure">{content.related.infrastructureLink}</a>
        <a href="/contact">{content.related.deploymentReviewLink}</a>
      </nav>
    </main>
  );
}
