"use client";

import type { ReactElement } from "react";
import type { VoiceSubProps } from "./account-voice";
import { useLocale } from "./locale-provider";

/** /account/voice/try (T9 fills this in). Placeholder until then; it receives VoiceSubProps. */
export const AccountVoiceTry: (props: VoiceSubProps) => ReactElement = () => {
  const zh = useLocale().locale === "zh";
  return (
    <section className="portal-panel" aria-labelledby="voice-try-title">
      <h2 id="voice-try-title">{zh ? "試打一通" : "Try a call"}</h2>
      <p className="portal-muted">{zh ? "建置中" : "Under construction"}</p>
    </section>
  );
};
