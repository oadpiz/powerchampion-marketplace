"use client";

import { useEffect } from "react";

/**
 * Scroll reveal — adds data-revealed="true" when [data-reveal] elements
 * enter the viewport. Respects prefers-reduced-motion.
 *
 * Usage in markup:
 *   <section data-reveal>...</section>
 *   <div data-reveal data-reveal-delay="100">...</div>
 */
export function useScrollReveal() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));

    if (elements.length === 0) return;

    // Guard for environments without matchMedia (jsdom, very old browsers)
    const matchMedia =
      typeof window !== "undefined" ? window.matchMedia : undefined;
    const prefersReduced = matchMedia
      ? matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

    if (prefersReduced) {
      elements.forEach((el) => el.setAttribute("data-revealed", "true"));
      return;
    }

    // Guard for environments without IntersectionObserver
    if (typeof IntersectionObserver === "undefined") {
      elements.forEach((el) => el.setAttribute("data-revealed", "true"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const delay = el.dataset.revealDelay;
            if (delay) {
              el.style.transitionDelay = `${delay}ms`;
            }
            el.setAttribute("data-revealed", "true");
            observer.unobserve(el);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}
