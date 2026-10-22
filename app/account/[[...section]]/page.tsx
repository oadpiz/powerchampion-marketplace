import { AccountPortal } from "../../../components/account-portal";
import { metadataForRoute } from "../../../lib/metadata";
import { notFound } from "next/navigation";
export const metadata = metadataForRoute("/account");
// One call's record (phase2-contract §10.2): voice_calls.id, 32 lowercase hex.
const CALL_ID = /^[a-f0-9]{32}$/;
export default async function AccountPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const route = (await params).section ?? [];
  const section = route[0] ?? "overview";
  // Only the phone agent section has sub-pages: exactly one level of them, plus voice/calls/<id>.
  const voiceSub = route[1];
  const voiceCallId = route[2];
  if (
    (route.length > 1 &&
      !(section === "voice" && route.length === 2 && ["setup", "faq", "try", "calls"].includes(voiceSub)) &&
      !(section === "voice" && route.length === 3 && voiceSub === "calls" && CALL_ID.test(voiceCallId))) ||
    !["overview", "keys", "usage", "credits", "security", "ssh-key", "voice"].includes(section)
  )
    notFound();
  return (
    <AccountPortal
      key={section}
      section={
        section as "overview" | "keys" | "usage" | "credits" | "security" | "ssh-key" | "voice"
      }
      voiceSub={voiceSub as "setup" | "faq" | "try" | "calls" | undefined}
      voiceCallId={voiceCallId}
    />
  );
}
