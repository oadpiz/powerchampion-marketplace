import assert from "node:assert/strict";
import test from "node:test";

async function request(pathname, host = "localhost", forwardedHost, origin = "http://localhost") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, origin), {
      headers: {
        accept: "text/html",
        host,
        ...(forwardedHost === undefined ? {} : { "x-forwarded-host": forwardedHost }),
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function render(pathname, host = "localhost", forwardedHost) {
  return request(pathname, host, forwardedHost);
}

const routeMetadata = {
  "/": {
    title: "Power Champion — One API. Every possibility.",
    description: "Build with open AI models for text, vision, images, speech, and retrieval. Explore published API pricing, integration tools, and dedicated GPU infrastructure.",
  },
  "/solutions": {
    title: "Power Champion — One API. Every possibility.",
    description: "Build with open AI models for text, vision, images, speech, and retrieval. Explore published API pricing, integration tools, and dedicated GPU infrastructure.",
  },
  "/models": {
    title: "Open Model Catalog | Power Champion",
    description: "Explore open AI models for text, vision, images, speech, and retrieval. Compare published API rates, capabilities, and integration requirements.",
  },
  "/pricing": {
    title: "Pricing | Power Champion",
    description: "Published API rates for tokens, images, and audio, with prepaid credit options and a workload cost calculator.",
  },
  "/infrastructure": {
    title: "Dedicated GPU Infrastructure | Power Champion",
    description: "Explore dedicated NVIDIA HGX GPU capacity, bare-metal deployments, and infrastructure planning for model inference and training.",
  },
  "/docs": {
    title: "Documentation | Power Champion",
    description: "Quick start for the OpenAI-compatible API at b300.powerchampion.ai — cURL, Python, and JavaScript examples.",
  },
  "/trust": {
    title: "Trust and Service Policies | Power Champion",
    description: "Understand Power Champion service responsibilities, data handling, API access, and published company information.",
  },
  "/status": {
    title: "Service status | Power Champion",
    description: "Check the latest available gateway and model service status for Power Champion API services.",
  },
  "/company": {
    title: "Company | Power Champion",
    description: "Meet Power Champion Investment Limited and explore our model API, dedicated GPU, and deployment services.",
  },
  "/contact": {
    title: "Contact Our Team | Power Champion",
    description: "Discuss model API access, GPU capacity, and enterprise deployment requirements with the Power Champion team.",
  },
  "/console": {
    title: "Console | Power Champion",
    description: "Check your prepaid API balance with your key. Queries the gateway live; the key is never stored.",
  },
  "/faq": {
    title: "FAQ | Power Champion",
    description: "Answers about model API access, prepaid credits, billing, integration, and dedicated GPU services.",
  },
  "/terms": {
    title: "Terms | Power Champion",
    description: "Read the terms governing the Power Champion website and how commercial API service terms are established.",
  },
  "/privacy": {
    title: "Privacy | Power Champion",
    description: "Learn how Power Champion handles website interactions, account information, and API requests.",
  },
};

const routes = [
  "/", "/solutions", "/models", "/pricing", "/infrastructure", "/docs", "/trust",
  "/status", "/company", "/contact", "/console", "/faq", "/terms", "/privacy",
];

const shellDestinations = [
  "/models", "/pricing", "/infrastructure", "/docs", "/trust", "/status",
  "/company", "/contact", "/console", "/faq", "/terms", "/privacy",
];

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertRouteUrls(html, pathname, origin) {
  const canonicalPath = pathname === "/solutions" ? "/" : pathname;
  const resolved = new URL(canonicalPath, origin);
  const expected = canonicalPath === "/" ? resolved.origin : resolved.href;
  assert.match(html, new RegExp(`<link rel="canonical" href="${escaped(expected)}"`));
  assert.match(html, new RegExp(`<meta property="og:url" content="${escaped(expected)}"`));
}

test("server-renders a complete English marketplace shell with social metadata", async () => {
  for (const pathname of routes) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} returns 200`);

    const html = await response.text();
    assert.match(html, /Power Champion/i, `${pathname} includes the shared brand`);
    for (const destination of shellDestinations) {
      assert.match(html, new RegExp(`href="${destination}"`), `${pathname} links to ${destination}`);
    }
    assert.match(html, /lang="en"/, `${pathname} defaults to English`);
    assert.match(html, new RegExp(`<title>${routeMetadata[pathname].title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/title>`));
    assert.match(
      html,
      new RegExp(`<meta name="description" content="${routeMetadata[pathname].description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      `${pathname} includes its route-specific description`,
    );
    assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
    assert.doesNotMatch(
      html,
      /buy now|funded account|SOC 2 certified|ISO 27001 certified|we own (?:a|the) data cent(?:re|er)|deployed 3\.1 MW/i,
    );
    // Per-route og/twitter titles match the route's own document title
    // (commit 142073d); asserting the home title on every route no longer holds.
    assert.match(
      html,
      new RegExp(`property="og:title" content="${escaped(routeMetadata[pathname].title)}"`),
      `${pathname} og:title matches its route title`,
    );
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
    assert.match(
      html,
      new RegExp(`name="twitter:title" content="${escaped(routeMetadata[pathname].title)}"`),
      `${pathname} twitter:title matches its route title`,
    );
    assert.match(html, /rel="shortcut icon" href="\/favicon\.png"/);
    assert.match(html, /rel="icon" href="\/favicon\.png"/);
    assert.doesNotMatch(html, /Explore leading open AI models with one API and one prepaid balance\./);
    assert.match(html, /property="og:image" content="https:\/\/powerchampion\.ai\/og-platform\.png"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assertRouteUrls(html, pathname, "https://powerchampion.ai");
  }

  const publicResponse = await render("/", "marketplace.example");
  const publicHtml = await publicResponse.text();
  assert.match(
    publicHtml,
    /property="og:image" content="https:\/\/powerchampion\.ai\/og-platform\.png"/,
  );
});

test("redirects the browser compatibility favicon to the published PNG", async () => {
  const response = await request("/favicon.ico");

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "http://localhost/favicon.png");
});

