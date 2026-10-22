"use client";

import type { ReactElement } from "react";
import type { VoiceSubProps } from "./account-voice";
import { AccountVoiceCallDetail } from "./account-voice-calls-detail";
import { useLocale } from "./locale-provider";

/** /account/voice/calls[/<id>]: `callId` is set on one call's page; the route has already checked it is 32 lowercase hex. */
export type VoiceCallsProps = VoiceSubProps & { callId?: string };

/**
 * /account/voice/calls, the store's call records (P2-2 fills this in: phase2-contract §6.1, §11.1; shapes in
 * lib/voice-calls.ts). Placeholder until then; one call's page is AccountVoiceCallDetail.
 */
export function AccountVoiceCalls({ callId, ...props }: VoiceCallsProps): ReactElement {
  const zh = useLocale().locale === "zh";
  if (callId) return <AccountVoiceCallDetail {...props} callId={callId} />;
  return (
    <section className="portal-panel" aria-labelledby="voice-calls-title">
      <h2 id="voice-calls-title">{zh ? "通話紀錄" : "Calls"}</h2>
      <p className="portal-muted">{zh ? "建置中" : "Under construction"}</p>
    </section>
  );
}
