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
    assert.match(html, /Power Champion — Open Model Power Layer/);
    assert.match(
      html,
      /One prepaid balance for leading open AI models through a clean, OpenAI-compatible API\./,
    );
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

test("server-renders the finished marketplace homepage", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Power Champion/i);
  assert.match(html, /Every model\./i);
  assert.match(html, /One power core\./i);
  assert.match(html, /Model marketplace/i);
  assert.match(html, /Showcase|Illustrative/i);
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

test("server-renders demo pricing with a clear disclaimer", async () => {
  const response = await render("/pricing");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Predictable spend/i);
  assert.match(html, /Showcase prices only/i);
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