test("keeps canonical URLs fixed and prevents preview and private-page indexing", async () => {
  for (const host of ["localhost:3010", "preview.example", "powerchampion.ai", "market place.example"]) {
    const response = await request("/models", host, "powerchampion.ai");
    const html = await response.text();
    assertRouteUrls(html, "/models", "https://powerchampion.ai");
    assert.match(html, /name="robots" content="noindex, nofollow"/);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  }
  const production = await request("/models", "powerchampion.ai", undefined, "https://powerchampion.ai");
  const productionHtml = await production.text();
  assert.equal(production.headers.get("X-Robots-Tag"), null);
  assert.match(productionHtml, /name="robots" content="index, follow"/);
  assertRouteUrls(productionHtml, "/models", "https://powerchampion.ai");

  for (const path of ["/console", "/account", "/admin", "/login", "/register", "/chat", "/agents/build"]) {
    const response = await request(path, "powerchampion.ai", undefined, "https://powerchampion.ai");
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow", path);
    assert.match(await response.text(), /name="robots" content="noindex, nofollow"/, path);
  }
});

test("measures public pages only, and only when the operator turns it on", async () => {
  const token = "0123456789abcdef0123456789abcdef";
  const beacon = /static\.cloudflareinsights\.com\/beacon\.min\.js/;
  const off = await (await request("/models", "powerchampion.ai", undefined, "https://powerchampion.ai")).text();
  assert.doesNotMatch(off, beacon, "no beacon without an operator token");

  process.env.WEB_ANALYTICS_TOKEN = token;
  try {
    const publicPage = await (await request("/models", "powerchampion.ai", undefined, "https://powerchampion.ai")).text();
    assert.match(publicPage, beacon);
    assert.match(publicPage, /data-cf-beacon=/);
    assert.ok(publicPage.includes(token), "the beacon carries the operator's site token");
    for (const path of ["/account", "/admin", "/login", "/register"]) {
      const privatePage = await (await request(path, "powerchampion.ai", undefined, "https://powerchampion.ai")).text();
      assert.doesNotMatch(privatePage, beacon, `${path} is not measured`);
    }
    const preview = await (await request("/models", "preview.example")).text();
    assert.doesNotMatch(preview, beacon, "preview deployments are not measured");
  } finally {
    delete process.env.WEB_ANALYTICS_TOKEN;
  }
});

