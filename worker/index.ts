/** Cloudflare Worker entry point for the Power Champion website and model platform. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { isIndexableRequest, languageForPath } from "../lib/seo";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const indexable = isIndexableRequest(url);
    const finish = (response: Response): Response => {
      if (indexable) return response;
      const headers = new Headers(response.headers);
      headers.set("X-Robots-Tag", "noindex, nofollow");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };

    if (url.pathname === "/favicon.ico") {
      return finish(Response.redirect(new URL("/favicon.png", url), 308));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return finish(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths));
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pc-language", languageForPath(url.pathname));
    requestHeaders.set("x-pc-indexable", String(indexable));
    return finish(await handler.fetch(new Request(request, { headers: requestHeaders }), env, ctx));
  },
};

export default worker;
