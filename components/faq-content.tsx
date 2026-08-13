"use client";

import { useState } from "react";
import { POLICY_CONTENT } from "../lib/trust";
import { useLocale } from "./locale-provider";

export function FaqContent() {
  const { locale } = useLocale();
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const entries = POLICY_CONTENT[locale].faq;

  return (
    <main className="faq-page" id="main-content">
      <header aria-labelledby="faq-title" className="editorial-hero">
        <p className="eyebrow">{locale === "en" ? "FAQ" : "常見問題"}</p>
        <h1 id="faq-title">{locale === "en" ? "Launch questions, answered plainly." : "清楚回答啟動相關問題。"}</h1>
      </header>
      <section aria-labelledby="faq-title">
        {entries.map((entry) => {
          const isOpen = openEntryId === entry.id;
          const panelId = `${entry.id}-answer`;

          return (
            <article className="faq-entry" key={entry.id}>
              <h2>
                <button
                  aria-controls={panelId}
                  aria-expanded={isOpen}
                  id={entry.id}
                  onClick={() => setOpenEntryId(isOpen ? null : entry.id)}
                  type="button"
                >
                  {entry.question}
                </button>
              </h2>
              <div aria-labelledby={entry.id} hidden={!isOpen} id={panelId} role="region">
                <p>{entry.answer}</p>
                {entry.href && entry.linkLabel && <a href={entry.href}>{entry.linkLabel}</a>}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
