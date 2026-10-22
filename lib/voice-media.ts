/**
 * Reading a call's content from the Taiwan host (phase2-contract §8.3) with a content link from M17 (store page) or
 * A12 (Quality tab). Both pages use these, so they apply the same guards: the link is checked before anything is sent
 * (token shape, https URLs that end in /<kind>), the token travels only in the Authorization header, a redirect is an
 * error, a recording must be audio/* and a transcript or summary must have the §8.3 shape.
 */
import { MEDIA_KINDS, type ContentLink, type MediaKind, type MediaSummary, type MediaTranscript } from "./voice-calls";

/** §8.1: the token is two base64url parts; the Taiwan host refuses anything over 2048 characters. */
const MEDIA_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MEDIA_TOKEN_MAX = 2048;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export type MediaLink = { token: string; expiresAt: number; kinds: MediaKind[]; urls: Partial<Record<MediaKind, string>> };

/** Why a read from the Taiwan host failed (§8.3 codes, plus "unreachable" for network errors, 5xx and odd bodies). */
export type MediaFailure = "token_expired" | "token_again" | "invalid" | "not_ready" | "not_found" | "expired" | "unreachable";
export type MediaResult<T> = { ok: true; value: T } | { ok: false; failure: MediaFailure };

/** A URL the token may be sent to: https, or http on this machine; no user info, query or fragment; ends in /<kind>. */
function mediaUrl(value: unknown, kind: MediaKind): string | null {
  if (typeof value !== "string" || value.includes("?") || value.includes("#")) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const local = parsed.protocol === "http:" && LOCAL_HOSTS.includes(parsed.hostname);
  if ((parsed.protocol !== "https:" && !local) || parsed.username || parsed.password) return null;
  return parsed.pathname.endsWith(`/${kind}`) ? value : null;
}

/** An M17 or A12 answer as a usable link; null when any part is off (then nothing is sent anywhere). */
export function parseLink(value: unknown): MediaLink | null {
  const media = (value as ContentLink | null)?.media;
  if (!media || typeof media !== "object") return null;
  const { token, expiresAt, kinds, urls } = media;
  if (typeof token !== "string" || token.length > MEDIA_TOKEN_MAX || !MEDIA_TOKEN.test(token)) return null;
  const expires = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
  if (Number.isNaN(expires) || !Array.isArray(kinds) || kinds.length === 0) return null;
  if (!kinds.every((kind) => (MEDIA_KINDS as readonly string[]).includes(kind)) || !urls || typeof urls !== "object") return null;
  const checked: Partial<Record<MediaKind, string>> = {};
  for (const kind of kinds) {
    const url = mediaUrl(urls[kind], kind);
    if (!url) return null;
    checked[kind] = url;
  }
  return { token, expiresAt: expires, kinds: [...kinds], urls: checked };
}

export const isTranscript = (value: unknown): value is MediaTranscript =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as MediaTranscript).segments) &&
  (value as MediaTranscript).segments.every(
    (segment) => typeof segment === "object" && segment !== null && typeof segment.text === "string" && typeof segment.speaker === "string",
  );

export const isSummary = (value: unknown): value is MediaSummary =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as MediaSummary).summary === "string" &&
  ["string", "object"].includes(typeof (value as MediaSummary).callback_number) &&
  ["string", "object"].includes(typeof (value as MediaSummary).message_text);

/**
 * One GET to the Taiwan host (§8.3): the token travels only in the Authorization header, never in the URL; no cookies,
 * no referrer, nothing cached, and a redirect is an error so the header cannot be carried somewhere else. A recording
 * must come back as audio/*, a transcript or a summary in the §8.3 shape; anything else reads as "unreachable".
 */
export async function readMedia(url: string, token: string, kind: MediaKind, signal: AbortSignal): Promise<MediaResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    return { ok: false, failure: "unreachable" };
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const code = typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : "";
    if (response.status === 401 && code === "media_token_expired") return { ok: false, failure: "token_expired" };
    if (response.status === 401 || response.status === 403) return { ok: false, failure: "invalid" };
    if (response.status === 404 && code === "media_not_ready") return { ok: false, failure: "not_ready" };
    if (response.status === 404 && code === "media_not_found") return { ok: false, failure: "not_found" };
    if (response.status === 410) return { ok: false, failure: "expired" };
    return { ok: false, failure: "unreachable" };
  }
  try {
    if (kind === "recording") {
      if (!/^audio\//i.test(response.headers.get("Content-Type") ?? "")) return { ok: false, failure: "unreachable" };
      return { ok: true, value: await response.blob() };
    }
    const data: unknown = await response.json();
    const valid = kind === "transcript" ? isTranscript(data) : isSummary(data);
    return valid ? { ok: true, value: data } : { ok: false, failure: "unreachable" };
  } catch (cause) {
    if (signal.aborted) throw cause;
    return { ok: false, failure: "unreachable" };
  }
}
