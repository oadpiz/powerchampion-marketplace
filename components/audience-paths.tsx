"use client";

import { useLocale } from "./locale-provider";

export function AudiencePaths() {
  const { copy } = useLocale();

  return (
    <section aria-label={copy.home.pathsLabel} className="audience-paths">
      <a aria-label={copy.home.developerPath} className="audience-path audience-path-developer" href="/models">
        <span>{copy.home.developerEyebrow}</span>
        <strong>{copy.home.developerPath}</strong>
        <p>{copy.home.developerDescription}</p>
      </a>
      <a aria-label={copy.home.enterprisePath} className="audience-path audience-path-enterprise" href="/contact">
        <span>{copy.home.enterpriseEyebrow}</span>
        <strong>{copy.home.enterprisePath}</strong>
        <p>{copy.home.enterpriseDescription}</p>
      </a>
    </section>
  );
}
