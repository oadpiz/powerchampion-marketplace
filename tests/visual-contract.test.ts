import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = () => readFile(resolve(process.cwd(), "app/globals.css"), "utf8");

describe("hybrid design contracts", () => {
  it("defines distinct product and trust surfaces from shared tokens", async () => {
    const source = await css();

    expect(source).toMatch(/--surface-product:\s*#[0-9a-f]{6}/i);
    expect(source).toMatch(/--surface-trust:\s*#[0-9a-f]{6}/i);
    expect(source).toMatch(/\.theme-product\s*[,{]/);
    expect(source).toMatch(/\.theme-trust\s*[,{]/);
  });

  it("never uses sub-13px interface text", async () => {
    const source = await css();
    const px = [...source.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
    const rem = [...source.matchAll(/font-size:\s*([\d.]+)rem/g)].map((match) => Number(match[1]) * 16);

    expect([...px, ...rem].every((value) => value >= 13)).toBe(true);
  });

  it("provides visible keyboard focus without an unpaired outline reset", async () => {
    const source = await css();

    expect(source).toMatch(/:focus-visible\s*\{[^}]*outline:\s*[^;}]+[^}]*outline-offset:/s);
    expect(source).not.toMatch(/outline:\s*none/);
  });

  it("uses only scoped motion and has an explicit reduced-motion mode", async () => {
    const source = await css();

    expect(source).not.toMatch(/transition:\s*all\b/);
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*animation-duration:\s*0\.01ms\s*!important;[\s\S]*transition-duration:\s*0\.01ms\s*!important;/);
  });

  it("keeps comparisons numeric and long content resilient", async () => {
    const source = await css();

    expect(source).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(source).toMatch(/text-wrap:\s*balance/);
    expect(source).toMatch(/overflow-wrap:\s*(?:anywhere|break-word)/);
  });
});
