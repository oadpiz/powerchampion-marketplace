"use client";

import {
  COMPANY_CONTENT,
  COMPANY_SOURCES,
} from "../lib/company";
import { MODEL_CATALOG } from "../lib/models";
import { SERVICE_CONTENT } from "../lib/service-content";
import { useLocale } from "./locale-provider";

export function CompanyContent() {
  const { locale } = useLocale();
  const content = COMPANY_CONTENT[locale];
  const service = SERVICE_CONTENT[locale];
  const platformRows = [service.nextGenerationPlatform, ...content.gpuPlatforms.rows];

  return (
    <main className="company-page service-page" id="main-content">
      <section aria-labelledby="company-title" className="company-hero service-page-hero">
        <div>
          <p className="eyebrow">{service.company.kicker}</p>
          <h1 id="company-title">{service.company.title}</h1>
          <p className="service-hero-lead">{service.company.lead}</p>
          <div className="service-page-actions">
            {service.heroLinks.map((link) => <a href={link.href} key={link.href}>{link.label}<span aria-hidden="true">↗</span></a>)}
          </div>
        </div>
        <div className="service-hero-aside">
          <p className="service-hero-statement">{service.company.statement}</p>
          <nav aria-label={service.serviceTitle}>
            {service.services.map((item, index) => (
              <a href={`#${item.id}`} key={item.id}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                {item.title}
                <span aria-hidden="true">↓</span>
              </a>
            ))}
          </nav>
        </div>
      </section>

      <section aria-labelledby="services-title" className="service-editorial-section">
        <div className="service-section-heading">
          <p className="eyebrow">{locale === "en" ? "01 / Services" : "01 / 服務內容"}</p>
          <div>
            <h2 id="services-title">{service.serviceTitle}</h2>
            <p>{service.serviceLead}</p>
          </div>
        </div>
        <div className="service-offering-grid">
          {service.services.map((item, index) => (
            <article aria-labelledby={`${item.id}-title`} className="service-offering" id={item.id} key={item.id}>
              <span className="service-item-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3 id={`${item.id}-title`}>{item.title}</h3>
              <p className="service-audience">{item.audience}</p>
              <p>{item.description}</p>
              <h4>{service.deliverablesLabel}</h4>
              <ul>{item.deliverables.map((deliverable) => <li key={deliverable}>{deliverable}</li>)}</ul>
              <div className="service-offering-access">
                <h4>{service.accessLabel}</h4>
                <p>{item.access}</p>
                <a href={item.link.href}>{item.link.label}<span aria-hidden="true">↗</span></a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="company-workloads-title" className="service-editorial-section">
        <div className="service-section-heading">
          <p className="eyebrow">{locale === "en" ? "02 / Applications" : "02 / 應用場景"}</p>
          <div>
            <h2 id="company-workloads-title">{service.workloadTitle}</h2>
            <p>{service.workloadLead}</p>
          </div>
        </div>
        <div className="service-workload-grid">
          {service.workloads.map((workload) => {
            const models = MODEL_CATALOG.filter((model) => workload.modelIds.includes(model.id));
            return (
              <article aria-labelledby={`workload-${workload.id}`} className="service-workload" key={workload.id}>
                <p className="service-audience">{workload.audience}</p>
                <h3 id={`workload-${workload.id}`}>{workload.title}</h3>
                <p>{workload.description}</p>
                <h4>{service.modelLabel}</h4>
                <ul className="service-model-links">
                  {models.map((model) => <li key={model.id}><a href={`/models#${model.id}`}>{model.name}</a></li>)}
                </ul>
              </article>
            );
          })}
        </div>
        <div className="service-section-footnote">
          <p>{service.catalogNote}</p>
          {/* The vinext runtime uses root-relative links for page navigation. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/models">{service.catalogLink}<span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <section aria-labelledby="gpu-title" className="company-gpu service-editorial-section">
        <div className="service-section-heading">
          <p className="eyebrow">{locale === "en" ? "03 / Infrastructure" : "03 / 基礎設施"}</p>
          <div>
            <h2 id="gpu-title">{content.gpuPlatforms.title}</h2>
            <p>{content.gpuPlatforms.lead}</p>
          </div>
        </div>
        <div className="service-platform-table-wrap">
          <table className="service-platform-table">
            <thead><tr>
              <th scope="col">{content.gpuPlatforms.headers.category}</th>
              <th scope="col">{content.gpuPlatforms.headers.platform}</th>
              <th scope="col">{content.gpuPlatforms.headers.useCase}</th>
            </tr></thead>
            <tbody>{platformRows.map((row) => <tr key={row.platform}>
              <th scope="row">{row.category}</th><td>{row.platform}</td><td>{row.useCase}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="service-inline-note">{service.platformNote}</p>
      </section>

      <section aria-labelledby="deploy-title" className="service-editorial-section">
        <div className="service-section-heading">
          <p className="eyebrow">{locale === "en" ? "04 / Getting started" : "04 / 開始使用"}</p>
          <div><h2 id="deploy-title">{service.approachTitle}</h2><p>{service.approachLead}</p></div>
        </div>
        <ol className="service-process-list service-process-three">
          {service.approach.map((item, index) => <li key={item.title}>
            <span className="service-item-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <h3>{item.title}</h3><p>{item.description}</p>
          </li>)}
        </ol>
      </section>

      {/* Company record */}
      <section aria-labelledby="company-record-title" className="company-record service-public-record">
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
