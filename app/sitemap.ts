import { MODEL_CATALOG } from "../lib/models";
import { SITE_ORIGIN, publicSitemapPaths } from "../lib/seo";

// Served at /sitemap.xml. The framework's sitemap metadata route always
// answers with Content-Type: application/xml, unlike a public/sitemap.xml
// static file, which the vinext asset server labels application/octet-stream
// (.xml is missing from its content-type table). public/sitemap.xml is still
// generated at build time as a static-asset fallback for CDN-level serving
// and is asserted against this same source in tests/seo.test.ts.
export default function sitemap() {
  return publicSitemapPaths(MODEL_CATALOG.map((model) => model.id)).map((path) => ({
    url: new URL(path, SITE_ORIGIN).href,
  }));
}
