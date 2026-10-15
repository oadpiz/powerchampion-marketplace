import { NextResponse, type NextRequest } from "next/server";
import { isIndexableRequest, languageForPath } from "./lib/seo";

/** Compute request context from the URL, never from caller-supplied locale headers. */
export function middleware(request: NextRequest) {
  const url = new URL(request.url);
  // Simplified Chinese was retired; keep old /zh-Hans links working by sending them to Traditional Chinese.
  const retired = url.pathname.match(/^\/zh-(?:Hans|CN|cn|hans)(\/.*)?$/);
  if (retired) {
    url.pathname = `/zh-Hant${retired[1] ?? ""}`;
    return NextResponse.redirect(url, 301);
  }
  const indexable = isIndexableRequest(url);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pc-language", languageForPath(url.pathname));
  requestHeaders.set("x-pc-indexable", String(indexable));
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (!indexable) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = { matcher: "/:path*" };
