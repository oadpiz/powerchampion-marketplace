import { notFound } from "next/navigation";
import { AdminPortal } from "../../../components/admin-portal";
import { isAdminSection } from "../../../lib/admin-sections";
import { metadataForRoute } from "../../../lib/metadata";

export const metadata = metadataForRoute("/admin");

export default async function AdminPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section = [] } = await params;
  const current = section[0] ?? "overview";
  if (section.length > 1 || !isAdminSection(current)) notFound();
  return <AdminPortal section={current} />;
}
