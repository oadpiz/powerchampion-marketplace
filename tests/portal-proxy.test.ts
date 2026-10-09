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