test("server-renders complete model social metadata and breadcrumbs", async () => {
  const html = await (await render("/models/bge-m3")).text();
  assertRouteUrls(html, "/models/bge-m3", "https://powerchampion.ai");
  assert.match(html, /property="og:image" content="https:\/\/powerchampion\.ai\/og-platform\.png"/);
  assert.match(html, /name="twitter:title" content="BGE-M3/);
  const structured = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((match) => JSON.parse(match[1]));
  const breadcrumb = structured.find((entry) => entry["@type"] === "BreadcrumbList");
  assert.equal(breadcrumb.itemListElement.at(-1).item, "https://powerchampion.ai/models/bge-m3");
  const organization = structured.find((entry) => entry["@type"] === "Organization");
  assert.equal(organization.legalName, "Power Champion Investment Limited");
  assert.equal(organization.email, "info@powerchampion.org");
  const product = structured.find((entry) => entry["@type"] === "Product");
  assert.equal(product.url, "https://powerchampion.ai/models/bge-m3");
  assert.equal(product.offers.priceSpecification.priceCurrency, "USD");
  assert.equal(product.offers.priceSpecification.unitText, "1M input tokens");
});

test("describes the questions each page renders, in that page's language", async () => {
  for (const [path, expected] of [["/", "en"], ["/ja", "ja"], ["/faq", "en"]]) {
    const html = await (await render(path)).text();
    const structured = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((match) => JSON.parse(match[1]));
    const faq = structured.find((entry) => entry["@type"] === "FAQPage");
    assert.ok(faq, `${path} publishes an FAQPage`);
    assert.ok(faq.mainEntity.length >= 4, `${path} lists its questions`);
    for (const question of faq.mainEntity) {
      assert.equal(question["@type"], "Question");
      assert.ok(question.acceptedAnswer.text.length > 20, `${path} answers ${question.name}`);
      assert.ok(html.includes(question.name.replace(/&/g, "&amp;")), `${path} renders the question it describes`);
    }
    if (expected === "ja") assert.ok(/[ぁ-んァ-ン一-龯]/.test(faq.mainEntity[0].name), "the Japanese page describes Japanese questions");
  }
});

test("server-renders localized primary content with reciprocal search annotations", async () => {
  const markers = { "zh-Hant": /模型/, "zh-Hans": /模型/, ja: /モデル/, ko: /모델/ };
  for (const [language, marker] of Object.entries(markers)) {
    for (const section of ["", "/models", "/pricing", "/infrastructure", "/company"]) {
      const path = `/${language}${section}`;
      const response = await render(path);
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.match(html, new RegExp(`<html lang="${language}"`), path);
      assert.match(html, marker, path);
      assert.match(html, new RegExp(`<link rel="canonical" href="https://powerchampion.ai/${language}${section}"`), path);
      for (const alternate of ["en", "zh-Hant", "zh-Hans", "ja", "ko", "x-default"]) {
        const alternatePath = alternate === "en" || alternate === "x-default"
          ? section
          : `/${alternate}${section}`;
        assert.match(html, new RegExp(`<link rel="alternate" href="${escaped(`https://powerchampion.ai${alternatePath}`)}" hreflang="${alternate}"`), path);
      }
    }
  }
});

test("server-renders the full premium homepage and usable controls in all five languages", async () => {
  const homepages = [
    { path: "/", language: "en", title: "One API. Every possibility.", picker: "Language: English", filter: "Filter models", code: "Code language", pause: "Pause motion" },
    { path: "/zh-Hant", language: "zh-Hant", title: "一組 API。 無限可能。", picker: "語言：繁體中文", filter: "篩選模型", code: "程式碼語言", pause: "暫停動態" },
    { path: "/zh-Hans", language: "zh-Hans", title: "一组 API。 无限可能。", picker: "语言：简体中文", filter: "筛选模型", code: "代码语言", pause: "暂停动态" },
    { path: "/ja", language: "ja", title: "ひとつの API。 広がる可能性。", picker: "言語: 日本語", filter: "モデルを絞り込む", code: "コードの言語", pause: "動きを止める" },
    { path: "/ko", language: "ko", title: "하나의 API. 무한한 가능성.", picker: "언어: 한국어", filter: "모델 필터", code: "코드 언어", pause: "동작 일시 정지" },
  ];
  for (const homepage of homepages) {
    const response = await render(homepage.path);
    assert.equal(response.status, 200, homepage.path);
    const html = await response.text();
    assertRouteUrls(html, homepage.path, "https://powerchampion.ai");
    assert.match(html, new RegExp(`<html lang="${homepage.language}"`), homepage.path);
    const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    assert.equal(h1, homepage.title, homepage.path);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, homepage.path);
    assert.equal((html.match(/<main[ >]/g) ?? []).length, 1, homepage.path);
    assert.match(html, new RegExp(`aria-label="${escaped(homepage.picker)}"`), homepage.path);
    for (const id of ["brand-capabilities-title", "models-title", "applications-title", "developer-title", "model-service-title", "infrastructure-title", "company-title", "faq-title", "cta-title"]) {
      assert.match(html, new RegExp(`id="${id}"`), `${homepage.path} includes ${id}`);
    }
    assert.match(html, /id="hero-model-0"[^>]*role="tab"[^>]*aria-selected="true"/, homepage.path);
    assert.match(html, /id="hero-model-panel"[^>]*role="tabpanel"/, homepage.path);
    assert.match(html, /id="brand-service-panel"[^>]*role="tabpanel"/, homepage.path);
    const showcase = html.match(/<section class="agent-showcase"[\s\S]*?<\/section>/)?.[0];
    assert.ok(showcase, `${homepage.path} includes the agent capability walkthrough`);
    assert.match(showcase, /data-showcase-playing="false"/, `${homepage.path} starts with a readable still`);
    assert.match(showcase, /class="agent-showcase-document"/, `${homepage.path} renders the sample deliverable without JavaScript`);
    assert.match(showcase, /href="\/agents\/build"/, `${homepage.path} provides a real agent entry point`);
    assert.doesNotMatch(showcase, /(?:opacity:0;|visibility:hidden)/, `${homepage.path} does not hide its first scene`);
    assert.match(html, new RegExp(`role="group" aria-label="${escaped(homepage.filter)}"`), homepage.path);
    assert.match(html, new RegExp(`role="group" aria-label="${escaped(homepage.code)}"`), homepage.path);
    assert.match(html, /<button[^>]*aria-pressed="true"[^>]*>Python<\/button>/, homepage.path);
    assert.match(html, /<button[^>]*>cURL<\/button>/, homepage.path);
    const pauseButton = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)].find((match) => match[2].replace(/<[^>]+>/g, "").endsWith(homepage.pause));
    assert.ok(pauseButton, `${homepage.path} has a labeled motion control`);
    assert.match(pauseButton[1], /aria-pressed="false"/, homepage.path);
    assert.match(html, /<details[^>]*>.*?<summary>/s, homepage.path);
    for (const section of ["models", "pricing", "infrastructure", "company"]) {
      const destination = homepage.language === "en" ? `/${section}` : `/${homepage.language}/${section}`;
      assert.match(html, new RegExp(`href="${escaped(destination)}"`), `${homepage.path} links to ${destination}`);
    }
    assert.doesNotMatch(html, /<textarea[^>]*id="ai-prompt"/, homepage.path);
  }
});

