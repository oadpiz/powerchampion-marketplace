"use client";

import { useLocale } from "./locale-provider";
import { POLICY_CONTENT } from "../lib/trust";

type PolicyPage = "privacy" | "terms";

export function EditorialPage({ policy }: { policy: PolicyPage }) {
  const { locale } = useLocale();
  const content = POLICY_CONTENT[locale][policy];

  return (
    <main className="editorial-page" id="main-content">
      <header aria-labelledby="editorial-title" className="editorial-hero">
        <p className="eyebrow">{content.kicker}</p>
        <h1 id="editorial-title">{content.title}</h1>
        <p>{content.lead}</p>
      </header>
      <nav aria-label={content.title} className="editorial-section-navigation">
        <ul>
          {content.sections.map((section) => (
            <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
          ))}
        </ul>
      </nav>
      {content.sections.map((section) => (
        <section aria-labelledby={`${section.id}-title`} id={section.id} key={section.id}>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          {section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
    </main>
  );
}
