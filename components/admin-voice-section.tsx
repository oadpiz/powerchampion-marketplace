"use client";

import { useLocale } from "./locale-provider";

/** /admin/voice: stores and numbers (T10 fills this in). Placeholder until then. */
export function AdminVoiceSection() {
  const zh = useLocale().locale === "zh";
  return (
    <section className="portal-panel">
      <p className="portal-muted">{zh ? "建置中" : "Under construction"}</p>
    </section>
  );
}