test("publishes a five-language Agent introduction with actual FAQs and reciprocal metadata", async () => {
  for (const language of ["en", "zh-Hant", "zh-Hans", "ja", "ko"]) {
    const path = `${language === "en" ? "" : `/${language}`}/agent-platform`;
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, new RegExp(`<html lang="${language}"`), path);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, path);
    assert.equal((html.match(/<main[ >]/g) ?? []).length, 1, path);
    assert.match(html, /class="ap-page"/, path);
    assert.match(html, /href="#agent-deliverables"/, path);
    for (const starter of ["analysis", "comparison", "handover"]) {
      assert.match(html, new RegExp(`href="/tasks\\?starter=${starter}"`), path);
    }
    assert.match(html, /href="\/tasks"/, path);
    assert.match(html, /href="\/agents\/build"/, path);
    assert.match(html, /https:\/\/powerchampion.ai\/og-agents.png\?v=[a-f0-9]{8}/, path);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://powerchampion.ai${path}"`), path);
    const schemas = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].flatMap((match) => JSON.parse(match[1]));
    const faq = schemas.find((item) => item["@type"] === "FAQPage");
    assert.ok(faq?.mainEntity.length >= 3, path);
    assert.equal(faq.url, `https://powerchampion.ai${path}`);
    for (const question of faq.mainEntity) assert.ok(html.includes(question.name.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;")), path);
    for (const alternate of ["en", "zh-Hant", "zh-Hans", "ja", "ko", "x-default"]) {
      const target = `${alternate === "en" || alternate === "x-default" ? "" : `/${alternate}`}/agent-platform`;
      assert.match(html, new RegExp(`<link rel="alternate" href="${escaped(`https://powerchampion.ai${target}`)}" hreflang="${alternate}"`), path);
    }
  }
});

test("server-renders an accessible composer in the standalone chat tool", async () => {
  for (const path of ["/chat"]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, /<h1>What will you<br\/?>\s*<em>make possible\?<\/em><\/h1>/, path);
    assert.match(html, /aria-label="Message composer"/, path);
    assert.match(html, /<label[^>]*for="ai-prompt"[^>]*>Your message<\/label>/, path);
    assert.match(html, /<textarea[^>]*id="ai-prompt"/, path);
    assert.match(html, /aria-label="Send message"/, path);
    assert.match(html, /<option[^>]*value="glm-5.2-fp8"/, path);
    assert.match(html, /<option[^>]*value="qwen3-vl-30b"/, path);
    assert.match(html, /href="\/agents"/, path);
    assert.match(html, /href="\/agents\/build"/, path);
    assert.match(html, /aria-label="Start exploring"/, path);
    assert.equal((html.match(/<main[ >]/g) ?? []).length, 1, path);
    assert.doesNotMatch(html, /One API\.Every possibility\./, path);
  }
});

