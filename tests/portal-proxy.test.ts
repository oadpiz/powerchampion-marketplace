import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST, DELETE } from "../app/api/portal/[...path]/route";

function request(path = "/session", method = "GET", body?: unknown, extra: Record<string, string> = {}, origin = "http://localhost:3010") {
  return new Request(`${origin}/api/portal${path}`, { method, headers: { origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("portal service boundary", () => {
  it("proxies only authenticated runtime route shapes and preserves exact-origin mutations", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ task: { status: "queued" } })));
    vi.stubGlobal("fetch", fetchMock);
    const id = "a".repeat(32);
    for (const path of ["/runtime/config", "/runtime/tasks", `/runtime/tasks/${id}`, `/runtime/tasks/${id}/artifacts/${id}`]) {
      expect((await GET(request(path))).status).toBe(200);
    }
    for (const path of ["/runtime/tasks", `/runtime/tasks/${id}/control`, `/runtime/tasks/${id}/instructions`, `/runtime/tasks/${id}/approval`]) {
      expect((await POST(request(path, "POST", {}))).status).toBe(200);
      expect((await POST(request(path, "POST", {}, { origin: "https://foreign.example" }))).status).toBe(403);
    }
    const calls = fetchMock.mock.calls.length;
    for (const path of ["/runtime/worker", `/runtime/tasks/${id}/credential`, `/runtime/tasks/${id}/artifacts/invalid`, "/runtime/tasks/other-owner-key", `/runtime/tasks/${id}/approval/anything`]) {
      expect((await GET(request(path))).status).toBe(404);
      expect((await POST(request(path, "POST", {}))).status).toBe(404);
    }
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("accepts bounded multilingual runtime references without enlarging other portal requests", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ task: {} }))));
    expect((await POST(request("/runtime/tasks", "POST", { references: [{ name: "中文資料", content: "中".repeat(32000) }] }))).status).toBe(200);
    expect((await POST(request("/runtime/tasks", "POST", { padding: "x".repeat(196608) }))).status).toBe(413);
    expect((await POST(request("/auth/login", "POST", { padding: "中".repeat(32000) }))).status).toBe(413);
  });
  it("forwards only the session cookie to the fixed local service, preserving authentication status", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "auth_required" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request("/session?endpoint=https://evil.example", "GET", undefined, { cookie: "unrelated=private; pc_portal_session=abcdefghijklmnopqrstuvwxyz123456; admin=do-not-forward", authorization: "Bearer private" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:3020/api/portal/session");
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.get("cookie")).toBe("pc_portal_session=abcdefghijklmnopqrstuvwxyz123456");
    expect(init.headers.get("authorization")).toBeNull();
    expect(init.redirect).toBe("manual");
  });

  it("requires a configured HTTPS service in production and rejects unsafe configuration", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const value of ["", "http://127.0.0.1:3020", "https://user:pass@portal.example", "https://portal.example/elsewhere"]) {
      vi.stubEnv("PC_PORTAL_ORIGIN", value);
      expect((await GET(request("/session", "GET", undefined, {}, "https://powerchampion.ai"))).status).toBe(503);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows cleartext in production only to a private Compose service name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "auth_required" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    expect((await GET(request("/session", "GET", undefined, {}, "https://powerchampion.ai"))).status).toBe(401);
    expect(fetchMock.mock.calls[0][0]).toBe("http://powerchampion-portal:3020/api/portal/session");
    for (const value of ["http://portal.example:3020", "http://10.0.0.5:3020", "http://[fd00::1]:3020", "http://2130706433:3020"]) {
      vi.stubEnv("PC_PORTAL_ORIGIN", value);
      expect((await GET(request("/session", "GET", undefined, {}, "https://powerchampion.ai"))).status).toBe(503);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes agent management through but keeps agent resolution off the browser boundary", async () => {
    // Each network response has its own body stream; a consumed response cannot be reused.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ agents: [] })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const id = "a".repeat(32);
    expect((await GET(request("/agents"))).status).toBe(200);
    expect((await GET(request(`/agents/${id}`))).status).toBe(200);
    expect((await POST(request("/agents", "POST", { name: "Support" }))).status).toBe(200);
    expect((await POST(request(`/agents/${id}/versions`, "POST", { name: "Support" }))).status).toBe(200);
    expect((await POST(request(`/agents/${id}/token`, "POST", {}))).status).toBe(200);
    expect((await DELETE(request(`/agents/${id}`, "DELETE"))).status).toBe(200);
    const calls = fetchMock.mock.calls.length;
    // A literal /../ is normalized to /keys by Request before reaching the proxy.
    // Keep the encoded traversal in the actual request path to exercise the allowlist.
    for (const blocked of ["/agents/resolve", `/agents/${id}/resolve`, "/agents/%2e%2e%2fkeys", `/agents/${id}/versions/1`]) {
      expect((await POST(request(blocked, "POST", {}))).status).toBe(404);
      expect((await GET(request(blocked))).status).toBe(404);
    }
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("allows the account-management and password routes and nothing adjacent", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const id = "a".repeat(32);
    for (const allowed of ["/password", `/admin/customers/${id}/status`, `/admin/customers/${id}/role`, `/admin/customers/${id}/reset-password`]) {
      expect((await POST(request(allowed, "POST", {}))).status).toBe(200);
    }
    expect(fetchMock.mock.calls.length).toBe(4);
    for (const blocked of [`/admin/customers/${id}/delete`, "/admin/customers/not-hex/status", `/admin/customers/${id}`, "/password/reset"]) {
      expect((await POST(request(blocked, "POST", {}))).status).toBe(404);
    }
    expect(fetchMock.mock.calls.length).toBe(4);
  });

  it("proxies the gateway administration routes to the exact upstream path", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const id = "a".repeat(32);
    const get = ["/admin/keys", "/admin/usage", "/admin/gateway", "/admin/gateway/nodes/b300-1.node/jobs/job_1.2-x"];
    const post = [
      `/admin/customers/${id}/keys`,
      "/admin/keys/key_ABC-123/disable", "/admin/keys/key_ABC-123/limits", "/admin/keys/key_ABC-123/balance",
      "/admin/gateway/models/zai-org%2FGLM-5.3/toggle", "/admin/gateway/models/glm-5.3:fp8/maintenance",
      ...["start", "stop", "restart", "check", "backup", "fw-status"].map((action) => `/admin/gateway/nodes/b300-1/ops/${action}`),
    ];
    for (const path of get) expect((await GET(request(path))).status).toBe(200);
    for (const path of post) expect((await POST(request(path, "POST", {}))).status).toBe(200);
    expect((await POST(request("/admin/keys/key_ABC-123/disable", "POST"))).status).toBe(200);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      ...get, ...post, "/admin/keys/key_ABC-123/disable",
    ].map((path) => `http://127.0.0.1:3020/api/portal${path}`));
    expect(fetchMock.mock.calls.at(-1)?.[1].body).toBeUndefined();
  });

  it("proxies the persona, fleet, control-job and redeem administration routes to the exact upstream path", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const get = [
      "/admin/personas", "/admin/personas/abc123def456",
      "/admin/gateway/fleet/events", "/admin/gateway/fleet/glm-5.2-fp8/status", "/admin/gateway/fleet/glm-5.2-fp8:fp8/timeline",
      "/admin/gateway/control/jobs/0123456789abcdef", "/admin/redeem/codes", "/admin/redeem/codes/export",
    ];
    const post = [
      "/admin/personas", "/admin/personas/abc123def456/revisions", "/admin/personas/abc123def456/activate", "/admin/personas/abc123def456/try",
      ...["freeze", "resume", "candidate", "drain", "approve", "rollback"].map((action) => `/admin/gateway/fleet/glm-5.2-fp8/${action}`),
      "/admin/redeem/codes", "/admin/redeem/codes/code_1-x/disable",
    ];
    for (const path of get) expect((await GET(request(path))).status).toBe(200);
    for (const path of post) expect((await POST(request(path, "POST", {}))).status).toBe(200);
    expect((await POST(request("/admin/gateway/fleet/glm-5.2-fp8/freeze", "POST"))).status).toBe(200);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(
      [...get, ...post, "/admin/gateway/fleet/glm-5.2-fp8/freeze"].map((path) => `http://127.0.0.1:3020/api/portal${path}`),
    );
    expect(fetchMock.mock.calls.at(-1)?.[1].body).toBeUndefined();
  });

  it("forwards only valid persona revision and fleet event query parameters", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request("/admin/personas/abc123def456?rev=3&other=x"))).status).toBe(200);
    expect((await GET(request("/admin/gateway/fleet/events?modelId=glm-5.2-fp8&limit=20&other=x"))).status).toBe(200);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:3020/api/portal/admin/personas/abc123def456?rev=3",
      "http://127.0.0.1:3020/api/portal/admin/gateway/fleet/events?modelId=glm-5.2-fp8&limit=20",
    ]);
    for (const path of ["/admin/personas/abc123def456?rev=0", "/admin/personas/abc123def456?rev=abc", "/admin/gateway/fleet/events?limit=0",
      "/admin/gateway/fleet/events?limit=1000", "/admin/gateway/fleet/events?modelId=a%2Fb"]) {
      const response = await GET(request(path));
      expect(response.status, path).toBe(400);
      expect((await response.json()).error).toBe("invalid_input");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses persona, fleet, control and redeem shapes outside the allowlist", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const path of ["/admin/gateway/fleet/glm-5.2-fp8/delete", "/admin/gateway/fleet/a%2Fb/freeze", "/admin/gateway/fleet/%2e%2e/freeze",
      "/admin/personas/x/delete", "/admin/personas//try", "/admin/redeem/codes/x/enable", "/admin/gateway/control/mode"]) {
      expect((await POST(request(path, "POST", {}))).status, path).toBe(404);
    }
    expect((await DELETE(request("/admin/redeem/codes/x", "DELETE"))).status).toBe(404);
    for (const path of ["/admin/gateway/control/switch", "/admin/gateway/control"]) expect((await GET(request(path))).status, path).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows larger persona revisions and redeem exports only on their own routes", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const big = { system: "x".repeat(150 * 1024) };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ rev: 2 }))));
    expect((await POST(request("/admin/personas/abc123def456/revisions", "POST", big))).status).toBe(200);
    expect((await POST(request("/admin/personas/abc123def456/activate", "POST", big))).status).toBe(413);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ csv: "x".repeat(3 * 1024 * 1024) }))));
    expect((await GET(request("/admin/redeem/codes/export"))).status).toBe(200);
    expect((await GET(request("/admin/redeem/codes"))).status).toBe(502);
  });

  it("gives persona try a longer timeout than the other routes", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("PC_PORTAL_ORIGIN", "");
      vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })));
      let settled = false;
      const trying = POST(request("/admin/personas/abc123def456/try", "POST", { input: "x" })).then((response) => { settled = true; return response; });
      await vi.advanceTimersByTimeAsync(20001);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(75000);
      expect((await trying).status).toBe(504);
      const listing = GET(request("/admin/personas"));
      await vi.advanceTimersByTimeAsync(20001);
      expect((await listing).status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a colon in a fleet model id whether raw or encoded as %3A, but never an encoded slash", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request("/admin/gateway/fleet/glm-5.2%3Afp8/status"))).status).toBe(200);
    expect((await POST(request("/admin/gateway/fleet/glm-5.2%3afp8/freeze", "POST"))).status).toBe(200);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:3020/api/portal/admin/gateway/fleet/glm-5.2%3Afp8/status",
      "http://127.0.0.1:3020/api/portal/admin/gateway/fleet/glm-5.2%3afp8/freeze",
    ]);
    expect((await GET(request("/admin/gateway/fleet/glm%2Ffp8/status"))).status).toBe(404);
    expect((await GET(request("/admin/gateway/fleet/glm%25fp8/status"))).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("passes a persona try timeout through as 504 gateway_timeout", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "gateway_timeout", detail: "upstream detail" }, { status: 504 })));
    const response = await POST(request("/admin/personas/abc123def456/try", "POST", { input: "x" }));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "gateway_timeout", detail: "The gateway did not answer in time. The model may still have run and used tokens." });
  });

  it("passes route-specific 4xx errors through unchanged", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "fleet_not_managed", detail: "Not managed." }, { status: 404 })));
    const response = await GET(request("/admin/gateway/fleet/bge-m3/status"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "fleet_not_managed", detail: "Not managed." });
  });

  it("forwards a valid administrator usage month and rejects an invalid one", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request("/admin/usage?month=2026-10"))).status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:3020/api/portal/admin/usage?month=2026-10");
    expect((await GET(request("/admin/usage?month=2026-13"))).status).toBe(400);
    expect((await GET(request("/admin/usage?month=2026-10&evil=1"))).status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:3020/api/portal/admin/usage?month=2026-10");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses adjacent, traversing and malformed gateway administration paths", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const blocked = [
      "/admin/gateway/nodes/x/ops/rm", "/admin/keys//disable", "/admin/gateway/models/%2e%2e/toggle",
      "/admin/gateway/models/a%2F..%2Fb/toggle", "/admin/gateway/nodes/../ops/check", "/admin/customers/not-hex/keys",
      "/admin/keys/x/delete", "/admin/gateway/models/%2E/toggle", "/admin/gateway/nodes/x/jobs/a%2e%2eb",
      "/admin/gateway/nodes//ops/check", "/admin/gateway/nodes/x/ops/check/extra",
    ];
    for (const path of blocked) {
      expect((await POST(request(path, "POST", {}))).status).toBe(404);
      expect((await GET(request(path))).status).toBe(404);
    }
    expect((await DELETE(request("/admin/keys/x", "DELETE"))).status).toBe(404);
    expect((await DELETE(request("/admin/gateway/models/x/toggle", "DELETE"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies only the node allocation routes it knows", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const id = "b".repeat(32);
    const get = ["/admin/allocation", "/admin/allocation/export", "/me/engineer"];
    const post = ["/admin/allocation/engineers", `/admin/allocation/engineers/${id}`, `/admin/allocation/engineers/${id}/status`,
      `/admin/allocation/engineers/${id}/account`, `/admin/allocation/engineers/${id}/account/unlink`,
      "/admin/allocation/nodes/b300-14", "/admin/allocation/owner", "/admin/allocation/export/mark", "/me/engineer/ssh-key"];
    for (const path of get) expect((await GET(request(path))).status).toBe(200);
    for (const path of post) expect((await POST(request(path, "POST", {}))).status).toBe(200);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([...get, ...post].map((path) => `http://127.0.0.1:3020/api/portal${path}`));
    const blocked = ["/admin/allocation/nodes/b300-x", "/admin/allocation/nodes/other-1", "/admin/allocation/engineers/not-hex",
      `/admin/allocation/engineers/${id}/delete`, "/admin/allocation/nodes/b300-14/extra", "/admin/allocation/nodes/..%2fowner",
      `/admin/allocation/engineers/${id}/account/extra`, `/admin/allocation/engineers/${id}/unlink`, "/admin/allocation/engineers/not-hex/account",
      "/me/engineer/ssh-key/extra", "/me/engineers", "/me/engineer/other", "/me", `/me/engineer/${id}`];
    for (const path of blocked) {
      expect((await POST(request(path, "POST", {}))).status).toBe(404);
      expect((await GET(request(path))).status).toBe(404);
    }
    expect((await POST(request("/admin/allocation/export", "POST", {}))).status).toBe(404);
    expect((await GET(request("/admin/allocation/owner"))).status).toBe(404);
    expect((await GET(request("/admin/allocation/export/mark"))).status).toBe(404);
    expect((await POST(request("/me/engineer", "POST", {}))).status).toBe(404);
    expect((await GET(request("/me/engineer/ssh-key"))).status).toBe(404);
    expect((await GET(request(`/admin/allocation/engineers/${id}/account`))).status).toBe(404);
    expect((await DELETE(request("/admin/allocation/nodes/b300-14", "DELETE"))).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(get.length + post.length);
  });

  it("proxies the read-only engineers overview as one exact GET without a query", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ engineers: [] })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request("/admin/engineers"))).status).toBe(200);
    expect((await GET(request("/admin/engineers?node=b300-11&cmd=1"))).status).toBe(200);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://127.0.0.1:3020/api/portal/admin/engineers", "http://127.0.0.1:3020/api/portal/admin/engineers"]);
    const blocked = ["/admin/engineers/", "/admin/engineers/justin", "/admin/engineers/activity", "/admin/engineersx",
      "/admin/engineers/..%2fkeys", "/x/admin/engineers", "/admin/admin/engineers", "/xadmin/engineers",
      "/admin/engineers%2f", "/admin/Engineers"];
    for (const path of blocked) {
      expect((await GET(request(path))).status, path).toBe(404);
      expect((await POST(request(path, "POST", {}))).status, path).toBe(404);
    }
    expect((await POST(request("/admin/engineers", "POST", {}))).status).toBe(404);
    expect((await DELETE(request("/admin/engineers", "DELETE"))).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("relays a gateway outage with its own error code instead of the generic service message", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ error: "gateway_unavailable", detail: "internal gateway.example:9" }, { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request("/admin/gateway"));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text).error).toBe("gateway_unavailable");
    expect(text).not.toContain("gateway.example");
  });

  it("relays a rejected gateway token with its own code and a fixed detail", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ error: "gateway_auth_failed", detail: "internal gateway.example:9 token=secret-abc" }, { status: 503 })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request("/admin/keys"));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "gateway_auth_failed", detail: "The portal's gateway token was rejected. Check PC_GATEWAY_ADMIN_TOKEN." });
    expect(text).not.toContain("gateway.example");
    expect(text).not.toContain("secret-abc");
  });

  it("blocks cross-origin mutations, arbitrary endpoints, invalid months and oversized input", async () => {
    vi.stubGlobal("fetch", vi.fn()); vi.stubEnv("PC_PORTAL_ORIGIN", "");
    expect((await POST(request("/auth/login", "POST", {}, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(request("/auth/logout", "POST", undefined, { origin: "" }))).status).toBe(403);
    expect((await GET(request("/admin/config"))).status).toBe(404);
    expect((await DELETE(request("/admin/customers", "DELETE"))).status).toBe(404);
    expect((await GET(request("/usage?month=2026-13"))).status).toBe(400);
    expect((await POST(request("/auth/login", "POST", { padding: "x".repeat(65536) }))).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("relays hardened login and logout cookies without an upstream Domain attribute", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ user: { id: "1" } }, { headers: { "Set-Cookie": "pc_portal_session=abcdefghijklmnopqrstuvwxyz123456; Domain=internal.example; Path=/different; Max-Age=3600" } }))
      .mockResolvedValueOnce(Response.json({ ok: true }, { headers: { "Set-Cookie": 'pc_portal_session=""; Max-Age=0; Path=/' } }));
    vi.stubGlobal("fetch", fetchMock);
    const login = await POST(request("/auth/login", "POST", { email: "person@example.test", password: "not-real-test-password" }, {}, "https://powerchampion.ai"));
    expect(login.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
    expect(login.headers.get("set-cookie")).toContain("Secure");
    expect(login.headers.get("set-cookie")).not.toContain("Domain");
    const logout = await POST(request("/auth/logout", "POST", undefined, {}, "https://powerchampion.ai"));
    expect(logout.headers.get("set-cookie")).toContain("pc_portal_session=; Path=/");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("does not expose provider errors or infrastructure exceptions", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ error: "internal", private: "secret-token" }, { status: 500 })).mockRejectedValueOnce(new Error("secret-token")));
    expect(await (await GET(request())).text()).not.toContain("secret-token");
    expect(await (await GET(request())).text()).not.toContain("secret-token");
  });

  it("rejects service redirects without forwarding a session to another host", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://other.example" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
    expect(response.headers.has("location")).toBe(false);
  });

  it("preserves the known incomplete-pricing state with a safe message", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "usage_pricing_incomplete", detail: "private upstream details" }, { status: 503 })));
    const response = await GET(request("/usage?month=2026-09"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "usage_pricing_incomplete", detail: "Pricing is incomplete for this usage report. Please contact support." });
  });

  it("accepts an empty stream for logout and revocation as delivered by Workerd", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    for (const [method, path] of [["POST", "/auth/logout"], ["DELETE", "/keys/owned-key"]]) {
      const req = new Request(`http://localhost:3010/api/portal${path}`, { method, headers: { Origin: "http://localhost:3010" }, body: "" });
      expect((await (method === "POST" ? POST : DELETE)(req)).status).toBe(200);
    }
    expect(fetchMock.mock.calls.every((call) => call[1].body === undefined)).toBe(true);
  });
});

