import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/playground/route";

const key = "sk-private-playground-test";
const validBody = { key, model: "glm-5.2-fp8", prompt: "Explain a queue.", system: "Be concise.", maxTokens: 512 };
function request(body: unknown = validBody, headers: Record<string, string> = {}) {
  return new Request("https://powerchampion.ai/api/playground", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://powerchampion.ai", ...headers },
    body: JSON.stringify(body),
  });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("playground request boundary", () => {
  it("forwards one bounded non-streaming request to the fixed gateway and returns only safe response fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      choices: [{ message: { content: "A queue processes work in order." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 },
      private_debug: key,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ ...validBody, endpoint: "https://untrusted.example" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://b300.powerchampion.ai/v1/chat/completions");
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(init.body)).toEqual({ model: "glm-5.2-fp8", stream: false, max_tokens: 512, messages: [
      { role: "system", content: "Be concise." }, { role: "user", content: "Explain a queue." },
    ] });
    expect(await response.json()).toEqual({ content: "A queue processes work in order.", reasoning: null, finishReason: "stop", usage: { input: 12, output: 9, total: 21 } });
  });

  it.each([
    { ...validBody, model: "flux-schnell" },
    { ...validBody, prompt: " " },
    { ...validBody, prompt: "a".repeat(12001) },
    { ...validBody, system: "a".repeat(4001) },
    { ...validBody, maxTokens: 4097 },
    { ...validBody, maxTokens: 1.2 },
    { ...validBody, key: "abc\nheader" },
  ])("rejects invalid input without contacting the gateway", async (body) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects cross-origin browser requests and oversized bodies", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request(validBody, { origin: "https://other.example" }))).status).toBe(403);
    expect((await POST(request(validBody, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await POST(request({ ...validBody, extra: "a".repeat(70000) }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not relay an upstream error body containing credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`Unauthorized ${key}`, { status: 401 })));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":"authentication"}');
  });

  it("rejects a redirect without forwarding the model credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 307, headers: { Location: "https://other.example" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request())).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  });

  it("rejects malformed upstream output and preserves absent usage as unknown", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "bad" }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: `Do not expose ${key}` } }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request())).status).toBe(502);
    const data = await (await POST(request())).json();
    expect(data.usage).toBeNull();
    expect(data.content).not.toContain(key);
  });

  it("aborts the upstream request when the caller cancels", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const req = new Request(request(), { signal: controller.signal });
    const pending = POST(req);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(await response.json()).toEqual({ error: "cancelled" });
  });

  it("times out upstream requests without exposing exception details", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error(`timeout ${key}`)));
    })));
    const pending = POST(request());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(45000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "timeout" });
  });
});
