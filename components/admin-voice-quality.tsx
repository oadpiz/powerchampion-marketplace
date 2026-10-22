"use client";

import type { ReactElement } from "react";
import type { StoreItem } from "./admin-voice-dialogs";
import { AdminVoiceQualityListening } from "./admin-voice-quality-listening";
import { useLocale } from "./locale-provider";

/**
 * /admin/voice, "Quality" tab: flagged calls, the call drawer and reviews (P2-6 fills this in: phase2-contract
 * §7.1-§7.4, §11.3; shapes in lib/voice-quality.ts), with the blind listening log below. Placeholder until then.
 * `stores` is the A1 list the section already loaded, for the store filter.
 */
export const AdminVoiceQuality: (props: { stores: StoreItem[] }) => ReactElement = () => {
  const zh = useLocale().locale === "zh";
  return (
    <>
      <section className="portal-panel" aria-labelledby="voice-quality-title">
        <h2 id="voice-quality-title">{zh ? "品質" : "Quality"}</h2>
        <p className="portal-muted">{zh ? "建置中" : "Under construction"}</p>
      </section>
      <AdminVoiceQualityListening />
    </>
  );
};
