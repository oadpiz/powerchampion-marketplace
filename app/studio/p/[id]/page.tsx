import { notFound } from "next/navigation";
import { StudioEditor } from "../../../../components/studio-editor";
import { studioMetadata } from "../../../../lib/studio-metadata";

export const metadata = studioMetadata;

export default async function StudioProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  return <StudioEditor key={id} projectId={id} />;
}
