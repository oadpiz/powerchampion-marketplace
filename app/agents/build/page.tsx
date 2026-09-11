import { AgentBuilder } from "../../../components/agent-builder";
import { metadataForRoute } from "../../../lib/metadata";
export const metadata = metadataForRoute("/agents/build");
export default function AgentBuilderPage() {
  return <AgentBuilder />;
}
