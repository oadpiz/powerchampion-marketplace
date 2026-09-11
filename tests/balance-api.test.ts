import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/balance/route";
afterEach(() => vi.unstubAllGlobals());
it("refuses to follow balance redirects using the Worker-supported manual mode", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://other.example" } }));
  vi.stubGlobal("fetch", fetchMock);
  const response = await POST(new Request("https://powerchampion.ai/api/balance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "test-only-key" }) }));
  expect(response.status).toBe(502);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].redirect).toBe("manual");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
