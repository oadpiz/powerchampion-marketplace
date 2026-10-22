"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import type { VoiceSubProps } from "./account-voice";
import { useLocale } from "./locale-provider";

/**
 * /account/voice/calls/<id>, one call's record (P2-2 fills this in: phase2-contract §6.2-§6.5, §11.2; shapes in
 * lib/voice-calls.ts). Placeholder until then.
 */
export const AccountVoiceCallDetail: (props: VoiceSubProps & { callId: string }) => ReactElement = () => {
  const zh = useLocale().locale === "zh";
  return (
    <section className="portal-panel" aria-labelledby="voice-call-title">
      <p>
        <Link href="/account/voice/calls">{zh ? "← 通話紀錄" : "← Calls"}</Link>
      </p>
      <h2 id="voice-call-title">{zh ? "通話明細" : "Call details"}</h2>
      <p className="portal-muted">{zh ? "建置中" : "Under construction"}</p>
    </section>
  );
};
