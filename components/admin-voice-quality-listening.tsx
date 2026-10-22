"use client";

import { useLocale } from "./locale-provider";

/**
 * The blind listening log in the lower half of the "Quality" tab (P2-6 fills this in: phase2-contract §7.5, §11.3;
 * shapes in lib/voice-quality.ts). Placeholder until then.
 */
export function AdminVoiceQualityListening() {
  const zh = useLocale().locale === "zh";
  return (
    <section className="portal-panel" aria-labelledby="voice-listening-title">
      <h2 id="voice-listening-title">{zh ? "盲聽紀錄" : "Blind listening log"}</h2>
      <p className="portal-muted">{zh ? "建置中" : "Under construction"}</p>
    </section>
  );
}
