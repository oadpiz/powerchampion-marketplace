/** Same-origin boundary for the private customer service. No gateway secrets live here. */
export const dynamic = "force-dynamic";

const COOKIE = "pc_portal_session";
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  Vary: "Cookie",
};
// /agents/resolve is deliberately absent: only this site's server may call it.
const AGENT = "[a-f0-9]{32}";
const KEY = "[A-Za-z0-9_-]{1,128}";
const NODE = "[A-Za-z0-9._-]{1,64}";
const JOB = "[A-Za-z0-9._-]{1,128}";
// %2F is allowed so an encoded model id such as zai-org%2FGLM-5.3 reaches the gateway routes intact.
const MODEL = "[A-Za-z0-9._:%-]{1,160}";
const NODE_ACTION = "(start|stop|restart|check|backup|fw-status)";
const routes: Record<string, readonly RegExp[]> = {
  GET: [/^\/(session|overview|keys|usage|credits|agents)$/, new RegExp(`^/agents/${AGENT}$`), /^\/admin\/(overview|customers|credits|audit)$/, /^\/runtime\/(config|tasks)$/, new RegExp(`^/runtime/tasks/${AGENT}$`), new RegExp(`^/runtime/tasks/${AGENT}/artifacts/${AGENT}$`), /^\/admin\/(keys|usage|gateway)$/, new RegExp(`^/admin/gateway/nodes/${NODE}/jobs/${JOB}$`)],
  POST: [/^\/auth\/(register|login|logout)$/, /^\/(keys|credits|agents)$/, new RegExp(`^/agents/${AGENT}/(versions|token)$`), /^\/admin\/credits\/[a-zA-Z0-9_-]{1,80}\/review$/, /^\/password$/, new RegExp(`^/admin/customers/${AGENT}/(status|role|reset-password)$`), /^\/runtime\/tasks$/, new RegExp(`^/runtime/tasks/${AGENT}/(control|instructions|approval)$`), new RegExp(`^/admin/customers/${AGENT}/keys$`), new RegExp(`^/admin/keys/${KEY}/(disable|limits|balance)$`), new RegExp(`^/admin/gateway/models/${MODEL}/(toggle|maintenance)$`), new RegExp(`^/admin/gateway/nodes/${NODE}/ops/${NODE_ACTION}$`)],
  DELETE: [/^\/keys\/[a-zA-Z0-9_-]{1,80}$/, new RegExp(`^/agents/${AGENT}$`)],
};
/** Empty or dot segments, including ones hidden behind an encoded dot or an encoded slash, are never legitimate ids. */
function traverses(path: string) {
  if (path.includes("//") || /%2e/i.test(path)) return true;
  return path.replace(/%(?:2f|5c)/gi, "/").split("/").slice(1).some((segment) => segment === "." || segment === "..");
}
function failure(error: string, detail: string, status: number) {
  return Response.json({ error, detail }, { status, headers: RESPONSE_HEADERS });
}

/** Cleartext only to a single-label Compose service name, or loopback during local development. */
function serviceOrigin(requestUrl: URL): string | null {
  const configured = process.env.PC_PORTAL_ORIGIN;
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname);
  if (!configured) return isLocal && requestUrl.protocol === "http:" ? "http://127.0.0.1:3020" : null;
  try {
    const target = new URL(configured);
    const localTarget = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
    const internalTarget = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(target.hostname);
    if (target.username || target.password || target.pathname !== "/" || target.search || target.hash) return null;
    if (target.protocol !== "https:" && !(target.protocol === "http:" && (internalTarget || (isLocal && localTarget)))) return null;
    return target.origin;
  } catch { return null; }
}

async function readBounded(stream: ReadableStream<Uint8Array> | null, maximum: number) {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new RangeError("body size"); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

async function proxy(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/portal".length);
  if (traverses(path) || !routes[request.method]?.some((route) => route.test(path))) return failure("not_found", "This account endpoint does not exist.", 404);
  const mutation = request.method !== "GET";
  const origin = request.headers.get("origin");
  if ((mutation && origin !== url.origin) || (origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return failure("origin_not_allowed", "Reload the portal and try again.", 403);
  }
  const upstreamOrigin = serviceOrigin(url);
  if (!upstreamOrigin) return failure("service_unconfigured", "The account service is not configured yet. Please contact support.", 503);

  const target = new URL(`/api/portal${path}`, upstreamOrigin);
  if ((path === "/usage" || path === "/admin/usage") && url.searchParams.has("month")) {
    const month = url.searchParams.get("month") ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return failure("invalid_input", "Choose a valid reporting month.", 400);
    target.searchParams.set("month", month);
  }

  let body: string | undefined;
  if (mutation && request.body) {
    try {
      const text = await readBounded(request.body, path === "/runtime/tasks" ? 196608 : 65536);
      // Workerd represents even a bodyless POST/DELETE as a non-null stream.
      if (text.length) {
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return failure("invalid_input", "Send a JSON request.", 415);
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError();
        body = text;
      }
    } catch (cause) {
      return failure("invalid_input", "Enter valid request details.", cause instanceof RangeError ? 413 : 400);
    }
  }
  const headers = new Headers({ Accept: "application/json" });
  if (body) headers.set("Content-Type", "application/json");
  if (origin) headers.set("Origin", origin);
  const session = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${COOKIE}=`));
  if (session && new RegExp(`^${COOKIE}=[a-zA-Z0-9_-]{20,200}$`).test(session)) headers.set("Cookie", session);

  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, 20000);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) controller.abort();
  try {
    const response = await fetch(target.href, { method: request.method, headers, body, redirect: "manual", cache: "no-store", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error("Unexpected service redirect"); }
    const text = await readBounded(response.body, 2097152);
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new SyntaxError();
    if (response.status === 503 && "error" in data && data.error === "usage_pricing_incomplete") {
      return failure("usage_pricing_incomplete", "Pricing is incomplete for this usage report. Please contact support.", 503);
    }
    // The only upstream gateway 5xx codes the browser may see; the detail is rewritten so no gateway address or token can leak.
    if (response.status === 503 && "error" in data && data.error === "gateway_unavailable") {
      return failure("gateway_unavailable", "The API gateway is unavailable. Please try again later.", 503);
    }
    if (response.status === 503 && "error" in data && data.error === "gateway_auth_failed") {
      return failure("gateway_auth_failed", "The portal's gateway token was rejected. Check PC_GATEWAY_ADMIN_TOKEN.", 503);
    }
    if (response.status >= 500) return failure("service_unavailable", "This service is unavailable or has not been configured yet. Please try again later.", response.status === 503 ? 503 : 502);
    const resultHeaders = new Headers(RESPONSE_HEADERS);
    // Only the portal's session cookie can cross the service boundary.
    const cookie = response.headers.get("set-cookie");
    if (cookie?.startsWith(`${COOKIE}=`)) {
      const parts = cookie.split(";").map((part) => part.trim());
      const value = parts[0].slice(COOKIE.length + 1).replace(/^""$/, "");
      if (/^[a-zA-Z0-9_-]{0,200}$/.test(value)) {
        const age = parts.find((part) => /^max-age=-?\d+$/i.test(part));
        const expires = parts.find((part) => /^expires=/i.test(part));
        resultHeaders.set("Set-Cookie", [`${COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", ...(age ? [age] : []), ...(expires ? [expires] : []), ...(url.protocol === "https:" ? ["Secure"] : [])].join("; "));
      }
    }
    return Response.json(data, { status: response.status, headers: resultHeaders });
  } catch {
    return failure("service_unavailable", "The account service is unavailable. Please try again later.", controller.signal.aborted ? 504 : 502);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
