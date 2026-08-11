import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname, host = "localhost") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, `http://${host}`), {
      headers: { accept: "text/html", host },
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

test("server-renders a complete English marketplace shell with social metadata", async () => {
  for (const pathname of ["/", "/models", "/pricing", "/docs", "/console"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} returns 200`);

    const html = await response.text();
    assert.match(html, /Power Champion/i, `${pathname} includes the shared brand`);
    assert.match(html, /href="\/models"/, `${pathname} links to models`);
    assert.match(html, /href="\/pricing"/, `${pathname} links to pricing`);
    assert.match(html, /href="\/docs"/, `${pathname} links to docs`);
    assert.match(html, /href="\/console"/, `${pathname} links to console`);
    assert.match(html, /lang="en"/, `${pathname} defaults to English`);
    assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
    assert.match(html, /Power Champion — Token access launching soon/);
    assert.match(
      html,
      /Launch access is coming soon; pricing and UI data are illustrative, with no funded balance or live API currently available\./,
    );
    assert.match(html, /property="og:title" content="Token access launching soon\."/);
    assert.match(html, /name="twitter:title" content="Token access launching soon\."/);
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
  assert.match(html, /Model rates/i);
});

test("server-renders docs and the demo console", async () => {
  const docs = await render("/docs");
  const docsHtml = await docs.text();
  assert.equal(docs.status, 200);
  assert.match(docsHtml, /One endpoint\. Familiar tools\./i);
  assert.match(docsHtml, /pc_demo_YOUR_KEY/i);

  const consoleResponse = await render("/console");
  const consoleHtml = await consoleResponse.text();
  assert.equal(consoleResponse.status, 200);
  assert.match(consoleHtml, /Demo console/i);
  assert.match(consoleHtml, /\$184\.20/);
  assert.doesNotMatch(consoleHtml, /sk-[A-Za-z0-9]{12}/);
});
