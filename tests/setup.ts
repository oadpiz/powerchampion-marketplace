import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  document.body.style.removeProperty("overflow");
  // LocaleProvider persists the user's locale choice; clear it between tests
  // so a test that switches to zh-Hant does not leak into the next one.
  window.localStorage.clear();
  document.documentElement.removeAttribute("lang");
});
