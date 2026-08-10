import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function stylesheet() {
  return readFile(resolve(process.cwd(), "app/globals.css"), "utf8");
}

function mediaBlock(css: string, breakpoint: number) {
  const start = css.indexOf(`@media (max-width: ${breakpoint}px)`);
  const end = css.indexOf("@media", start + 1);
  return css.slice(start, end === -1 ? undefined : end);
}

describe("responsive marketplace contracts", () => {
  it("uses the compact marketplace grid before a 768px viewport can overflow", async () => {
    const css = await stylesheet();
    const tablet = mediaBlock(css, 820);

    expect(tablet).toContain(".marketplace-row");
    expect(tablet).toContain('grid-template-areas: "index identity identity expand" ". context context ." ". input output ."');
    expect(tablet).toContain("grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr) 30px");
  });

  it("keeps homepage context and speed facts visible on mobile", async () => {
    const css = await stylesheet();
    const mobile = mediaBlock(css, 720);

    expect(mobile).not.toMatch(/\.model-facts\s*\{[^}]*display:\s*none/);
    expect(mobile).toMatch(/\.model-facts\s*\{[^}]*display:\s*grid/);
    expect(mobile).toMatch(/\.model-facts\s*\{[^}]*font-size:\s*\.8125rem/);
  });

  it("keeps skip and full-screen overlay scrolling self-contained", async () => {
    const css = await stylesheet();

    expect(css).toMatch(/\.skip-link:focus\s*\{[^}]*transform:\s*translateY\(0\)/);
    expect(css).toMatch(/\.mobile-navigation\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(css).toMatch(/\.checkout-backdrop\s*\{[^}]*overscroll-behavior:\s*contain/);
  });
});
