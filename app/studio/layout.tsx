import type { ReactNode } from "react";
import { StudioFrame } from "../../components/studio-shell";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return <StudioFrame>{children}</StudioFrame>;
}
