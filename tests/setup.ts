import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Polyfill matchMedia — jsdom does not implement it
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Polyfill IntersectionObserver — jsdom does not implement it
if (typeof (globalThis as any).IntersectionObserver === "undefined") {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
}

afterEach(() => {
  cleanup();
  document.body.style.removeProperty("overflow");
  // LocaleProvider persists the user's locale choice; clear it between tests
  // so a test that switches to zh-Hant does not leak into the next one.
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});
