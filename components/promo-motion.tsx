"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { MotionConfig } from "motion/react";

const MotionPolicy = createContext({ canAnimate: false });
const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void) {
  const media = window.matchMedia(REDUCED);
  media.addEventListener("change", callback);
  document.addEventListener("visibilitychange", callback);
  return () => {
    media.removeEventListener("change", callback);
    document.removeEventListener("visibilitychange", callback);
  };
}

function available() {
  return !document.hidden && !window.matchMedia(REDUCED).matches;
}

/** SSR is a readable still; motion becomes an enhancement after hydration. */
export function useMotionAvailability(paused = false) {
  const allowed = useSyncExternalStore(subscribe, available, () => false);
  return allowed && !paused;
}

export function PromoMotionRoot({ children, paused = false }: { children: ReactNode; paused?: boolean }) {
  const canAnimate = useMotionAvailability(paused);
  return <MotionPolicy.Provider value={{ canAnimate }}>
    {/* Motion caches this setting when a visual element mounts. Keep it stable;
        the reactive policy above explicitly gates every timeline and duration. */}
    <MotionConfig reducedMotion="never" transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </MotionConfig>
  </MotionPolicy.Provider>;
}

export function usePromoMotion() { return useContext(MotionPolicy); }
