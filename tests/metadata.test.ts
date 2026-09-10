import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// next/navigation's public type surface (vendored from upstream Next.js) does
// not re-export isRedirectError, even though vinext's shim implements it and
// next/navigation resolves to that same shim at runtime (see vitest.config.ts).
// Importing straight from the shim keeps this test fully typed.
import { isRedirectError } from "vinext/shims/navigation-errors";
import { metadataForRoute } from "../lib/metadata";
import { GATEWAY_ORIGIN } from "../lib/gateway-status";

async function sitemap(): Promise<string> {
  return readFile(resolve(process.cwd(), "public/sitemap.xml"), "utf8");
}

describe("route metadata", () => {
  it("titles /contact as Contact, not as the old internal review name", () => {
    const meta = metadataForRoute("/contact");
    expect(meta.title).toBe("Contact | Power Champion");
    expect(meta.openGraph?.title).toBe("Contact | Power Champion");
    expect(meta.twitter?.title).toBe("Contact | Power Champion");
  });

  it("leaves the other route titles alone", () => {
    expect(metadataForRoute("/").title).toBe("Power Champion — OpenAI-compatible API · Live");
    expect(metadataForRoute("/console").title).toBe("Console | Power Champion");
  });

  it("no longer describes /privacy or /terms as the launch site", () => {
    expect(metadataForRoute("/privacy").description).not.toMatch(/launch site/i);
    expect(metadataForRoute("/terms").description).not.toMatch(/launch site/i);
  });
});

describe("sitemap", () => {
  it("lists every indexable public route", async () => {
    const xml = await sitemap();
    for (const pathname of [
      "/", "/models", "/pricing", "/docs", "/company", "/infrastructure",
      "/trust", "/status", "/faq", "/contact", "/console", "/terms",
      "/privacy", "/data-retention",
    ]) {
      const loc = pathname === "/"
        ? "https://powerchampion.ai/"
        : `https://powerchampion.ai${pathname}`;
      expect(xml).toContain(`<loc>${loc}</loc>`);
    }
  });

  it("does not list /about, which is a redirect and not a page", async () => {
    expect(await sitemap()).not.toContain("powerchampion.ai/about");
  });
});

describe("/about", () => {
  it("permanently redirects to /company", async () => {
    const { default: AboutPage } = await import("../app/about/page");

    let thrown: unknown;
    try {
      AboutPage();
    } catch (error) {
      thrown = error;
    }

    expect(isRedirectError(thrown)).toBe(true);
    const digest = String((thrown as { digest: string }).digest);
    expect(digest).toContain(encodeURIComponent("/company"));
    // permanentRedirect() appends the status; redirect() would not, and a 307
    // here would tell crawlers the old URL is coming back.
    expect(digest.endsWith(";308")).toBe(true);
  });
});

describe("gateway origin", () => {
  it("is the single definition the status link and the catalogue share", () => {
    expect(GATEWAY_ORIGIN).toMatch(/^https?:\/\//);
    expect(`${GATEWAY_ORIGIN}/status.json`).not.toContain("//status.json");
  });
});
