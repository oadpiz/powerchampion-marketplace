import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function stylesheet() {
  return readFile(resolve(process.cwd(), "app/globals.css"), "utf8");
}

function balancedBlock(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  expect(markerIndex, `Missing CSS block: ${marker}`).toBeGreaterThanOrEqual(0);

  const openingBrace = source.indexOf("{", markerIndex + marker.length);
  expect(openingBrace, `Missing opening brace for: ${marker}`).toBeGreaterThan(markerIndex);

  let depth = 0;
  let quote: "\"" | "'" | null = null;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    const previous = source[index - 1];

    if ((character === "\"" || character === "'") && previous !== "\\") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }

    if (quote) continue;
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block: ${marker}`);
}

function mediaBlock(source: string, breakpoint: number) {
  return balancedBlock(source, `@media (max-width: ${breakpoint}px)`);
}

function selectorBlock(source: string, selector: string) {
  return balancedBlock(source, selector);
}

describe("responsive marketplace contracts", () => {
  it("uses the compact marketplace grid before a 768px viewport can overflow", async () => {
    const css = await stylesheet();
    const tablet = mediaBlock(css, 820);

    expect(tablet).toContain(".marketplace-row");
    expect(tablet).toContain('grid-template-areas: "index identity identity expand" ". context context ." ". input output ."');
    expect(tablet).toContain("grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr) 30px");
  });

  it("keeps model qualifiers visible in compact marketplace rows", async () => {
    const css = await stylesheet();
    const tablet = mediaBlock(css, 820);

    expect(tablet).toMatch(/\.marketplace-tagline\s*\{[^}]*display:\s*block;/);
  });

  it("switches the crowded primary header to its menu at the tablet boundary", async () => {
    const css = await stylesheet();
    const tablet = mediaBlock(css, 820);

    expect(tablet).toMatch(/\.site-navigation\s*,\s*\.site-actions\s*>\s*\.token-button\s*\{[^}]*display:\s*none/);
    expect(tablet).toMatch(/\.menu-trigger\s*\{[^}]*display:\s*block/);
    expect(css).not.toMatch(/@media\s*\(min-width:\s*721px\)[\s\S]*?\.mobile-navigation\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(min-width:\s*821px\)[\s\S]*?\.mobile-navigation\s*\{[^}]*display:\s*none/);
  });

  it("keeps homepage context and speed facts visible on mobile", async () => {
    const css = await stylesheet();
    const mobile = mediaBlock(css, 720);

    expect(mobile).not.toMatch(/\.model-facts\s*\{[^}]*display:\s*none/);
    expect(mobile).toMatch(/\.model-facts\s*\{[^}]*display:\s*grid/);
    expect(mobile).toMatch(/\.model-facts\s*\{[^}]*font-size:\s*\.8125rem/);
  });

  it.each([1024, 820, 720, 480])("never hides evidence or qualifiers at %ipx", async (breakpoint) => {
    const responsive = mediaBlock(await stylesheet(), breakpoint);
    const protectedSelectors = [
      ".model-facts",
      ".marketplace-tagline",
      ".marketplace-mobile-tagline",
      ".marketplace-rate-unit",
      ".rate-table-row",
      ".enterprise-capacity-fact",
      ".enterprise-qualification",
      ".enterprise-stages",
      ".trust-readiness-list",
      ".trust-evidence-sections",
      ".status-ledger",
    ];

    for (const selector of protectedSelectors) {
      const relevantRules = responsive
        .split("}")
        .filter((rule) => rule.slice(0, rule.indexOf("{")).includes(selector));

      expect(relevantRules.join("}"), `${selector} is hidden at ${breakpoint}px`)
        .not.toMatch(/display:\s*none/);
    }
  });

  it("keeps the complete model ledger and rate columns reachable on mobile", async () => {
    const css = await stylesheet();
    const mobile = mediaBlock(css, 720);
    const narrow = mediaBlock(css, 480);
    const modelRows = selectorBlock(mobile, ".model-row");
    const narrowModelRows = selectorBlock(narrow, ".model-row");
    const rateTable = selectorBlock(mobile, ".rate-table-scroll");
    const rateCue = selectorBlock(mobile, ".rate-table-cue");
    const rateRows = selectorBlock(mobile, ".rate-table-head, .rate-table-row");

    expect(modelRows).toContain('grid-template-areas: "index identity identity link" ". facts facts ."');
    expect(narrowModelRows).toContain('grid-template-areas: "index identity link" "facts facts facts"');
    expect(rateTable).toMatch(/overflow-x:\s*auto/);
    expect(rateTable).toMatch(/overscroll-behavior-inline:\s*contain/);
    expect(rateCue).toMatch(/display:\s*flex/);
    expect(rateRows).toMatch(/min-width:\s*640px/);
  });

  it("keeps skip and full-screen overlay scrolling self-contained", async () => {
    const css = await stylesheet();

    expect(css).toMatch(/\.skip-link:focus\s*\{[^}]*transform:\s*translateY\(0\)/);
    expect(css).toMatch(/\.mobile-navigation\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(css).toMatch(/\.checkout-backdrop\s*\{[^}]*overscroll-behavior:\s*contain/);
  });
});
