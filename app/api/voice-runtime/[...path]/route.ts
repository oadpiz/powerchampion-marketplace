/**
 * The phone agent's runtime API, for servers only (phase2-contract.md §3.1):
 *
 *   GET  /api/voice-runtime/config?number=<dialed>[&have=<state_sha256>]   (b300-23's orchestrator)
 *   POST /api/voice-runtime/calls                                          (the orchestrator and the Taiwan host)
 *   GET  /api/voice-runtime/deletions?after=<cursor>&limit=<1-500>          (the Taiwan host's records sender, §16.3)
 *   POST /api/voice-runtime/deletions/<request id>/ack                     (the Taiwan host's records sender, §16.3)
 *   Authorization: Bearer <runtime token>
 *
 * This route only forwards, to the portal's internal /api/portal/voice/runtime/*, which checks the switch, the
 * token, the rate limits and the report. It holds no token: a missing or malformed Authorization is refused here
 * (401, the portal is not called), so with the switch off a caller without a well-formed token sees 401, not 404
 * (contract §13 item 16). No cookie is read or set, no X-Forwarded-* or CF-* header is forwarded, no CORS header is
 * returned, and nothing is logged. The browser BFF (/api/portal/[...path]) does not list these paths.
 */
import { deadline, isRecord, privateServiceOrigin, readBounded } from "../../../../lib/chat-protocol";

export const dynamic = "force-dynamic";

const PREFIX = "/api/voice-runtime/";
const AUTHORIZATION = /^Bearer [\x21-\x7e]{32,256}$/;
const NUMBER = /^[+0-9a-z:-]{1,20}$/;
const STATE = /^[a-f0-9]{64}$/;
const ETAG = /^"[a-f0-9]{64}"$/;
const LENGTH = /^[0-9]{1,10}$/;
const AFTER = /^[0-9]{1,18}$/;
const LIMIT = /^[1-9][0-9]{0,2}$/;
const ACK = /^\/api\/voice-runtime\/deletions\/([a-f0-9]{32})\/ack$/;
const RUNTIME_LIMITS = { body: 8192, ackBody: 1024, pullLimit: 500, response: 262144, timeoutMs: 10000 } as const;
const FIXED = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };

function failure(error: string, detail: string, status: number) {
  return Response.json({ error, detail }, { status, headers: FIXED });
}

function headersWith(etag: string | null) {
  const headers = new Headers(FIXED);
  if (etag && ETAG.test(etag)) headers.set("ETag", etag);
  return headers;
}

type Target = { kind: "config" | "calls" | "deletions" | "ack"; path: string };

/**
 * Exactly GET config, POST calls, GET deletions or POST deletions/<32 lowercase hex>/ack; anything else (other paths,
 * encoded dots or slashes, other methods) is 404. `path` is the portal's sub-path.
 */
function target(request: Request, url: URL): Target | null {
  if (request.method === "GET" && url.pathname === `${PREFIX}config`) return { kind: "config", path: "config" };
  if (request.method === "POST" && url.pathname === `${PREFIX}calls`) return { kind: "calls", path: "calls" };
  if (request.method === "GET" && url.pathname === `${PREFIX}deletions`) return { kind: "deletions", path: "deletions" };
  const ack = request.method === "POST" ? ACK.exec(url.pathname) : null;
  if (ack) return { kind: "ack", path: `deletions/${ack[1]}/ack` };
  return null;
}

const unavailable = () => failure("voice_runtime_unavailable", "The phone agent service is unavailable.", 502);

