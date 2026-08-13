import assert from "node:assert/strict";
import test from "node:test";

async function request(pathname, host = "localhost", forwardedHost) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
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
    title: "Power Champion — Token access launching soon",
    description: "Explore indicative token-access plans for leading open AI models. Launch access is coming soon; pricing and UI data are illustrative, with no funded balance or live API currently available.",
  },
  "/models": {
    title: "Open Model Catalog | Power Champion",
    description: "Compare illustrative open-model token rates, limits, features, and release-review states.",
  },
  "/pricing": {
    title: "Illustrative pricing | Power Champion",
    description: "Illustrative token rates and local launch-access planning; no payment or funded balance is available.",
  },
  "/infrastructure": {
    title: "Infrastructure review | Power Champion",
    description: "Source-qualified infrastructure context and release gates for the Power Champion launch site; not a live deployment status.",
  },
  "/docs": {
    title: "Documentation preview | Power Champion",
    description: "Non-operational integration examples and release-gated future access for Power Champion.",
  },
  "/trust": {
    title: "Trust review | Power Champion",
    description: "Current public trust boundaries and review links for the Power Champion launch site.",
  },
  "/status": {
    title: "Service status | Power Champion",
    description: "Current launch-readiness states for public Power Champion services.",
  },
  "/company": {
    title: "Company | Power Champion",
    description: "Public company context and cited AI infrastructure information for Power Champion.",
  },
  "/contact": {
    title: "Deployment review | Power Champion",
    description: "Review non-binding deployment interests locally in your browser.",
  },
  "/console": {
    title: "Console preview | Power Champion",
    description: "A local illustrative console preview with no account, funded balance, usable key, or live usage.",
  },
  "/faq": {
    title: "FAQ | Power Champion",
    description: "Plain-language answers about the current Power Champion launch site and its public boundaries.",
  },
  "/terms": {
    title: "Terms | Power Champion",
    description: "The current informational and non-transactional terms for the Power Champion launch site.",
  },
  "/privacy": {
    title: "Privacy | Power Champion",
    description: "The current privacy boundary for local Power Champion launch-site interactions.",
  },
};

const routes = [
  "/", "/models", "/pricing", "/infrastructure", "/docs", "/trust",
  "/status", "/company", "/contact", "/console", "/faq", "/terms", "/privacy",
];

const shellDestinations = [
  "/models", "/pricing", "/infrastructure", "/docs", "/trust", "/status",
  "/company", "/contact", "/console", "/faq", "/terms", "/privacy",
];

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
      /all systems operational|buy now|funded account|live inference|SOC 2 certified|ISO 27001 certified|we own (?:a|the) data cent(?:re|er)|deployed 3\.1 MW/i,
    );
    assert.match(html, /property="og:title" content="Token access launching soon\."/);
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
    assert.match(html, /name="twitter:title" content="Token access launching soon\."/);
    assert.match(html, /rel="shortcut icon" href="\/favicon\.png"/);
    assert.match(html, /rel="icon" href="\/favicon\.png"/);
    assert.doesNotMatch(html, /Explore leading open AI models with one API and one prepaid balance\./);
    assert.match(html, /property="og:image" content="http:\/\/localhost\/og\.png"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
  }

  const publicResponse = await render("/", "marketplace.example");
  const publicHtml = await publicResponse.text();
  assert.match(
    publicHtml,
    /property="og:image" content="https:\/\/marketplace\.example\/og\.png"/,
  );
});

test("redirects the browser compatibility favicon to the published PNG", async () => {
  const response = await request("/favicon.ico");

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "http://localhost/favicon.png");
});

