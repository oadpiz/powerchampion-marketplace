import { notFound } from "next/navigation";
import {
  AdminPortal,
  type AdminSection,
} from "../../../components/admin-portal";
import { metadataForRoute } from "../../../lib/metadata";

export const metadata = metadataForRoute("/admin");

export default async function AdminPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section = [] } = await params;
  const current = section[0] ?? "overview";
  if (
    section.length > 1 ||
    !["overview", "customers", "credits", "audit"].includes(current)
  )
    notFound();
  return <AdminPortal section={current as AdminSection} />;
}
