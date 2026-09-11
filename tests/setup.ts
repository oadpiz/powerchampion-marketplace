import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Product-page fixtures use the brand homepage shell. Tool tests select
// their own route before mounting the chat or builder.
beforeEach(() => window.history.replaceState({}, "", "/"));

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
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];
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
  window.sessionStorage.clear();
  document.documentElement.removeAttribute("lang");
});
