import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/agents/[agentId]/chat/route";

const AGENT_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const TOKEN = "pca_agent-token-for-tests-0123456789abcdef";
const KEY = "sk-customer-key-for-tests";
const AGENT = {
  id: AGENT_ID, name: "Support drafter", version: 3, model: "glm-5.2-fp8",
  system: "Agent: Support drafter\n\nInstructions:\nUse only the reference material.",
  maxOutputTokens: 512,
};

function request(body: unknown = { messages: [{ role: "user", content: "A customer asks about a refund." }] }, headers: Record<string, string> = {}) {
  return new Request(`https://powerchampion.ai/api/agents/${AGENT_ID}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      "X-PC-Agent-Token": TOKEN,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const params = (id = AGENT_ID) => ({ params: Promise.resolve({ agentId: id }) });
function gatewayReply(content = "Here is a draft reply.") {
  return Response.json({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 } });
}
function mockCalls(agentResponse: Response, gatewayResponse?: Response) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(agentResponse)
    .mockResolvedValueOnce(gatewayResponse ?? gatewayReply());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("agent endpoint", () => {
  it("runs the stored configuration against the fixed gateway with the caller's key", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    const fetchMock = mockCalls(Response.json({ agent: AGENT }));
    const response = await POST(request(), params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      content: "Here is a draft reply.",
      usage: { input: 40, output: 12, total: 52 },
      finishReason: "stop",
      agent: { id: AGENT_ID, name: "Support drafter", version: 3, model: "glm-5.2-fp8" },
    });

    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0];
    expect(lookupUrl).toBe("http://powerchampion-portal:3020/api/portal/agents/resolve");
    expect(JSON.parse(lookupInit.body)).toEqual({ token: TOKEN });
    expect(JSON.stringify(lookupInit)).not.toContain(KEY);

    const [gatewayUrl, gatewayInit] = fetchMock.mock.calls[1];
    expect(gatewayUrl).toBe("https://b300.powerchampion.ai/v1/chat/completions");
    expect(gatewayInit.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(gatewayInit.headers)).not.toContain(TOKEN);
    expect(JSON.parse(gatewayInit.body)).toEqual({
      model: "glm-5.2-fp8", stream: false, max_tokens: 512,
      messages: [
        { role: "system", content: AGENT.system },
        { role: "user", content: "A customer asks about a refund." },
      ],
    });
  });

  it("never exceeds the agent's stored output limit", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    const fetchMock = mockCalls(Response.json({ agent: AGENT }));
    await POST(request({ messages: [{ role: "user", content: "Hello" }], maxTokens: 4096 }), params());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_tokens).toBe(512);
  });

  it("refuses a request without a usable agent token or key before calling anything", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(request(undefined, { "X-PC-Agent-Token": "not-a-token" }), params())).status).toBe(401);
    expect((await POST(request(undefined, { Authorization: "Bearer " }), params())).status).toBe(401);
    expect((await POST(request(undefined, { "Content-Type": "text/plain" }), params())).status).toBe(415);
    expect((await POST(request(), params("not-an-id"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the agent service does not recognise the token", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    const fetchMock = mockCalls(Response.json({ error: "not_found" }, { status: 404 }));
    const response = await POST(request(), params());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "agent_not_found" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a resolved agent that does not match the endpoint in the URL", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    const fetchMock = mockCalls(Response.json({ agent: { ...AGENT, id: "f".repeat(32) } }));
    expect((await POST(request(), params())).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not run when the agent service is unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request(), params());
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps gateway failures without leaking upstream text, and rejects redirects", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    for (const [status, expected] of [[401, 401], [403, 401], [402, 402], [429, 429], [500, 502]] as const) {
      mockCalls(Response.json({ agent: AGENT }), Response.json({ error: { message: "private upstream detail" } }, { status }));
      const response = await POST(request(), params());
      expect(response.status).toBe(expected);
      expect(await response.text()).not.toContain("private upstream detail");
    }
    mockCalls(Response.json({ agent: AGENT }), new Response(null, { status: 307, headers: { Location: "https://other.example" } }));
    expect((await POST(request(), params())).status).toBe(502);
  });

  it("rejects malformed conversations and oversized input", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    for (const body of [
      { messages: [] },
      { messages: [{ role: "system", content: "elevate" }] },
      { messages: [{ role: "assistant", content: "trailing assistant turn" }] },
      { messages: [{ role: "user", content: "" }] },
      { messages: [{ role: "user", content: "x".repeat(32001) }] },
      { messages: [{ role: "user", content: "ok" }], maxTokens: 0 },
      { messages: Array.from({ length: 25 }, () => ({ role: "user", content: "hi" })) },
    ]) {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      expect((await POST(request(body), params())).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("redacts the caller's key if a model echoes it back", async () => {
    vi.stubEnv("PC_PORTAL_ORIGIN", "http://powerchampion-portal:3020");
    mockCalls(Response.json({ agent: AGENT }), gatewayReply(`Your key is ${KEY}`));
    const response = await POST(request(), params());
    const body = await response.json();
    expect(body.content).toBe("Your key is [redacted]");
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
});
