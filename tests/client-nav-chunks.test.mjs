// Guards the built client bundle against the rolldown 1.0.1 bug where
// vinext's dynamically imported shims/navigation.js is absorbed into the entry
// chunk and `import("./navigation.js")` is rewritten to a chunk that does not
// export the module's names. Link then calls `undefined` on every click
// ("e is not a function") and prefetch fails the same way.
//
// Runs against `dist/` after `npm run build` (see the `test` script).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const chunksDir = new URL("../dist/client/_next/static/chunks/", import.meta.url);

function readChunks() {
  const files = readdirSync(chunksDir).filter((name) => name.endsWith(".js"));
  assert.ok(files.length > 0, "no client chunks found; run `npm run build` first");
  return new Map(files.map((name) => [name, readFileSync(new URL(name, chunksDir), "utf8")]));
}

function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const spec = part.trim();
      if (!spec) continue;
      const alias = spec.match(/\bas\s+([\w$]+)$/);
      names.add(alias ? alias[1] : spec);
    }
  }
  return names;
}

// `const { navigateClientSide } = await import("./navigation.js")` in
// vinext's link shim, after bundling and minification.
const linkImportPattern =
  /navigateClientSide\s*(?::\s*[\w$]+)?\s*\}\s*=\s*await\s+import\(\s*[`'"]\.\/([^`'"]+)[`'"]\s*\)/g;

test("the chunk Link dynamically imports exports navigateClientSide", () => {
  const chunks = readChunks();
  const targets = new Set();
  for (const source of chunks.values()) {
    for (const match of source.matchAll(linkImportPattern)) targets.add(match[1]);
  }

  assert.ok(
    targets.size > 0,
    "could not find Link's `navigateClientSide` dynamic import in the client chunks; " +
      "if vinext changed the import shape, update this test instead of deleting it",
  );

  for (const target of targets) {
    const source = chunks.get(target);
    assert.ok(source, `Link imports ${target}, which is not in the client chunks`);
    const names = exportedNames(source);
    for (const name of ["navigateClientSide", "getPrefetchCache", "prefetchRscResponse"]) {
      assert.ok(names.has(name), `${target} (imported by Link) does not export ${name}`);
    }
  }
});