describe("video studio routes", () => {
  const UP = "http://127.0.0.1:3020/api/portal";
  const PID = "p" + "0123456789abcdef".repeat(2).slice(0, 31);
  const OP = "f".repeat(32);

  it("proxies the studio GET and POST routes to the exact upstream path", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const gets = ["/studio/templates", "/studio/projects", "/studio/credits", `/studio/projects/${PID}`, `/studio/projects/${PID}/ops/${OP}`, "/admin/studio/usage"];
    for (const path of gets) expect((await GET(request(path))).status, path).toBe(200);
    const posts = ["/studio/projects", "/studio/uploads", `/studio/projects/${PID}/settings`, `/studio/projects/${PID}/quote`, `/studio/projects/${PID}/ops`,
      `/studio/projects/${PID}/shots/0/edit`, `/studio/projects/${PID}/shots/12/edit`, "/admin/studio/credits/grant",
      `/studio/projects/${PID}/delete`, `/studio/projects/${PID}/restore`];
    for (const path of posts) {
      expect((await POST(request(path, "POST", { idempotency_key: "abcdefgh" }))).status, path).toBe(200);
      expect((await POST(request(path, "POST", {}, { origin: "https://foreign.example" }))).status, path).toBe(403);
    }
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([...gets, ...posts].map((path) => UP + path));
    expect(fetchMock.mock.calls.slice(gets.length).every((call) => call[1].method === "POST")).toBe(true);
  });

  it("never reaches the agent's internal API and keeps every mutation POST-only", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const internal = ["/internal/v1/templates", "/internal/v1/projects", `/internal/v1/projects/${PID}/ops`, "/internal/v1/usage", "/studio/internal/v1/templates",
      `/studio/projects/${PID}/internal`, "/studio/media/upload/token", "/media/x", "/studio", "/studio/", "/studio/projects/", `/studio/projects/${PID}/ops/${OP}/cancel`,
      `/studio/projects/${PID}/shots/x/edit`, `/studio/projects/${PID}/shots/1000/edit`, `/studio/projects/${PID}/shots/1`, "/studio/projects/a.b",
      `/studio/projects/${PID}%2F..%2Fcredits`, `/studio/projects/${PID}%2e%2e`, "/studio/projects/" + "a".repeat(65), "/admin/studio", "/admin/studio/credits",
      "/admin/studio/usage/export", "/studio/usage", "/studio/ledger", "/studio/trash",
      `/studio/projects/${PID}/purge`, `/studio/projects/${PID}/delete/now`, `/studio/projects/${PID}/restore/${OP}`];
    for (const path of internal) {
      expect((await GET(request(path))).status, path).toBe(404);
      expect((await POST(request(path, "POST", {}))).status, path).toBe(404);
      expect((await DELETE(request(path, "DELETE"))).status, path).toBe(404);
    }
    // Wrong method for a real route: reads are not mutations and mutations are POST only.
    for (const path of ["/studio/uploads", `/studio/projects/${PID}/settings`, `/studio/projects/${PID}/quote`, `/studio/projects/${PID}/ops`,
      `/studio/projects/${PID}/shots/1/edit`, "/admin/studio/credits/grant", `/studio/projects/${PID}/delete`, `/studio/projects/${PID}/restore`]) {
      expect((await GET(request(path))).status, path).toBe(404);
    }
    // A soft delete is a POST, never the DELETE method.
    for (const path of [`/studio/projects/${PID}/delete`, `/studio/projects/${PID}/restore`]) {
      expect((await DELETE(request(path, "DELETE"))).status, path).toBe(404);
    }
    for (const path of ["/studio/templates", "/studio/credits", `/studio/projects/${PID}`, `/studio/projects/${PID}/ops/${OP}`, "/admin/studio/usage"]) {
      expect((await POST(request(path, "POST", {}))).status, path).toBe(404);
    }
    for (const path of ["/studio/projects", `/studio/projects/${PID}`, `/studio/projects/${PID}/ops/${OP}`]) {
      expect((await DELETE(request(path, "DELETE"))).status, path).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only the allowlisted studio query parameters", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ items: [] })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request("/studio/projects?cursor=1800000000_abc-DEF_1&limit=50&owner=someone-else&evil=1"))).status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe(`${UP}/studio/projects?cursor=1800000000_abc-DEF_1&limit=50`);
    expect((await GET(request("/studio/projects?limit=7"))).status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(`${UP}/studio/projects?limit=7`);
    expect((await GET(request("/admin/studio/usage?month=2027-01&owner=x"))).status).toBe(200);
    expect(fetchMock.mock.calls[2][0]).toBe(`${UP}/admin/studio/usage?month=2027-01`);
    // Other studio routes take no query at all.
    expect((await GET(request(`/studio/projects/${PID}?cursor=1_a&limit=5`))).status).toBe(200);
    expect(fetchMock.mock.calls[3][0]).toBe(`${UP}/studio/projects/${PID}`);
    expect((await GET(request("/studio/credits?month=2027-01"))).status).toBe(200);
    expect(fetchMock.mock.calls[4][0]).toBe(`${UP}/studio/credits`);
    expect((await POST(request("/studio/projects?cursor=1_a&limit=5", "POST", {}))).status).toBe(200);
    expect(fetchMock.mock.calls[5][0]).toBe(`${UP}/studio/projects`);
    // The trash list: deleted=1 only, on the GET list only.
    expect((await GET(request("/studio/projects?deleted=1&limit=20&cursor=1_a&evil=1"))).status).toBe(200);
    expect(fetchMock.mock.calls[6][0]).toBe(`${UP}/studio/projects?cursor=1_a&limit=20&deleted=1`);
    expect((await GET(request(`/studio/projects/${PID}?deleted=1`))).status).toBe(200);
    expect(fetchMock.mock.calls[7][0]).toBe(`${UP}/studio/projects/${PID}`);
    expect((await POST(request(`/studio/projects/${PID}/restore?deleted=1`, "POST", {}))).status).toBe(200);
    expect(fetchMock.mock.calls[8][0]).toBe(`${UP}/studio/projects/${PID}/restore`);
    const calls = fetchMock.mock.calls.length;
    for (const query of ["limit=0", "limit=51", "limit=5x", "limit=", "cursor=bad", "cursor=1_a%7Cb", "cursor=1_" + "a".repeat(65), "cursor=1234567890123_a",
      "deleted=0", "deleted=true", "deleted=", "deleted=11"]) {
      expect((await GET(request(`/studio/projects?${query}`))).status, query).toBe(400);
    }
    expect((await GET(request("/admin/studio/usage?month=2027-13"))).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("rewrites a studio 5xx to the generic service code and passes studio 4xx codes through", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "studio_unavailable", detail: "agent at http://shortvideo-api:8081 down" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ error: "studio_insufficient_credits", detail: "Not enough credits for this step." }, { status: 402 })));
    const outage = await GET(request(`/studio/projects/${PID}`));
    expect(outage.status).toBe(503);
    const body = await outage.json();
    expect(body.error).toBe("service_unavailable");
    expect(JSON.stringify(body)).not.toContain("shortvideo-api");
    const short = await POST(request(`/studio/projects/${PID}/ops`, "POST", { idempotency_key: "abcdefgh" }));
    expect(short.status).toBe(402);
    expect((await short.json()).error).toBe("studio_insufficient_credits");
  });

  it("passes studio_unconfigured through with its own fixed text, so the studio can say it is not open yet", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      Promise.resolve(Response.json({ error: "studio_unconfigured", detail: "PC_STUDIO_AGENT_URL is empty at http://shortvideo-api:8081" }, { status: 503 }))));
    for (const response of [await GET(request("/studio/credits")), await POST(request(`/studio/projects/${PID}/delete`, "POST", {}))]) {
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBe("studio_unconfigured");
      expect(JSON.stringify(body)).not.toContain("shortvideo-api");
      expect(JSON.stringify(body)).not.toContain("PC_STUDIO");
    }
    // Only for studio routes: elsewhere the code is not trusted and becomes the generic outage.
    const other = await GET(request("/overview"));
    expect((await other.json()).error).toBe("service_unavailable");
  });

  it("passes the demo-mode 403 studio_not_open through, so an unlisted account sees the not-open state", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      Promise.resolve(Response.json({ error: "studio_not_open", detail: "The video studio is not open for this account yet." }, { status: 403 }))));
    for (const response of [await GET(request("/studio/credits")), await POST(request("/studio/projects", "POST", {}))]) {
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("studio_not_open");
    }
  });
});
