import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from "../app/api/voice-runtime/[...path]/route";

// Test-only value from phase2-contract §1.7; it is not a secret anywhere.
const TOKEN = "test-only-runtime-token-0000000000";
const SITE = "https://powerchampion.ai";
const STATE = "09320efdc7e7ce045273ffa3470cf7596ce48bdd36adf655b860687c276e4cd5";
const PORTAL = "http://powerchampion-portal:3020";

function get(query = "?number=0227001001", headers: Record<string, string> = {}, path = "/api/voice-runtime/config") {
  return new Request(`${SITE}${path}${query}`, { headers: { Authorization: `Bearer ${TOKEN}`, ...headers } });
}
function post(body = '{"schema":"voice.call-report/v1"}', headers: Record<string, string> = {}, path = "/api/voice-runtime/calls") {
  return new Request(`${SITE}${path}`, {
    method: "POST", body,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Content-Length": String(new TextEncoder().encode(body).length), ...headers },
  });
}
function as(method: string, path: string) {
  const body = method === "HEAD" || method === "OPTIONS" ? undefined : "{}";
  return new Request(`${SITE}/api/voice-runtime/${path}?number=0227001001`, {
    method, body, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(body ? { "Content-Length": "2" } : {}) },
  });
}
function portal(response: Response | (() => Response)) {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(typeof response === "function" ? response() : response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function fixedHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("set-cookie")).toBeNull();
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("voice runtime route (server to server)", () => {
  it("allows exactly GET config and POST calls; every other path or method is 404 without calling the portal", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const fetchMock = portal(() => Response.json({ ok: true }));
    const refused = [
      GET(get("?number=0227001001", {}, "/api/voice-runtime/calls")), POST(post(undefined, {}, "/api/voice-runtime/config")),
      GET(get("", {}, "/api/voice-runtime/usage")), GET(get("?number=0227001001", {}, "/api/voice-runtime/config/")),
      GET(get("?number=0227001001", {}, "/api/voice-runtime/%2e%2e/portal/session")), GET(get("?number=0227001001", {}, "/api/voice-runtime/Config")),
      GET(get("?number=0227001001", {}, "/api/voice-runtime/config%2f..")), POST(post(undefined, {}, "/api/voice-runtime/calls/x")),
      PUT(as("PUT", "calls")), PATCH(as("PATCH", "calls")), DELETE(as("DELETE", "calls")), OPTIONS(as("OPTIONS", "config")),
      HEAD(as("HEAD", "config")), DELETE(as("DELETE", "config")),
    ];
    for (const response of await Promise.all(refused)) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found", detail: "This runtime endpoint does not exist." });
      fixedHeaders(response);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed Authorization itself, so the portal never sees it", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const fetchMock = portal(() => Response.json({ ok: true }));
    for (const authorization of ["", TOKEN, `Bearer ${TOKEN.slice(0, 31)}`, `bearer ${TOKEN}`, `Bearer  ${TOKEN}`, `Bearer ${"x".repeat(257)}`,
      `Basic ${TOKEN}`, `Bearer ${TOKEN} x`]) {
      for (const request of [get("?number=0227001001", { Authorization: authorization }), post(undefined, { Authorization: authorization })]) {
        const response = await (request.method === "GET" ? GET(request) : POST(request));
        expect(response.status).toBe(401);
        expect((await response.json()).error).toBe("runtime_auth");
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only the checked query and headers to the portal's internal path", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const fetchMock = portal(() => Response.json({ schema: "voice.runtime-config/v1", state_sha256: STATE }, { headers: { ETag: `"${STATE}"` } }));
    const response = await GET(get(`?number=%2B886227001001&have=${STATE}&store=x&number=0`, {
      Cookie: "pc_portal_session=abc", "X-Forwarded-For": "203.0.113.9", "CF-Connecting-IP": "198.51.100.7",
      "If-None-Match": `"${STATE}"`, "X-Other": "1",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${STATE}"`);
    fixedHeaders(response);
    expect(await response.json()).toEqual({ schema: "voice.runtime-config/v1", state_sha256: STATE });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PORTAL}/api/portal/voice/runtime/config?number=%2B886227001001&have=${STATE}`);
    expect(init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store" });
    expect(init.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${TOKEN}`, Origin: SITE, "If-None-Match": `"${STATE}"` });
    // Domestic numbers and extensions need no encoding; a malformed If-None-Match is dropped.
    await GET(get("?number=ext:6201", { "If-None-Match": "W/\"x\"" }));
    expect(fetchMock.mock.calls[1][0]).toBe(`${PORTAL}/api/portal/voice/runtime/config?number=ext%3A6201`);
    expect(fetchMock.mock.calls[1][1].headers["If-None-Match"]).toBeUndefined();
  });

  it("checks number and have before calling the portal", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const fetchMock = portal(() => Response.json({}));
    // An unencoded "+" is a space in a query string.
    for (const query of ["", "?number=", "?number=+886227001001", "?number=02%202700%201001", "?number=0227001001%0A", `?number=${"1".repeat(21)}`,
      "?number=EXT:6201"]) {
      const response = await GET(get(query));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_number");
    }
    for (const have of ["x", "A".repeat(64), "a".repeat(63), ""]) {
      const response = await GET(get(`?number=0227001001&have=${have}`));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_input");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a 304 through with its ETag and no body", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const cancel = vi.fn();
    portal(() => {
      const response = new Response(null, { status: 304, headers: { ETag: `"${STATE}"` } });
      Object.defineProperty(response, "body", { value: { cancel } });
      return response;
    });
    const response = await GET(get("?number=0227001001", { "If-None-Match": `"${STATE}"` }));
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(`"${STATE}"`);
    expect(await response.text()).toBe("");
    fixedHeaders(response);
    expect(cancel).toHaveBeenCalled();
  });

  it("forwards a report as sent and passes the portal's answer through", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const body = JSON.stringify({ schema: "voice.call-report/v1", call_id: "1797815702.118", note: "原樣" });
    const fetchMock = portal(() => Response.json({ result: "created", id: "a".repeat(32) }, { status: 201 }));
    const response = await POST(post(body, { Cookie: "pc_portal_session=abc", "X-Forwarded-For": "203.0.113.9" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ result: "created", id: "a".repeat(32) });
    fixedHeaders(response);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PORTAL}/api/portal/voice/runtime/calls`);
    expect(init.body).toBe(body);
    expect(init.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${TOKEN}`, Origin: SITE, "Content-Type": "application/json" });
    for (const [status, error] of [[409, "call_conflict"], [400, "call_invalid"], [429, "rate_limited"], [404, "not_found"], [401, "runtime_auth"],
      [503, "voice_runtime_unconfigured"]] as const) {
      portal(() => Response.json({ error, detail: "from the portal" }, { status }));
      const answer = await POST(post(body));
      expect(answer.status).toBe(status);
      expect(await answer.json()).toEqual({ error, detail: "from the portal" });
    }
  });

  it("checks type and size before reading a report; 8193 bytes never reach the portal", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const fetchMock = portal(() => Response.json({ result: "created" }, { status: 201 }));
    const exact = `{"pad":"${"x".repeat(8192 - 10)}"}`;
    expect(new TextEncoder().encode(exact).length).toBe(8192);
    expect((await POST(post(exact))).status).toBe(201);
    const over = `{"pad":"${"x".repeat(8193 - 10)}"}`;
    const refused = [
      POST(post(over)), POST(post("{}", { "Content-Type": "text/plain" })),
      POST(new Request(`${SITE}/api/voice-runtime/calls`, { method: "POST", body: "{}", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } })),
      POST(post(over, { "Content-Length": "100" })), POST(post("{}", { "Content-Length": "-1" })),
    ];
    const statuses = [];
    for (const response of await Promise.all(refused)) {
      statuses.push(response.status);
      expect((await response.json()).error).toBe("invalid_input");
    }
    expect(statuses).toEqual([413, 415, 413, 413, 413]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("turns portal failures into 502, 503 and 504", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    for (const make of [
      () => Response.json({ error: "internal_error", detail: "x" }, { status: 500 }),
      () => Response.json({ error: "service_unavailable", detail: "x" }, { status: 503 }),
      () => new Response("not json", { status: 200 }),
      () => Response.json(["not", "an", "object"]),
      () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/" } }),
      () => Response.json({ pad: "x".repeat(262144) }),
    ]) {
      portal(make);
      const response = await GET(get());
      expect(response.status).toBe(502);
      expect((await response.json()).error).toBe("voice_runtime_unavailable");
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const down = await POST(post());
    expect(down.status).toBe(503);
    expect((await down.json()).error).toBe("voice_runtime_unavailable");

    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    let settled = false;
    const slow = GET(get()).then((response) => { settled = true; return response; });
    await vi.advanceTimersByTimeAsync(9999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const timedOut = await slow;
    expect(timedOut.status).toBe(504);
    expect((await timedOut.json()).error).toBe("voice_runtime_timeout");
  });

  it("has no portal to call outside local development without PC_PORTAL_ORIGIN", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = portal(() => Response.json({}));
    const response = await GET(get());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("voice_runtime_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows GET deletions and POST deletions/<id>/ack for the records sender (§16.3), nothing near them", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const fetchMock = portal(() => Response.json({ ok: true }));
    const id = "0123456789abcdef0123456789abcdef";
    const ack = (path: string, method = "POST") =>
      new Request(`${SITE}/api/voice-runtime/${path}`, {
        method, body: method === "GET" || method === "HEAD" ? undefined : "{}",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Content-Length": "2" },
      });
    const refused = [
      GET(get("", {}, "/api/voice-runtime/deletions/")), GET(get("", {}, `/api/voice-runtime/deletions/${id}`)),
      GET(get("", {}, `/api/voice-runtime/deletions/${id}/ack`)), POST(ack("deletions")), POST(ack(`deletions/${id}`)),
      POST(ack(`deletions/${id.toUpperCase()}/ack`)), POST(ack(`deletions/${id.slice(1)}/ack`)), POST(ack(`deletions/${id}x/ack`)),
      POST(ack(`deletions/${id}/ack/x`)), POST(ack(`deletions/${id}/ack/`)), POST(ack(`deletions/%2e%2e/${id}/ack`)),
      DELETE(ack(`deletions/${id}`, "DELETE")), PUT(ack(`deletions/${id}/ack`, "PUT")), DELETE(ack("deletions", "DELETE")),
    ];
    for (const response of await Promise.all(refused)) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found", detail: "This runtime endpoint does not exist." });
      fixedHeaders(response);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await GET(get("", {}, "/api/voice-runtime/deletions"))).status).toBe(200);
    expect((await POST(ack(`deletions/${id}/ack`))).status).toBe(200);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [`${PORTAL}/api/portal/voice/runtime/deletions`, "GET"],
      [`${PORTAL}/api/portal/voice/runtime/deletions/${id}/ack`, "POST"],
    ]);
  });

  it("forwards only a checked after and limit when pulling deletions", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const page = { schema: "voice.deletions/v1", deletions: [], cursor: "12", more: false };
    const fetchMock = portal(() => Response.json(page));
    const response = await GET(get("?after=12&limit=100&store=x&call_id=1", { Cookie: "pc_portal_session=abc", "X-Forwarded-For": "203.0.113.9" },
      "/api/voice-runtime/deletions"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    fixedHeaders(response);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${PORTAL}/api/portal/voice/runtime/deletions?after=12&limit=100`);
    expect(init.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${TOKEN}`, Origin: SITE });
    await GET(get("?limit=5", {}, "/api/voice-runtime/deletions"));
    expect(fetchMock.mock.calls[1][0]).toBe(`${PORTAL}/api/portal/voice/runtime/deletions?limit=5`);
    for (const query of ["?after=-1", "?after=x", `?after=${"1".repeat(19)}`, "?after=", "?limit=0", "?limit=501", "?limit=1.5", "?limit=",
      "?limit=0100"]) {
      const refused = await GET(get(query, {}, "/api/voice-runtime/deletions"));
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toBe("invalid_input");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checks an acknowledgement's type and size (1024 bytes) and passes the portal's answer through", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const id = "0123456789abcdef0123456789abcdef";
    const path = `/api/voice-runtime/deletions/${id}/ack`;
    const fetchMock = portal(() => Response.json({ id, result: "acked", status: "done", done_at: "2026-10-23T01:00:00Z" }));
    const body = '{"files_deleted":3,"rows_deleted":2}';
    const response = await POST(post(body, {}, path));
    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("acked");
    expect(fetchMock.mock.calls[0][1].body).toBe(body);
    const exact = `{"pad":"${"x".repeat(1024 - 10)}"}`;
    expect(new TextEncoder().encode(exact).length).toBe(1024);
    expect((await POST(post(exact, {}, path))).status).toBe(200);
    const over = `{"pad":"${"x".repeat(1025 - 10)}"}`;
    const statuses = [];
    for (const refused of [await POST(post(over, {}, path)), await POST(post("{}", { "Content-Type": "text/plain" }, path))]) {
      statuses.push(refused.status);
      expect((await refused.json()).error).toBe("invalid_input");
    }
    expect(statuses).toEqual([413, 415]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [status, error] of [[404, "deletion_not_found"], [400, "invalid_input"], [429, "rate_limited"]] as const) {
      portal(() => Response.json({ error, detail: "from the portal" }, { status }));
      const answer = await POST(post(body, {}, path));
      expect(answer.status).toBe(status);
      expect(await answer.json()).toEqual({ error, detail: "from the portal" });
    }
  });

  it("logs nothing, so neither the token nor a report can end up in a log", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", PORTAL);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    portal(() => Response.json({ error: "call_invalid", detail: "unknown field: transcript" }, { status: 400 }));
    await POST(post('{"transcript":"客人說的話"}'));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await GET(get());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
