import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = () => readFile(resolve(process.cwd(), "app/globals.css"), "utf8");

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

function selectorPrelude(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  expect(markerIndex, `Missing CSS selector: ${marker}`).toBeGreaterThanOrEqual(0);
  const ruleStart = source.lastIndexOf("}", markerIndex) + 1;
  const openingBrace = source.indexOf("{", markerIndex + marker.length);
  return source.slice(ruleStart, openingBrace);
}

function pixels(value: string) {
  const length = value.trim().match(/^(\d*\.?\d+)(px|rem)$/);
  if (!length) throw new Error(`Unparseable font-size length: ${value}`);
  return Number(length[1]) * (length[2] === "rem" ? 16 : 1);
}

function minimumFontSize(value: string) {
  const exact = value.trim();
  if (/^\d*\.?\d+(?:px|rem)$/.test(exact)) return pixels(exact);

  const clamp = exact.match(/^clamp\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\)$/);
  if (!clamp) throw new Error(`Unparseable font-size declaration: ${value}`);

  pixels(clamp[3]);
  if (!/^\d*\.?\d+(?:vw|vh|vmin|vmax|px|rem)$/.test(clamp[2].trim())) {
    throw new Error(`Unparseable preferred font-size: ${clamp[2]}`);
  }
  return pixels(clamp[1]);
}

describe("hybrid design contracts", () => {
  it("defines distinct product and trust surfaces from shared tokens", async () => {
    const source = await css();
    const root = balancedBlock(source, ":root");
    const productHooks = selectorPrelude(source, ".theme-product,");
    const trustHooks = selectorPrelude(source, ".theme-trust,");

    expect(root).toContain("--surface-product: #070a0f;");
    expect(root).toContain("--surface-product-raised: #0d121a;");
    expect(root).toContain("--surface-trust: #f3f2ed;");
    expect(root).toContain("--surface-trust-raised: #fbfaf6;");
    expect(root).toContain("--cyan: #55e7ff;");
    expect(root).toContain("--lime: #b9f36b;");
    expect(root).toContain("--violet: #8d7dff;");
    expect(productHooks).toContain(".home-page");
    expect(productHooks).toContain(".models-page");
    expect(productHooks).toContain(".pricing-page");
    expect(trustHooks).toContain(".company-page");
    expect(trustHooks).toContain(".enterprise-review-page");
    expect(trustHooks).toContain(".editorial-page");
  });

  it("never uses sub-13px interface text", async () => {
    const source = await css();
    const declarations = [...source.matchAll(/font-size:\s*([^;}]+)/g)].map((match) => match[1].trim());
    const minimums = declarations.map(minimumFontSize);

    expect(declarations.length).toBeGreaterThan(0);
    expect(minimums.every((value) => value >= 13)).toBe(true);
  });

  it("provides visible keyboard focus without an unpaired outline reset", async () => {
    const source = await css();

    expect(source).toMatch(/:focus-visible\s*\{[^}]*outline:\s*[^;}]+[^}]*outline-offset:/s);
    expect(source).not.toMatch(/outline:\s*none/);
  });

  it("replaces clipped language-button outlines at both toggle containers", async () => {
    const source = await css();
    const headerFocus = balancedBlock(source, ".locale-toggle:focus-within");
    const footerFocus = balancedBlock(source, ".footer-locale-toggle:focus-within");

    expect(headerFocus).toMatch(/(?:outline|box-shadow):\s*[^;}]+/);
    expect(footerFocus).toMatch(/(?:outline|box-shadow):\s*[^;}]+/);
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

  it("keeps editorial anchor targets below persistent navigation", async () => {
    const anchors = balancedBlock(await css(), ".editorial-page > section[id]");

    expect(anchors).toMatch(/scroll-margin-top:\s*[^;}]+/);
  });

  it("does not dim every interactive element on hover", async () => {
    const source = await css();

    expect(source).not.toMatch(/button:hover\s*,\s*a:hover\s*\{[^}]*opacity:/);
    expect(source).toMatch(/\.token-button:hover[^}]*filter:\s*brightness/);
    expect(source).toMatch(/\.text-link:hover\s*\{[^}]*color:/);
  });

  it("keeps active feedback at full contrast", async () => {
    const source = await css();
    const universalActive = balancedBlock(source, "button:active, a:active");
    const navigationActive = balancedBlock(source, ".site-navigation a:active");
    const controlActive = balancedBlock(source, ".locale-toggle button:active");

    const activeFamilies = [
      ".token-button:active",
      ".primary-link:active",
      ".credit-button:active",
      ".console-add-credit:active",
      ".marketplace-categories button:active",
      ".marketplace-empty button:active",
      ".marketplace-expand:active",
      ".checkout-close:active",
      ".checkout-back:active",
      ".checkout-pack:active",
      ".enquiry-form button:active",
      ".demo-key-actions button:active",
      ".code-sample-actions button:active",
      ".code-tabs button:active",
      ".faq-entry h2 button:active",
      ".editorial-section-navigation a:active",
      ".menu-trigger:active",
      ".mobile-navigation button:active",
    ];

    expect(universalActive).toMatch(/transform:\s*translateY\(/);
    expect(universalActive).not.toMatch(/opacity:/);
    expect(navigationActive).toMatch(/color:\s*var\(--(?:ink|focus)\)/);
    expect(controlActive).toMatch(/background:\s*var\(--line\)/);

    for (const selector of activeFamilies) {
      const declarations = balancedBlock(source, selector);
      expect(declarations, selector).toMatch(/background(?:-color)?:\s*[^;}]+/);
      expect(declarations, selector).toMatch(/color:\s*[^;}]+/);
      expect(declarations, selector).toMatch(/(?:border-color|box-shadow):\s*[^;}]+/);
    }

    for (const match of source.matchAll(/([^{}]*:active[^{}]*)\{([^{}]*)\}/g)) {
      expect(match[2], match[1].trim()).not.toMatch(/opacity\s*:/);
    }
  });
});
