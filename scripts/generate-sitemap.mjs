// Node 22.13+: node --experimental-strip-types scripts/generate-sitemap.mjs
import { writeFile } from "node:fs/promises";
import { MODEL_CATALOG } from "../lib/models.ts";
import { SITE_ORIGIN, publicSitemapPaths } from "../lib/seo.ts";

const urls = publicSitemapPaths(MODEL_CATALOG.map((model) => model.id));
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path) => `  <url><loc>${new URL(path, SITE_ORIGIN).href}</loc></url>`).join("\n")}\n</urlset>\n`;
// Do not invent lastmod dates: add them only when content revision data exists.
await writeFile(new URL("../public/sitemap.xml", import.meta.url), xml);
console.log(`Generated sitemap with ${urls.length} public canonical URLs.`);
