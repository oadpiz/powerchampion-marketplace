import { HomeContent } from "../components/home-content";
import { metadataForRoute } from "../lib/metadata";

export const metadata = metadataForRoute("/");

export default function Home() {
  return <HomeContent />;
}
