import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    environments: {
      client: {
        build: {
          rolldownOptions: {
            experimental: {
              // rolldown 1.0.1 absorbs vinext's dynamically imported
              // shims/navigation.js into the client entry chunk but rewrites
              // `import("./navigation.js")` to the bare entry chunk without
              // publishing the module namespace, so Link's
              // `navigateClientSide` resolves to undefined and every client
              // navigation throws "e is not a function" (rolldown #9446,
              // fixed in 1.0.2 by #9448). Keep common chunks un-merged until
              // the bundler is upgraded; tests/client-nav-chunks.test.mjs
              // guards the output.
              chunkOptimization: { mergeCommonChunks: false },
            },
          },
        },
      },
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