test("keeps the brand homepage canonical while chat remains a separate tool", async () => {
  for (const path of ["/", "/solutions"]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assertRouteUrls(html, path, "https://powerchampion.ai");
    assert.match(html, /One API\./, path);
    assert.match(html, /Every possibility\./, path);
    assert.match(html, /<link rel="alternate" href="https:\/\/powerchampion\.ai" hreflang="en"/, path);
    assert.match(html, /<link rel="alternate" href="https:\/\/powerchampion\.ai" hreflang="x-default"/, path);
    assert.doesNotMatch(html, /<textarea[^>]*id="ai-prompt"/, path);
  }
  const chatHtml = await (await render("/chat")).text();
  assertRouteUrls(chatHtml, "/chat", "https://powerchampion.ai");
  assert.match(chatHtml, /<title>AI Chat \| Power Champion<\/title>/);
  assert.doesNotMatch(chatHtml, /<link rel="alternate"[^>]+hreflang=/);
});

test("server-renders assistant discovery and a clearly scoped agent builder", async () => {
  const gallery = await render("/agents");
  assert.equal(gallery.status, 200);
  const galleryHtml = await gallery.text();
  assertRouteUrls(galleryHtml, "/agents", "https://powerchampion.ai");
  assert.match(galleryHtml, /<h1[^>]*>An assistant for the way you work\.<\/h1>/);
  assert.match(galleryHtml, /Search assistants/);
  assert.match(galleryHtml, /id="agent-services"/);
  assert.match(galleryHtml, /require a separate integration/);
  for (const id of ["support", "research", "content", "coding"]) {
    assert.match(galleryHtml, new RegExp(`href="/chat\\?agent=${id}"`));
    assert.match(galleryHtml, new RegExp(`href="/agents/build\\?template=${id}"`));
  }
  assert.equal((galleryHtml.match(/<main[ >]/g) ?? []).length, 1);

  const builder = await render("/agents/build");
  assert.equal(builder.status, 200);
  const builderHtml = await builder.text();
  assertRouteUrls(builderHtml, "/agents/build", "https://powerchampion.ai");
  assert.match(builderHtml, /<h1[^>]*>Make it your own\.<\/h1>/);
  assert.match(builderHtml, /Agent name/);
  assert.match(builderHtml, /aria-label="Assembled instructions"/);
  assert.match(builderHtml, /does not deploy a model or connect external tools/);
  assert.equal((builderHtml.match(/<main[ >]/g) ?? []).length, 1);
});

