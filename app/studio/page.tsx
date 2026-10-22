import { StudioHome } from "../../components/studio-home";
import { studioMetadata } from "../../lib/studio-metadata";

export const metadata = studioMetadata;

export default function StudioPage() {
  return <StudioHome />;
}
