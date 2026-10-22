"use client";

import type { ReactElement } from "react";
import type { VoiceSubProps } from "./account-voice";
import { useLocale } from "./locale-provider";

/** /account/voice/setup and /account/voice (T7 fills this in). Placeholder until then; it receives VoiceSubProps. */
export const AccountVoiceSetup: (props: VoiceSubProps) => ReactElement = () => {
  const zh = useLocale().locale === "zh";
  return (
    <section className="portal-panel" aria-labelledby="voice-setup-title">
      <h2 id="voice-setup-title">{zh ? "設定" : "Setup"}</h2>
      <p className="portal-muted">{zh ? "建置中" : "Under construction"}</p>
    </section>
  );
};
