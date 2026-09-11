import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "next/navigation": resolve(process.cwd(), "node_modules/vinext/dist/shims/navigation.js"),
      "next/link": resolve(process.cwd(), "node_modules/vinext/dist/shims/link.js"),
    },
  },
  test: {
    environment: "jsdom",
    // Node 25 exposes process-level storage; tests need jsdom's per-window
    // implementation. Vitest does not inherit the parent process's execArgv.
    execArgv: ["--no-experimental-webstorage"],
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: [...configDefaults.exclude, ".worktrees/**", "tests/rendered-html.test.mjs"],
    // A cold RSC/jsdom transform can exceed Vitest's 5s default in this project;
    // 10s keeps the guard tight while avoiding first-run false timeouts.
    testTimeout: 10_000,
  },
});