test("server-renders route-specific launch boundaries and protected facts", async () => {
  const homeHtml = await (await render("/")).text();
  assert.match(homeHtml, /href="#models"[^>]*>Explore models/i);
  assert.match(homeHtml, /href="\/contact"[^>]*>Talk to our team/i);

  const statusHtml = await (await render("/status")).text();
  // Backend rows are derived from the live gateway feed at render time; the
  // assertion accepts whichever derived state the gateway currently reports
  // instead of hard-coding "Ready".
  assert.match(statusHtml, /Inference API[\s\S]{0,200}?(Ready|Degraded|Not ready|Not verified)/i);
  assert.match(statusHtml, /Payments[\s\S]{0,200}?(Ready|Degraded|Not ready|Not verified)/i);

  const docsHtml = await (await render("/docs")).text();
  assert.match(docsHtml, /Deployed — the endpoint below is live/i);
  assert.match(docsHtml, /\u00abredacted:sk-\u2026\u00bb/i);

  const contactHtml = await (await render("/contact")).text();
  assert.doesNotMatch(contactHtml, /<(?:input|textarea|select)[^>]+(?:card|bank|email|password|payment|billing)/i);
  assert.doesNotMatch(contactHtml, /<form[^>]+action=/i);

  const termsHtml = await (await render("/terms")).text();
  assert.match(termsHtml, /commercial terms for API usage are formed when a key is issued/i);
  const privacyHtml = await (await render("/privacy")).text();
  assert.match(privacyHtml, /forwarded through this site.{0,100}fixed Power Champion gateway/i);
  assert.match(privacyHtml, /do not save them in browser storage/i);
  assert.doesNotMatch(privacyHtml, /not transmitted to this site/i);

});

test("server-renders local-only contact without payment or personal-data fields", async () => {
  const response = await render("/contact");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<title>Contact Our Team \| Power Champion<\/title>/);
  assert.match(html, /<h1 id="deployment-review-title">Talk to us<\/h1>/i);
  assert.match(html, /No information is transmitted or persisted/i);
  assert.match(html, /<option value="launch-access">API access<\/option>/);
  assert.doesNotMatch(html, /<form[^>]+action=/i);
  assert.match(html, /href="\/company"/);
  assert.doesNotMatch(html, /<(?:input|textarea)[^>]+(?:card|bank|email|password|payment|billing)/i);
});

test("server-renders the cited company evidence brief", async () => {
  const response = await render("/company");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Company \| Power Champion<\/title>/);
  assert.match(html, /Approximately 3\.1 MW/);
  assert.match(html, /Approximately US\$27\.9M over the initial contract term/);
  assert.match(html, /Up to 12 MW if expansion rights are exercised/);
  assert.match(html, /Approximately US\$100M potential total contract value/);
  assert.match(html, /Publication date/);
  assert.match(html, /Registration date shown by directory/);
  assert.match(html, /July 9, 2026/);
  assert.match(html, /https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1563568\/000143774926023245\/ex_986209\.htm/);
});

