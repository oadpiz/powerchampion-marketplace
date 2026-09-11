"use client";

import { useEffect, useRef } from "react";

/** Enhance the existing brand page; content is visible before JavaScript runs. */
export function useHomeMotion(paused: boolean) {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sections = Array.from(root.querySelectorAll<HTMLElement>(
      ":scope > section:not(.pc-hero), .pc-model-families, .pc-platform-paths",
    ));
    const hero = root.querySelector(".pc-hero");
    let observer: IntersectionObserver | undefined;

    function configure() {
      observer?.disconnect();
      if (!root) return;
      const enabled = !paused && !preference.matches;
      root.dataset.homeMotion = enabled ? "on" : "off";
      if (!enabled || typeof IntersectionObserver === "undefined") {
        sections.forEach((section) => { section.dataset.homeReveal = "visible"; });
        return;
      }
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === hero) {
            root.dataset.heroVisible = String(entry.isIntersecting);
          } else if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.homeReveal = "visible";
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
        if (section) section.dataset.homeReveal = "visible";
      }
    }
    function visibility() {
      if (root) root.dataset.pageVisible = String(!document.hidden);
    }

    configure();
    visibility();
    preference.addEventListener("change", configure);
    root.addEventListener("focusin", revealFocused);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer?.disconnect();
      preference.removeEventListener("change", configure);
      root.removeEventListener("focusin", revealFocused);
      document.removeEventListener("visibilitychange", visibility);
      sections.forEach((section) => { delete section.dataset.homeReveal; });
    };
  }, [paused]);

  return rootRef;
}
