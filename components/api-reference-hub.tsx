"use client";

import {
  API_REFERENCE_COPY,
  API_REFERENCE_NAV,
  API_REFERENCE_PAGES,
} from "../lib/api-reference";
import { useLocale } from "./locale-provider";

/**
 * The /docs/api overview: the guide's title block plus a card per section.
 * Each section lives on its own /docs/api/<slug> page so answer engines can
 * cite the exact endpoint page instead of a single monolithic manual.
 */
export function ApiReferenceHub() {
  const { locale } = useLocale();
  const copy = API_REFERENCE_COPY[locale];
  const nav = API_REFERENCE_NAV[locale];

  return (
    <main className="docs-page api-ref-page" id="main-content">
      <section aria-labelledby="api-ref-title" className="docs-intro">
        <p className="eyebrow">{copy.kicker}</p>
        <h1 id="api-ref-title">{copy.title}</h1>
        <p>{copy.lead}</p>
        <p className="docs-notice">{copy.version}</p>
        <p className="api-ref-back"><a href="/docs">← {copy.backToDocs}</a></p>
      </section>

      <nav aria-label={nav.sectionsLabel} className="api-ref-toc api-ref-hub">
        <h2>{nav.sectionsLabel}</h2>
        <ul className="api-ref-hub-grid">
          {API_REFERENCE_PAGES.map((page) => (
            <li className="api-ref-hub-card" key={page.slug}>
              <a href={`/docs/api/${page.slug}`}>{page.card[locale].title}</a>
              <p>{page.card[locale].summary}</p>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
