import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Polyfill localStorage/sessionStorage when the runtime's own globals are broken.
//
// Node >=22's built-in Web Storage globals (`localStorage`/`sessionStorage`) are
// stubs that only become functional when the process is started with
// `--localstorage-file <path>`; otherwise `setItem`/etc. are missing. jsdom does
// ship a fully working `localStorage`/`sessionStorage` on the `window` it creates,
// but vitest's jsdom environment only copies a `window` property onto the global
// scope when that property does not already exist on `globalThis` (see
// `populateGlobal`/`getWindowKeys` in vitest's environment setup) — since Node now
// pre-declares `localStorage`/`sessionStorage` as globals, jsdom's working
// implementation never gets copied over, and `window.localStorage` (which, in
// vitest's jsdom environment, is the same object as the global scope) resolves to
// Node's non-functional stub instead. Only step in when that's actually the case,
// so a future Node/jsdom/vitest release that resolves this collision keeps using
// the real jsdom implementation untouched.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as Storage;
}

function ensureWorkingStorage(propertyName: "localStorage" | "sessionStorage") {
  const current = (window as any)[propertyName];
  if (current && typeof current.setItem === "function") return;
  Object.defineProperty(window, propertyName, {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}

ensureWorkingStorage("localStorage");
ensureWorkingStorage("sessionStorage");

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
  // Same choice, second store: the cookie is what the server reads, and it
  // outranks localStorage, so leaving it set would silently pin every later
  // test in this file to one language.
  document.cookie = "pc-locale=; Path=/; Max-Age=0";
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("data-locale");
});
