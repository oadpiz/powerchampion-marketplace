"use client";

import type { ReactElement } from "react";
import type { VoiceSubProps } from "./account-voice";
import { useLocale } from "./locale-provider";

/** /account/voice/faq (T8 fills this in). Placeholder until then; it receives VoiceSubProps. */
export const AccountVoiceFaq: (props: VoiceSubProps) => ReactElement = () => {
  const zh = useLocale().locale === "zh";
  return (
    <section className="portal-panel" aria-labelledby="voice-faq-title">
      <h2 id="voice-faq-title">{zh ? "常見問答" : "FAQ"}</h2>
      <p className="portal-muted">{zh ? "建置中" : "Under construction"}</p>
    </section>
  );
};
