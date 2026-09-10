import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The gateway's public OpenAI-compatible surface, copied here by hand on
 * 2026-09-10 from `@app.get`/`@app.post` decorators in
 * /Users/optyne/repository/b300/sell-panel/.wt-siteinfo/app.py.
 *
 * The marketing site cannot import from the gateway repo, so this is a pinned
 * copy, not a live read. Its job is to fail loudly when someone documents an
 * endpoint the gateway does not serve — publishing a path that 404s is worse
 * than publishing nothing. When the gateway genuinely gains an endpoint,
 * update this list in the same commit that adds it to public/openapi.json.
 *
 * /catalog.json is on the list ahead of the gateway shipping it: it is the
 * agreed contract (design spec §3.1) and the sibling gateway plan's
 * deliverable. Everything else was verified present.
 */
const GATEWAY_PUBLIC_PATHS = [
  "/v1/models",
  "/v1/chat/completions",
  "/v1/completions",
  "/v1/embeddings",
  "/v1/rerank",
  "/v1/images/generations",
  "/v1/audio/speech",
  "/v1/audio/transcriptions",
  "/status.json",
  "/catalog.json",
];

type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string };
  servers: { url: string }[];
  security: Record<string, string[]>[];
  paths: Record<string, Record<string, { operationId?: string; security?: unknown[] }>>;
  components: {
    securitySchemes: Record<string, { type: string; scheme?: string }>;
    schemas: Record<string, unknown>;
    responses: Record<string, unknown>;
  };
};

async function loadSpec(): Promise<{ raw: string; doc: OpenApiDocument }> {
  const raw = await readFile(resolve(process.cwd(), "public/openapi.json"), "utf8");
  return { raw, doc: JSON.parse(raw) as OpenApiDocument };
}

describe("public/openapi.json", () => {
  it("is parseable JSON declaring OpenAPI 3.1", async () => {
    const { doc } = await loadSpec();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Power Champion Gateway API");
  });

  it("points at the gateway, not at the marketing site", async () => {
    const { doc } = await loadSpec();
    expect(doc.servers).toHaveLength(1);
    expect(doc.servers[0].url).toBe("https://b300.powerchampion.ai");
  });

  it("documents only endpoints the gateway actually serves", async () => {
    const { doc } = await loadSpec();
    for (const path of Object.keys(doc.paths)) {
      expect(GATEWAY_PUBLIC_PATHS, `${path} is not on the gateway whitelist`).toContain(path);
    }
  });

  it("documents every OpenAI-compatible endpoint the spec listed", async () => {
    const { doc } = await loadSpec();
    for (const path of GATEWAY_PUBLIC_PATHS) {
      expect(Object.keys(doc.paths), `${path} is missing`).toContain(path);
    }
  });

  it("gives every operation a unique operationId", async () => {
    const { doc } = await loadSpec();
    const ids = Object.values(doc.paths)
      .flatMap((methods) => Object.values(methods))
      .map((operation) => operation.operationId);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("secures the API with a bearer key and leaves the public JSON open", async () => {
    const { doc } = await loadSpec();
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths["/status.json"].get.security).toEqual([]);
    expect(doc.paths["/catalog.json"].get.security).toEqual([]);
    // A protected endpoint must NOT opt out of the document-level requirement.
    expect(doc.paths["/v1/chat/completions"].post.security).toBeUndefined();
  });

  it("resolves every internal $ref", async () => {
    const { raw, doc } = await loadSpec();
    const defined = new Set([
      ...Object.keys(doc.components.schemas).map((k) => `schemas/${k}`),
      ...Object.keys(doc.components.responses).map((k) => `responses/${k}`),
    ]);
    const referenced = [...raw.matchAll(/#\/components\/(schemas|responses)\/([A-Za-z0-9_]+)/g)]
      .map((m) => `${m[1]}/${m[2]}`);
    expect(referenced.length).toBeGreaterThan(0);
    const dangling = [...new Set(referenced)].filter((ref) => !defined.has(ref));
    expect(dangling).toEqual([]);
  });

  it("describes the OpenAI-compatible request fields callers actually send", async () => {
    const { doc } = await loadSpec();
    const chat = doc.components.schemas.ChatCompletionRequest as {
      properties: Record<string, unknown>;
      required: string[];
    };
    for (const field of ["model", "messages", "stream", "max_tokens", "temperature", "top_p", "stop", "tools"]) {
      expect(Object.keys(chat.properties), `chat request is missing ${field}`).toContain(field);
    }
    expect(chat.required).toEqual(["model", "messages"]);
  });
});