async function handle(request: Request) {
  const url = new URL(request.url);
  const found = target(request, url);
  if (!found) return failure("not_found", "This runtime endpoint does not exist.", 404);
  const { kind, path } = found;
  const authorization = request.headers.get("authorization") ?? "";
  if (!AUTHORIZATION.test(authorization)) return failure("runtime_auth", "Send Authorization: Bearer <runtime token>.", 401);

  const headers: Record<string, string> = { Accept: "application/json", Authorization: authorization, Origin: url.origin };
  let query = "";
  const bodyLimit = kind === "ack" ? RUNTIME_LIMITS.ackBody : RUNTIME_LIMITS.body;
  if (kind === "config") {
    const number = url.searchParams.get("number");
    if (number === null || !NUMBER.test(number)) return failure("invalid_number", "Send number as 0227001001, %2B886227001001 or ext:6201.", 400);
    const have = url.searchParams.get("have");
    if (have !== null && !STATE.test(have)) return failure("invalid_input", "have must be a state_sha256 (64 lowercase hex).", 400);
    query = `?number=${encodeURIComponent(number)}${have === null ? "" : `&have=${have}`}`;
    const match = request.headers.get("if-none-match");
    if (match && ETAG.test(match)) headers["If-None-Match"] = match;
  } else if (kind === "deletions") {
    const after = url.searchParams.get("after");
    const limit = url.searchParams.get("limit");
    if (after !== null && !AFTER.test(after)) return failure("invalid_input", "after must be the cursor of an earlier answer (digits).", 400);
    if (limit !== null && !(LIMIT.test(limit) && Number(limit) <= RUNTIME_LIMITS.pullLimit)) {
      return failure("invalid_input", `limit must be a whole number from 1 to ${RUNTIME_LIMITS.pullLimit}.`, 400);
    }
    const params = [after === null ? "" : `after=${after}`, limit === null ? "" : `limit=${limit}`].filter(Boolean);
    query = params.length ? `?${params.join("&")}` : "";
  } else {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return failure("invalid_input", "Send a JSON request.", 415);
    }
    const length = request.headers.get("content-length");
    if (length === null || !LENGTH.test(length) || Number(length) > bodyLimit) {
      return failure("invalid_input", `Send Content-Length; a request is at most ${bodyLimit} bytes.`, 413);
    }
  }

  const service = privateServiceOrigin(url);
  if (!service) return failure("voice_runtime_unavailable", "The phone agent service is unavailable.", 503);
  const timer = deadline(request, RUNTIME_LIMITS.timeoutMs);
  try {
    let body: string | undefined;
    if (kind === "calls" || kind === "ack") {
      try { body = await readBounded(request.body, bodyLimit, timer.signal); }
      catch (cause) {
        if (timer.signal.aborted) throw cause;
        return failure("invalid_input", `A request is at most ${bodyLimit} bytes.`, 413);
      }
      headers["Content-Type"] = "application/json";
    }
    const upstream = await fetch(`${service}/api/portal/voice/runtime/${path}${query}`, {
      method: request.method, redirect: "manual", cache: "no-store", signal: timer.signal, headers, body,
    });
    if (upstream.status === 304) {
      await upstream.body?.cancel();
      return new Response(null, { status: 304, headers: headersWith(upstream.headers.get("etag")) });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(await readBounded(upstream.body, RUNTIME_LIMITS.response, timer.signal)); }
    catch (cause) {
      if (timer.signal.aborted) throw cause;
      return unavailable();
    }
    if (!isRecord(parsed)) return unavailable();
    const unconfigured = upstream.status === 503 && parsed.error === "voice_runtime_unconfigured";
    if (!unconfigured && (upstream.status < 200 || upstream.status >= 500 || (upstream.status >= 300 && upstream.status < 400))) {
      return unavailable();
    }
    const out = headersWith(upstream.headers.get("etag"));
    out.set("Content-Type", "application/json");
    return new Response(JSON.stringify(parsed), { status: upstream.status, headers: out });
  } catch {
    if (timer.timedOut()) return failure("voice_runtime_timeout", "The phone agent service did not answer in time.", 504);
    return failure("voice_runtime_unavailable", "The phone agent service is unavailable.", 503);
  } finally { timer.close(); }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
