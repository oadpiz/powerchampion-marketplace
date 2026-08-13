"use client";

import type { ReactNode } from "react";
import { TRUST_CONTENT } from "../lib/trust";
import { useLocale } from "./locale-provider";

type PreparationLayoutProps = {
  kicker: string;
  title: string;
  lead: string;
  children: ReactNode;
};

function PreparationLayout({ kicker, title, lead, children }: PreparationLayoutProps) {
  return (
    <main className="preparation-page" id="main-content">
      <section aria-labelledby="preparation-title">
        <div className="editorial-hero">
          <p className="eyebrow">{kicker}</p>
          <h1 id="preparation-title">{title}</h1>
          <p>{lead}</p>
        </div>
        {children}
      </section>
    </main>
  );
}

export function InfrastructurePreparationContent() {
  const { locale } = useLocale();
  const content = TRUST_CONTENT[locale].infrastructure;
  const text = locale === "en"
    ? { title: "Infrastructure preparation", company: "Company context", review: "Deployment review", navigation: "Infrastructure preparation links" }
    : { title: "基礎設施準備中", company: "公司脈絡", review: "部署審查", navigation: "基礎設施準備連結" };

  return (
    <PreparationLayout kicker={content.kicker} lead={content.lead} title={text.title}>
      <p>{content.capacityStage}</p>
      <nav aria-label={text.navigation}>
        <a href="/company">{text.company}</a>
        <a href="/contact">{text.review}</a>
      </nav>
    </PreparationLayout>
  );
}

export function TrustPreparationContent() {
  const { locale, copy } = useLocale();
  const content = TRUST_CONTENT[locale];
  const text = locale === "en"
    ? {
      title: "Trust review preparation",
      preparation: "The detailed trust review is in preparation.",
      company: "Company",
      review: "Deployment review",
      navigation: "Trust review links",
    }
    : {
      title: "信任審查準備中",
      preparation: "詳細的信任審查內容仍在準備中。",
      company: "公司",
      review: "部署審查",
      navigation: "信任審查連結",
    };

  return (
    <PreparationLayout kicker={content.kicker} lead={content.releaseBoundary} title={text.title}>
      <p>{text.preparation}</p>
      <nav aria-label={text.navigation}>
        <a href="/privacy">{copy.footer.privacy}</a>
        <a href="/terms">{copy.footer.terms}</a>
        <a href="/status">{copy.footer.status}</a>
        <a href="/company">{text.company}</a>
        <a href="/contact">{text.review}</a>
      </nav>
    </PreparationLayout>
  );
}
