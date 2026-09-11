import {
  CHAT_LIMITS, chatError, deadline, parseTrialConfig, privateServiceOrigin,
  readBounded, responseHeaders, sameOrigin, trialHeaders,
} from "../../../../lib/chat-protocol";

export const dynamic = "force-dynamic";
function unavailable() {
  return Response.json({ trialAvailable: false, maxOutputTokens: CHAT_LIMITS.trialTokens }, { headers: responseHeaders() });
}

export async function GET(request: Request) {
  if (!sameOrigin(request, false)) return chatError("origin", 403);
  const url = new URL(request.url);
  const origin = privateServiceOrigin(url);
  if (!origin) return unavailable();
  const timer = deadline(request, 10000);
  try {
    const response = await fetch(`${origin}/api/portal/trial/config`, {
      headers: trialHeaders(request), redirect: "manual", cache: "no-store", signal: timer.signal,
    });
    if (!response.ok) { await response.body?.cancel(); return unavailable(); }
    const config = parseTrialConfig(JSON.parse(await readBounded(response.body, 16384, timer.signal)));
    if (!config) return unavailable();
    return Response.json(config, { headers: responseHeaders(response, url) });
  } catch { return unavailable(); }
  finally { timer.close(); }
}
