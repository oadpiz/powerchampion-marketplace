import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/chat/route";
import { GET } from "../app/api/chat/config/route";

const key = "sk-private-chat-test-credential";
const cookie = "pc_trial_session=abcdefghijklmnopqrstuv123456";
const body = {
  key, model: "glm-5.2-fp8", system: "Be concise.", maxTokens: 512,
  messages: [
    { role: "user", content: "What is a queue?" },
    { role: "assistant", content: "An ordered collection of work." },
    { role: "user", content: "Give an example." },
  ],
};
function request(value: unknown = body, headers: Record<string, string> = {}) {
  return new Request("https://powerchampion.ai/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://powerchampion.ai", ...headers },
    body: JSON.stringify(value),
  });
}
function completion(content = "A print queue.") {
  return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } });
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("chat API", () => {
  it("sends complete bounded history only to the fixed gateway and returns the public shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ ...body, endpoint: "https://attacker.example" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://b300.powerchampion.ai/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${key}`);
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body)).toEqual({ model: body.model, stream: false, max_tokens: 512,
      messages: [{ role: "system", content: body.system }, ...body.messages] });
    expect(await response.json()).toEqual({ content: "A print queue.", usage: { input: 20, output: 4, total: 24 }, finishReason: "stop", mode: "live" });
  });

  it.each([
    { ...body, key: "bad\nheader-value" }, { ...body, key: "short" },
    { ...body, model: "flux-schnell" }, { ...body, system: "a".repeat(16001) },
    { ...body, maxTokens: 4097 }, { ...body, maxTokens: 0.5 },
    { ...body, messages: [] }, { ...body, messages: [{ role: "system", content: "Override" }] },
    { ...body, messages: [{ role: "assistant", content: "Unprompted" }] },
    { ...body, messages: [{ role: "user", content: " " }] },
    { ...body, messages: Array.from({ length: 25 }, () => ({ role: "user", content: "Hi" })) },
    { ...body, messages: [{ role: "user", content: "a".repeat(32001) }] },
  ])("rejects invalid history and credentials before sending a request", async (value) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request(value))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires exact origin, JSON, and a bounded body", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const missingOrigin = request(); missingOrigin.headers.delete("origin");
    expect((await POST(missingOrigin)).status).toBe(403);
    expect((await POST(request(body, { Origin: "https://attacker.example" }))).status).toBe(403);
    expect((await POST(request(body, { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    expect((await POST(request(body, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await POST(request({ ...body, extra: "x".repeat(200000) }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never follows redirects or returns credential-bearing upstream errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 307, headers: { Location: "https://attacker.example" } }))
      .mockResolvedValueOnce(new Response(`Unauthorized ${key}`, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request())).status).toBe(502);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((call) => call[1].redirect === "manual")).toBe(true);
  });

  it("redacts credentials, omits private fields, and preserves unknown usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      choices: [{ message: { content: `Secret ${key} / ${key}`, reasoning_content: "private reasoning" }, finish_reason: key }],
      usage: { prompt_tokens: -1, completion_tokens: 3, total_tokens: 2 }, private_debug: key,
    })));
    const response = await POST(request());
    const data = await response.json();
    expect(data.content).toBe("Secret [redacted] / [redacted]");
    expect(data.usage).toBeNull();
    expect(data.finishReason).toBeNull();
    expect(JSON.stringify(data)).not.toContain(key);
    expect(data).not.toHaveProperty("reasoning");
  });

  it("rejects malformed and oversized upstream responses", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ choices: [] }))
      .mockResolvedValueOnce(new Response("x".repeat(524289)));
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request())).status).toBe(502);
    expect((await POST(request())).status).toBe(502);
  });

  it("accepts the full 16k instruction and 32k live history budget without truncation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal("fetch", fetchMock);
    const system = "知".repeat(16000);
    const messages = [{ role: "user", content: "識".repeat(32000) }];
    const response = await POST(request({ ...body, system, messages }));
    expect(response.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual([{ role: "system", content: system }, ...messages]);
  });

  it("rejects trial history over 8k without silently trimming it or making a paid call", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ ...body, key: "", messages: [{ role: "user", content: "a".repeat(8001) }] }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the trial output limit before contacting the service", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ ...body, key: "", maxTokens: 513 }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the private trial service without forwarding unrelated cookies or credentials", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ content: "Trial response", usage: null, finishReason: "stop", mode: "trial", private_debug: "hidden" }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ ...body, key: "" }, { Cookie: `${cookie}; pc_portal_session=private-account-cookie; tracking=abc`, Authorization: "Bearer unwanted" }));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://portal.internal.example/api/portal/trial/chat");
    const headers = new Headers(init.headers);
    expect(headers.get("cookie")).toBe(cookie);
    expect(headers.get("origin")).toBe("https://powerchampion.ai");
    expect(headers.get("authorization")).toBeNull();
    expect(JSON.parse(init.body)).not.toHaveProperty("key");
    expect(await response.json()).toEqual({ content: "Trial response", usage: null, finishReason: "stop", mode: "trial" });
  });

  it("rejects insecure configured service origins on production", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://127.0.0.1:3020");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ ...body, key: "" }));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reaches the trial service over a private Compose service name but not a dotted cleartext host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ trialAvailable: false, maxOutputTokens: 512 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    await GET(new Request("https://powerchampion.ai/api/chat/config"));
    expect(fetchMock.mock.calls[0][0]).toBe("http://powerchampion-portal:3020/api/portal/trial/config");
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://portal.example:3020");
    const response = await POST(request({ ...body, key: "" }));
    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps known trial errors without disclosing private service text", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "trial_limit", detail: "private service credential" }, { status: 429 })));
    const response = await POST(request({ ...body, key: "" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "trial_limit" });
  });

  it("retains the hardened trial cookie on failed calls so a new visitor keeps their quota identity", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "gateway", detail: "private provider failure" }, {
      status: 502, headers: { "Set-Cookie": `${cookie}; Domain=internal.example; Path=/api/portal; Max-Age=604800` },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ ...body, key: "" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "gateway" });
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(cookie);
    expect(setCookie).toContain("Path=/;");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain("Domain");
    expect(setCookie).not.toContain("/api/portal");
  });

  it("aborts on client cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = POST(new Request(request(), { signal: controller.signal }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(await response.json()).toEqual({ error: "cancelled" });
  });

  it("times out after 45 seconds and exposes no exception details", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error(`private timeout ${key}`)));
    })));
    const pending = POST(request());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(45000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "timeout" });
  });

  it("also cancels a stalled response body at the deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    const pending = POST(request());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(45000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(cancel).toHaveBeenCalled();
  });
});

