import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "next/navigation": resolve(process.cwd(), "node_modules/vinext/dist/shims/navigation.js"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: [...configDefaults.exclude, "tests/rendered-html.test.mjs"],
    // A cold RSC/jsdom transform can exceed Vitest's 5s default in this project;
    // 10s keeps the guard tight while avoiding first-run false timeouts.
    testTimeout: 10_000,
  },
});
