import { IntegrationBuilder } from "../../components/integration-builder";
import { metadataForRoute } from "../../lib/metadata";

export const metadata = metadataForRoute("/integrations");

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ model?: string | string[] }> }) {
  const params = await searchParams;
  const model = typeof params?.model === "string" ? params.model : undefined;
  return <IntegrationBuilder key={model} initialModel={model} />;
}
