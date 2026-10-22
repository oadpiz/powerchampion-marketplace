import { StudioCreditsPage } from "../../../components/studio-credits";
import { studioMetadata } from "../../../lib/studio-metadata";

export const metadata = studioMetadata;

export default function StudioCreditsRoute() {
  return <StudioCreditsPage />;
}
