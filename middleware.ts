import { NextResponse, type NextRequest } from "next/server";
import { isIndexableRequest, languageForPath, referrerPolicyFor } from "./lib/seo";

/** Compute request context from the URL, never from caller-supplied locale headers. */
export function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const indexable = isIndexableRequest(url);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pc-language", languageForPath(url.pathname));
  requestHeaders.set("x-pc-indexable", String(indexable));
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (!indexable) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  const referrer = referrerPolicyFor(url.pathname);
  if (referrer) response.headers.set("Referrer-Policy", referrer);
  return response;
}

export const config = { matcher: "/:path*" };
