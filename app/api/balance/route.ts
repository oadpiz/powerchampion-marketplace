/**
 * Server-side proxy for balance lookups.
 *
 * The b300 gateway publishes no CORS headers, so the browser cannot query it
 * directly from the marketing site. This endpoint forwards the caller's API
 * key to GET /dashboard/billing/subscription and relays the response. The key
 * is never logged or persisted — it exists only for the duration of the
 * upstream request.
 */

export const dynamic = "force-dynamic";

const GATEWAY_ORIGIN =
  process.env.GATEWAY_ORIGIN ?? "https://b300.powerchampion.ai";

export async function POST(request: Request) {
  let key: unknown;
  try {
    const body = await request.json();
    key = body?.key;
  } catch {
    return Response.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof key !== "string" || key.trim().length === 0) {
    return Response.json({ detail: "Missing API key." }, { status: 400 });
  }

  try {
    const upstream = await fetch(
      `${GATEWAY_ORIGIN}/dashboard/billing/subscription`,
      {
        headers: { Authorization: `Bearer ${key.trim()}` },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      },
    );

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json({ detail: "Gateway unreachable." }, { status: 502 });
  }
}
