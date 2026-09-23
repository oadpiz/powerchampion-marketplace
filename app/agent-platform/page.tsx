import { AgentPlatformContent } from "../../components/agent-platform-content";
import { metadataForRoute } from "../../lib/metadata";
import { JsonLd } from "../../components/json-ld";
import { faqPageJsonLd } from "../../lib/structured-data";
import { agentPlatformCopy } from "../../lib/agent-platform-copy";

export const metadata = metadataForRoute("/agent-platform");

export default function AgentPlatformPage() {
  return <><JsonLd data={faqPageJsonLd("/agent-platform", agentPlatformCopy.en.faqs)} /><AgentPlatformContent language="en" /></>;
}
