import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_END,
  SNAPSHOT_START,
  renderSnapshotBlock,
  replaceSnapshotBlock,
} from "../scripts/sync-catalog-snapshot.mjs";

const payload = {
  updated: "2026-10-01T00:00:00Z",
  models: [
    {
      id: "glm-5.2-fp8",
      name: "GLM 5.2 FP8",
      description: "Frontier bilingual reasoning model.",
      modalities: { input: ["text"], output: ["text"] },
      context_length: 131072,
      max_output_length: 32768,
      pricing: { unit: "per_million_tokens", prompt_usd: 0.93, completion_usd: 3.0 },
      billing_note: null,
      ready: true,
      uptime: 0.998,
    },
  ],
};

describe("renderSnapshotBlock", () => {
  it("emits a typed, dated TypeScript block", () => {
    const block = renderSnapshotBlock(payload);

    expect(block.startsWith(SNAPSHOT_START)).toBe(true);
    expect(block.trimEnd().endsWith(SNAPSHOT_END)).toBe(true);
    expect(block).toContain('export const CATALOG_SNAPSHOT_DATE = "2026-10-01";');
    expect(block).toContain("export const CATALOG_SNAPSHOT: CatalogModel[] = [");
    expect(block).toContain('"id": "glm-5.2-fp8"');
    // uptime is a live health reading, not a catalogue fact worth freezing.
    expect(block).toContain('"uptime": null');
  });

  it("rejects a payload with no models rather than emptying the snapshot", () => {
    expect(() => renderSnapshotBlock({ updated: "2026-10-01", models: [] }))
      .toThrow(/at least one model/i);
  });

  // Gateway contract change (2026-09-10): context_length is null when a model
  // has no configured context window; max_output_length is null when the
  // model's output modality does not include "text". The script must pass
  // those nulls through untouched — never coerce them to 0.
  it("preserves null context_length and max_output_length instead of coercing them to 0", () => {
    const block = renderSnapshotBlock({
      updated: "2026-10-01T00:00:00Z",
      models: [
        {
          id: "whisper-large-v3",
          name: "Whisper Large v3",
          description: "Speech-to-text.",
          modalities: { input: ["audio"], output: ["text"] },
          context_length: null,
          max_output_length: null,
          pricing: { unit: "per_million_tokens", prompt_usd: 0.0, completion_usd: 3.33 },
          billing_note: "1000-token equivalent per 20 seconds of audio",
          ready: true,
          uptime: 0.99,
        },
      ],
    });

    expect(block).toContain('"context_length": null');
    expect(block).toContain('"max_output_length": null');
    expect(block).not.toMatch(/"context_length":\s*0\b/);
    expect(block).not.toMatch(/"max_output_length":\s*0\b/);
  });
});

describe("replaceSnapshotBlock", () => {
  it("swaps only the marked region", () => {
    const source = [
      "const before = 1;",
      SNAPSHOT_START,
      "old contents",
      SNAPSHOT_END,
      "const after = 2;",
      "",
    ].join("\n");

    const result = replaceSnapshotBlock(source, `${SNAPSHOT_START}\nnew contents\n${SNAPSHOT_END}`);

    expect(result).toContain("const before = 1;");
    expect(result).toContain("new contents");
    expect(result).not.toContain("old contents");
    expect(result).toContain("const after = 2;");
  });

  it("refuses to write when the markers are missing", () => {
    expect(() => replaceSnapshotBlock("no markers here", "x")).toThrow(/marker/i);
  });
});

describe("lib/catalog.ts", () => {
  it("still carries both markers so the script can find its block", async () => {
    const source = await readFile(resolve(process.cwd(), "lib/catalog.ts"), "utf8");
    expect(source).toContain(SNAPSHOT_START);
    expect(source).toContain(SNAPSHOT_END);
  });
});
