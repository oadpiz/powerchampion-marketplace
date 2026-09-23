"use client";

import { useEffect, useRef } from "react";
import { animate } from "motion";
import { useMotionAvailability } from "./promo-motion";

/** Enhance the existing brand page; content is visible before JavaScript runs. */
export function useHomeMotion(paused: boolean) {
  const rootRef = useRef<HTMLElement>(null);
  const canAnimate = useMotionAvailability(paused);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>(
      ":scope > section:not(.pc-hero):not([data-promo-scene]), .pc-model-families, .pc-platform-paths",
    ));
    const hero = root.querySelector(".pc-hero");
    let observer: IntersectionObserver | undefined;
    const animations = new Map<HTMLElement, ReturnType<typeof animate>>();

    function reveal(section: HTMLElement, immediately = false) {
      animations.get(section)?.stop();
      section.dataset.homeReveal = "visible";
      if (!canAnimate || immediately) {
        section.style.opacity = "1";
        section.style.transform = "none";
        return;
      }
      animations.set(section, animate(section, { opacity: [0, 1], y: [28, 0] }, {
        duration: 0.85, ease: [0.22, 1, 0.36, 1],
      }));
    }

    function configure() {
      observer?.disconnect();
      if (!root) return;
      const enabled = canAnimate;
      root.dataset.homeMotion = enabled ? "on" : "off";
      if (!enabled || typeof IntersectionObserver === "undefined") {
        sections.forEach((section) => reveal(section, true));
        return;
      }
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === hero) {
            root.dataset.heroVisible = String(entry.isIntersecting);
          } else if (entry.isIntersecting) {
            const section = entry.target as HTMLElement;
            if (section.dataset.homeReveal !== "visible") reveal(section);
            observer?.unobserve(entry.target);
          }
        }
      }, { threshold: 0.06 });
      if (hero) observer.observe(hero);
      for (const section of sections) {
        if (section.dataset.homeReveal === "visible") continue;
        section.dataset.homeReveal = section.getBoundingClientRect().top < window.innerHeight * 0.96 ? "visible" : "pending";
        if (section.dataset.homeReveal === "pending") observer.observe(section);
      }
    }
    function revealFocused(event: FocusEvent) {
      if (event.target instanceof Element) {
        const section = event.target.closest<HTMLElement>("[data-home-reveal]");
        if (section) {
          observer?.unobserve(section);
          reveal(section, true);
        }
      }
    }
    function visibility() {
      if (root) root.dataset.pageVisible = String(!document.hidden);
    }

    configure();
    visibility();
    root.addEventListener("focusin", revealFocused);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer?.disconnect();
      root.removeEventListener("focusin", revealFocused);
      document.removeEventListener("visibilitychange", visibility);
      animations.forEach((animation) => animation.stop());
      sections.forEach((section) => {
        delete section.dataset.homeReveal;
        section.style.removeProperty("opacity");
        section.style.removeProperty("transform");
      });
    };
  }, [canAnimate]);

  return rootRef;
}