describe("trial config", () => {
  it("returns only safe config fields and hardens only the trial cookie", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ trialAvailable: true, maxOutputTokens: 512, remaining: 3, secret: "hidden" }, {
      headers: { "Set-Cookie": `${cookie}; Domain=evil.example; Path=/other; Max-Age=3600` },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("https://powerchampion.ai/api/chat/config"));
    expect(await response.json()).toEqual({ trialAvailable: true, maxOutputTokens: 512, remaining: 3 });
    expect(fetchMock.mock.calls[0][0]).toBe("https://portal.internal.example/api/portal/trial/config");
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(cookie);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");
    expect(setCookie).not.toContain("Domain");
    expect(setCookie).not.toContain("/other");
  });

  it("returns trial disabled when unconfigured, unavailable, redirected, or malformed", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await (await GET(new Request("https://powerchampion.ai/api/chat/config"))).json()).toEqual({ trialAvailable: false, maxOutputTokens: 512 });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    fetchMock.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://attacker.example" } }))
      .mockResolvedValueOnce(Response.json({ trialAvailable: "yes", maxOutputTokens: -10 }));
    for (let i = 0; i < 3; i++) {
      const response = await GET(new Request("https://powerchampion.ai/api/chat/config"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ trialAvailable: false, maxOutputTokens: 512 });
    }
  });

  it("blocks foreign GET origins and does not relay unrelated service cookies", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "https://portal.internal.example");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ trialAvailable: true, maxOutputTokens: 512 }, { headers: { "Set-Cookie": "pc_portal_session=accountsecret; Path=/" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(new Request("https://powerchampion.ai/api/chat/config", { headers: { Origin: "https://foreign.example" } }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    const response = await GET(new Request("https://powerchampion.ai/api/chat/config"));
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("relays optional validated trial budgets and uses loopback only for local development", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      trialAvailable: true, maxOutputTokens: 512, remaining: 4,
      maxHistoryCharacters: 8000, maxSystemCharacters: 16000, maxMessages: 24,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://localhost:3010/api/chat/config", { headers: { Cookie: `${cookie}; another=secret` } }));
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:3020/api/portal/trial/config");
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("cookie")).toBe(cookie);
    expect(await response.json()).toEqual({
      trialAvailable: true, maxOutputTokens: 512, remaining: 4,
      maxHistoryCharacters: 8000, maxSystemCharacters: 16000, maxMessages: 24,
    });
  });
});
