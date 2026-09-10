import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAILURE_MEMO_MS,
  fetchGatewayStatus,
  resetGatewayStatusFailureMemo,
  type GatewayStatus,
} from "../lib/gateway-status";

const okStatus: GatewayStatus = {
  status: "ok",
  summary: "All models serving",
  updated: 1_757_000_000,
  uptime_window_days: 30,
  models: [
    { id: "glm-5.2-fp8", name: "GLM 5.2 FP8", ready: true, context_length: 131072, uptime: 0.999 },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  // Module state: a previous test's outage must not silence the next one.
  resetGatewayStatusFailureMemo();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetGatewayStatusFailureMemo();
});

describe("fetchGatewayStatus", () => {
  it("returns the gateway's own status document", async () => {
    const mock = vi.fn<typeof fetch>(async () => jsonResponse(okStatus));
    vi.stubGlobal("fetch", mock);

    await expect(fetchGatewayStatus()).resolves.toEqual(okStatus);
    expect(mock.mock.calls[0][0]).toBe("https://b300.powerchampion.ai/status.json");
    expect((mock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects on a non-200 without leaving the caller a half-parsed body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ detail: "nope" }, 503)));

    await expect(fetchGatewayStatus()).rejects.toThrow(/gateway status 503/);
  });

  it("skips the network for a minute after a failure, then retries", async () => {
    vi.useFakeTimers();
    const mock = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    });
    vi.stubGlobal("fetch", mock);

    await expect(fetchGatewayStatus()).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);

    // During the memo window the caller still fails, but pays no 4s timeout.
    await expect(fetchGatewayStatus()).rejects.toThrow(/memoized failure/);
    expect(mock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(FAILURE_MEMO_MS - 1);
    await expect(fetchGatewayStatus()).rejects.toThrow(/memoized failure/);
    expect(mock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await expect(fetchGatewayStatus()).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("clears the memo once the gateway answers again", async () => {
    vi.useFakeTimers();
    let healthy = false;
    const mock = vi.fn<typeof fetch>(async () => {
      if (!healthy) throw new Error("gateway down");
      return jsonResponse(okStatus);
    });
    vi.stubGlobal("fetch", mock);

    await expect(fetchGatewayStatus()).rejects.toThrow();
    healthy = true;
    vi.advanceTimersByTime(FAILURE_MEMO_MS + 1);
    await expect(fetchGatewayStatus()).resolves.toEqual(okStatus);

    await expect(fetchGatewayStatus()).resolves.toEqual(okStatus);
    expect(mock).toHaveBeenCalledTimes(3);
  });
});
