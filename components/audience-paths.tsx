"use client";

import { useLocale } from "./locale-provider";

export function AudiencePaths() {
  const { copy, locale } = useLocale();
  const text = locale === "en" ? {
    compareRates: "Compare token rates",
    deploymentReview: "Deployment review",
    developerDescription: "Review model decision fields and indicative token rates before future access.",
    enterpriseDescription: "Start a non-binding deployment review using the public infrastructure context.",
  } : {
    compareRates: "比較 Token 費率",
    deploymentReview: "部署審查",
    developerDescription: "在未來存取之前，先檢視模型決策欄位與展示 Token 費率。",
    enterpriseDescription: "透過公開基礎設施脈絡，開始非約束性的部署審查。",
  };

  return (
    <section aria-label={copy.home.pathsLabel} className="audience-paths" id="about">
      <a aria-label={text.compareRates} className="audience-path audience-path-developer" href="/pricing">
        <span>{copy.home.developerEyebrow}</span><strong>{text.compareRates}</strong><p>{text.developerDescription}</p>
      </a>
      <a aria-label={text.deploymentReview} className="audience-path audience-path-enterprise" href="/contact">
        <span>{copy.home.enterpriseEyebrow}</span><strong>{text.deploymentReview}</strong><p>{text.enterpriseDescription}</p>
      </a>
    </section>
  );
}