test("normalizes valid metadata hosts and fails closed on malformed values", async () => {
  const cases = [
    { host: "marketplace.example:8443", expected: "https://marketplace.example:8443/og.png" },
    { host: "marketplace.example.", expected: "https://marketplace.example./og.png" },
    { host: "203.0.113.10:9443", expected: "https://203.0.113.10:9443/og.png" },
    { host: "[2001:db8::1]:8443", expected: "https://[2001:db8::1]:8443/og.png" },
    { host: "localhost:4173", expected: "http://localhost:4173/og.png" },
    { host: "localhost.:4173", expected: "http://localhost.:4173/og.png" },
    { host: "127.0.0.1:4173", expected: "http://127.0.0.1:4173/og.png" },
    { host: "[::1]:4173", expected: "http://[::1]:4173/og.png" },
  ];

  for (const { host, expected } of cases) {
    const html = await (await render("/", host)).text();
    assert.match(html, new RegExp(`property="og:image" content="${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }

  const forwardedHtml = await (await render("/", "internal.example", "edge.example:7443, internal.example")).text();
  assert.match(forwardedHtml, /property="og:image" content="https:\/\/edge\.example:7443\/og\.png"/);

  for (const malformed of [
    "market place.example",
    "https://marketplace.example",
    "user@marketplace.example",
    "marketplace.example/path",
    "marketplace.example:0",
    "marketplace.example:65536",
    "marketplace.example:not-a-port",
    "marketplace.example%0d%0ax-injected:yes",
    "-marketplace.example",
    "marketplace..example",
  ]) {
    const html = await (await render("/", malformed)).text();
    assert.match(html, /property="og:image" content="http:\/\/localhost\/og\.png"/, malformed);
  }
});

test("server-renders route-specific launch boundaries and protected facts", async () => {
  const homeHtml = await (await render("/")).text();
  assert.match(homeHtml, /href="\/pricing"[^>]*>Compare token rates<\/a>/i);
  assert.match(homeHtml, /href="\/contact"[^>]*>Deployment review/i);

  const statusHtml = await (await render("/status")).text();
  assert.match(statusHtml, /Inference API[\s\S]*Not ready/i);
  assert.match(statusHtml, /Payments[\s\S]*Not ready/i);

  const docsHtml = await (await render("/docs")).text();
  assert.match(docsHtml, /non-operational examples only/i);
  assert.match(docsHtml, /pc_demo_YOUR_KEY/i);

  const contactHtml = await (await render("/contact")).text();
  assert.doesNotMatch(contactHtml, /<(?:input|textarea|select)[^>]+(?:card|bank|email|password|payment|billing)/i);
  assert.doesNotMatch(contactHtml, /<form[^>]+action=/i);

  for (const pathname of ["/terms", "/privacy"]) {
    const policyHtml = await (await render(pathname)).text();
    assert.match(policyHtml, /launch site/i, `${pathname} names the current launch-site boundary`);
    assert.match(policyHtml, /(?:does not|not enabled|no purchase|not transmitted|not persist)/i, `${pathname} states a non-operational boundary`);
  }
});

test("server-renders local-only contact without payment or personal-data fields", async () => {
  const response = await render("/contact");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<title>Deployment review \| Power Champion<\/title>/);
  assert.match(html, /Deployment review/i);
  assert.match(html, /No information is transmitted or persisted/i);
  assert.match(html, /<option value="launch-access">Launch access<\/option>/);
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

test("server-renders the finished marketplace homepage", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Power Champion/i);
  assert.match(html, /Every model\./i);
  assert.match(html, /One power core\./i);
  assert.match(html, /Model marketplace/i);
  assert.match(html, /Token access launching soon/i);
  assert.match(html, /Counterparty-reported expected contracted hosting capacity; not live or completed deployment\./i);
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

test("server-renders non-binding launch access without payment fields", async () => {
  const response = await render("/pricing");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Indicative packages. No commitment./i);
  assert.match(html, /Join launch access/i);
  assert.match(html, /do not create orders, charges, or reservations/i);
  assert.doesNotMatch(html, /<input[^>]+(?:card|payment|billing)/i);
  assert.match(html, /Estimate usage/i);
  assert.match(html, /How token billing works/i);
  assert.match(html, /Model rates/i);
});

test("server-renders docs and the local illustrative console preview", async () => {
  const docs = await render("/docs");
  const docsHtml = await docs.text();
  assert.equal(docs.status, 200);
  assert.match(docsHtml, /One endpoint\. Familiar tools\./i);
  assert.match(docsHtml, /Public preview/i);
  assert.match(docsHtml, /Protected access/i);
  assert.match(docsHtml, /pc_demo_YOUR_KEY/i);

  const consoleResponse = await render("/console");
  const consoleHtml = await consoleResponse.text();
  assert.equal(consoleResponse.status, 200);
  assert.match(consoleHtml, /Launch preview — illustrative only/i);
  assert.match(consoleHtml, /Local display only\. No account, funded balance, usable API key, live API, or live usage\./i);
  assert.match(consoleHtml, /Join launch access/i);
  assert.match(consoleHtml, /\$184\.20/);
  assert.doesNotMatch(consoleHtml, /sk-[A-Za-z0-9]{12}/);
});
