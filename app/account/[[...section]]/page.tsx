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
  if (
    route.length > 1 ||
    !["overview", "keys", "usage", "credits"].includes(section)
  )
    notFound();
  return (
    <AccountPortal
      key={section}
      section={section as "overview" | "keys" | "usage" | "credits"}
    />
  );
}
