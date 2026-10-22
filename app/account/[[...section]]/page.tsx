import { AccountPortal } from "../../../components/account-portal";
import { metadataForRoute } from "../../../lib/metadata";
import { notFound } from "next/navigation";
export const metadata = metadataForRoute("/account");
export default async function AccountPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const route = (await params).section ?? [];
  const section = route[0] ?? "overview";
  // Only the phone agent section has sub-pages, and only exactly one level of them.
  const voiceSub = route[1];
  if (
    (route.length > 1 &&
      !(section === "voice" && route.length === 2 && ["setup", "faq", "try"].includes(voiceSub))) ||
    !["overview", "keys", "usage", "credits", "security", "ssh-key", "voice"].includes(section)
  )
    notFound();
  return (
    <AccountPortal
      key={section}
      section={
        section as "overview" | "keys" | "usage" | "credits" | "security" | "ssh-key" | "voice"
      }
      voiceSub={voiceSub as "setup" | "faq" | "try" | undefined}
    />
  );
}