test("server-renders the complete brand homepage with models and infrastructure", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Power Champion/i);
  assert.match(html, /One API\./i);
  assert.match(html, /Every possibility\./i);
  assert.match(html, /THE MODEL COLLECTION/i);
  assert.match(html, /Check service availability/i);
  assert.match(html, /Configuration, capacity, and delivery are scoped to your project\./i);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("server-renders the model marketplace", async () => {
  const response = await render("/models");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Choose the mind for the task/i);
  assert.match(html, /Search models/i);
  assert.match(html, /Qwen/i);
});

test("server-renders prepaid pricing without payment fields", async () => {
  const response = await render("/pricing");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Pay per use\. No subscription\./i);
  assert.match(html, /Top up your key/i);
  assert.match(html, /redeem codes/i);
  assert.doesNotMatch(html, /<input[^>]+(?:card|payment|billing)/i);
  assert.match(html, /Estimate usage/i);
  assert.match(html, /Model rates/i);
});

test("server-renders docs and the live console", async () => {
  const docs = await render("/docs");
  const docsHtml = await docs.text();
  assert.equal(docs.status, 200);
  assert.match(docsHtml, /One endpoint\. Familiar tools\./i);
  assert.match(docsHtml, /Deployed — the endpoint below is live/i);
  assert.match(docsHtml, /Protected access/i);
  assert.match(docsHtml, /\u00abredacted:sk-\u2026\u00bb/i);

  const consoleResponse = await render("/console");
  const consoleHtml = await consoleResponse.text();
  assert.equal(consoleResponse.status, 200);
  assert.match(consoleHtml, /Live — queries the gateway directly/i);
  assert.match(consoleHtml, /Check your balance/i);
  assert.match(consoleHtml, /Need a key\?/i);
  assert.doesNotMatch(consoleHtml, /sk-[A-Za-z0-9]{12}/);
});


test("server-renders the model platform tools and all model detail routes", async () => {
  const tools = [
    ["/platform", "From model to application."],
    ["/compare", "Find the right fit."],
    ["/playground", "Playground"],
    ["/integrations?model=chroma1-hd", "Your next integration."],
  ];
  for (const [path, heading] of tools) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, new RegExp(`<h1[^>]*>${escaped(heading)}</h1>`), path);
    assert.equal((html.match(/<main[ >]/g) ?? []).length, 1, path);
    assert.match(html, /aria-label="Platform navigation"/);
    if (path === "/playground") {
      assert.match(html, /Extract structured data/);
      assert.match(html, /Loads a prompt\. Nothing is sent\./);
      assert.match(html, /<details class="playground-advanced">/);
      assert.match(html, /id="playground-code-curl"[^>]*aria-selected="true"/);
      assert.match(html, /id="playground-code-python"/);
      assert.match(html, /id="playground-code-javascript"/);
      assert.match(html, /Ready when you are/);
    }
  }
  for (const id of ["glm-5.2-fp8", "qwen3-vl-30b", "flux-schnell", "chroma1-hd", "whisper-large-v3", "indextts2", "bge-m3", "bge-reranker-v2-m3"]) {
    const response = await render(`/models/${id}`);
    assert.equal(response.status, 200, id);
    const html = await response.text();
    assert.match(html, new RegExp(`href="/integrations\\?model=${id}"`));
    assert.equal((html.match(/<main[ >]/g) ?? []).length, 1, id);
  }
  const missing = await render("/models/unpublished-model");
  assert.equal(missing.status, 404);
});

test("server-renders the private task console with account navigation and noindex", async () => {
  const response = await render("/tasks");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Agent Tasks \| Power Champion/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /class="tasks-console"/);
  assert.match(html, /Loading your saved tasks/);
  assert.match(html, /href="\/account"/);
  assert.doesNotMatch(html, /data-cf-beacon/);
});
