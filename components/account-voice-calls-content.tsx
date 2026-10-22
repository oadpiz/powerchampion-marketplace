"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { PortalError, portalRequest } from "../lib/portal-client";
import {
  MEDIA_KINDS,
  dateText,
  type CallContent,
  type ContentLink,
  type MediaKind,
  type MediaSummary,
  type MediaTranscript,
} from "../lib/voice-calls";
import { voiceErrorText } from "../lib/voice-setup";
import { useLocale } from "./locale-provider";

/** §8.1: the token is two base64url parts; the Taiwan host refuses anything over 2048 characters. */
const MEDIA_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MEDIA_TOKEN_MAX = 2048;
/** A link with less than this left is not reused for a new read: ask M17 for a fresh one. */
const REUSE_MARGIN_MS = 15_000;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

type MediaLink = { token: string; expiresAt: number; kinds: MediaKind[]; urls: Partial<Record<MediaKind, string>> };

/** Why a read from the Taiwan host failed (§8.3 codes, plus "unreachable" for network errors, 5xx and odd bodies). */
type MediaFailure = "token_expired" | "token_again" | "invalid" | "not_ready" | "not_found" | "expired" | "unreachable";
type MediaResult<T> = { ok: true; value: T } | { ok: false; failure: MediaFailure };
type TextKind = "summary" | "transcript";
type Shown = { summary?: MediaResult<MediaSummary>; transcript?: MediaResult<MediaTranscript> };

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

/** M17's answer as a usable link; null when any part is off (then nothing is sent anywhere). */
function parseLink(value: unknown): MediaLink | null {
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

const isTranscript = (value: unknown): value is MediaTranscript =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as MediaTranscript).segments) &&
  (value as MediaTranscript).segments.every(
    (segment) => typeof segment === "object" && segment !== null && typeof segment.text === "string" && typeof segment.speaker === "string",
  );

const isSummary = (value: unknown): value is MediaSummary =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as MediaSummary).summary === "string" &&
  ["string", "object"].includes(typeof (value as MediaSummary).callback_number) &&
  ["string", "object"].includes(typeof (value as MediaSummary).message_text);

/**
 * One GET to the Taiwan host (§8.3): the token travels only in the Authorization header, never in the URL; no cookies,
 * no referrer, nothing cached, and a redirect is an error so the header cannot be carried somewhere else.
 */
async function readMedia(url: string, token: string, kind: MediaKind, signal: AbortSignal): Promise<MediaResult<unknown>> {
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

/** §11.2 / §12.1 copy for a failed read. */
function mediaFailureText(failure: MediaFailure, zh: boolean): string {
  switch (failure) {
    case "not_ready":
      return zh
        ? "內容還在處理，通常在通話結束後幾分鐘內完成。請稍後再試。"
        : "The content is still being processed, usually within a few minutes after the call. Try again later.";
    case "not_found":
      return zh ? "這通沒有保存內容。" : "No content was kept for this call.";
    case "expired":
      return zh
        ? "內容已超過保存期限，不能再查看。"
        : "The content is past its retention period and can no longer be viewed.";
    case "token_expired":
    case "token_again":
      return zh ? "查看連結已過期，請再按一次「查看內容」。" : 'The viewing link expired. Choose "Show content" again.';
    case "invalid":
      return zh ? "內容讀取失敗，請重新整理後再試。" : "The content could not be loaded. Reload and try again.";
    default:
      return zh ? "內容暫時讀不到，請稍後再試。" : "The content cannot be loaded right now. Try again later.";
  }
}

function clock(milliseconds: unknown): string {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const SPEAKERS: Record<string, [string, string]> = { caller: ["Caller", "客人"], ai: ["AI", "AI"], system: ["System", "系統"] };

/** What M17 can answer besides the link; the content section changes with it (§6.5, §12.1). */
type LinkProblem = { kind: "unavailable" } | { kind: "none" } | { kind: "expired" } | { kind: "pending" } | { kind: "other"; error: unknown };

function linkProblem(error: unknown): LinkProblem {
  if (error instanceof PortalError) {
    // The BFF turns the backend's 503 voice_media_unavailable into 503 service_unavailable (phase2-contract §1.2).
    if (error.status === 503 || error.code === "voice_media_unavailable") return { kind: "unavailable" };
    if (error.code === "call_content_unavailable") return { kind: "none" };
    if (error.status === 410 || error.code === "call_content_expired") return { kind: "expired" };
    // Amended §6.5: the records sender has not reported this call yet; it reads like the Taiwan host's media_not_ready.
    if (error.code === "call_content_pending") return { kind: "pending" };
  }
  return { kind: "other", error };
}

/**
 * The "Content" part of one call's page (phase2-contract §6.5, §8.3, §11.2). "Show content" asks portal for a 5-minute
 * link (M17) and reads the transcript and summary from the Taiwan host with it; "Play recording" downloads the
 * recording only when pressed. The token lives in a ref: never in the URL, the page, a log or an error message.
 */
export function CallContentPanel({
  callRowId,
  content,
  locked,
  onChanged,
}: {
  callRowId: string;
  content: CallContent;
  /** A temporary password: M17 would refuse (403), so the buttons stay off and the page says why. */
  locked: boolean;
  onChanged: () => void;
}): ReactElement {
  const { locale } = useLocale();
  const zh = locale === "zh";
  // When the page was opened: M14 already said what can still be viewed at about that time.
  const [openedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState<"content" | "recording" | null>(null);
  const [problem, setProblem] = useState<LinkProblem | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [recording, setRecording] = useState<{ url: string } | { failure: MediaFailure } | null>(null);
  const link = useRef<MediaLink | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
      link.current = null;
      if (objectUrl.current && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    },
    [],
  );

  /** A link from M17; an unexpired one with `kind` is reused unless `fresh` (after the Taiwan host said it expired). */
  async function getLink(kind: MediaKind, fresh: boolean, signal: AbortSignal): Promise<MediaLink> {
    const current = link.current;
    if (!fresh && current && current.kinds.includes(kind) && current.expiresAt - Date.now() > REUSE_MARGIN_MS) return current;
    link.current = null;
    // Bodiless POSTs still send {} (phase 1 §1.1).
    const answer = await portalRequest<unknown>(`/me/voice/calls/${callRowId}/content-link`, { method: "POST", body: "{}", signal });
    const parsed = parseLink(answer);
    if (!parsed) throw new PortalError(502, "service_unavailable", "Unexpected answer.");
    link.current = parsed;
    return parsed;
  }

  async function run(what: "content" | "recording", work: (signal: AbortSignal) => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    const own = new AbortController();
    controller.current = own;
    setBusy(what);
    setProblem(null);
    try {
      await work(own.signal);
    } catch (error) {
      if (own.signal.aborted) return;
      const found = linkProblem(error);
      setProblem(found);
      // The account or the store changed under us (temporary password, store gone): re-read M1 for the shell.
      if (error instanceof PortalError && (error.code === "password_change_required" || error.code === "voice_store_not_found")) onChanged();
    } finally {
      inFlight.current = false;
      if (!own.signal.aborted) setBusy(null);
    }
  }

  const showContent = () =>
    run("content", async (signal) => {
      setShown(null);
      let current = await getLink("transcript", false, signal);
      const kinds = (["summary", "transcript"] as TextKind[]).filter((kind) => current.kinds.includes(kind));
      if (kinds.length === 0) {
        setProblem({ kind: "expired" });
        return;
      }
      const read = (kind: TextKind, from: MediaLink) => readMedia(from.urls[kind] as string, from.token, kind, signal);
      let results = await Promise.all(kinds.map((kind) => read(kind, current)));
      // §11.2: an expired link is asked for again once, automatically; a second expiry is shown.
      if (results.some((result) => !result.ok && result.failure === "token_expired")) {
        current = await getLink("transcript", true, signal);
        results = await Promise.all(
          kinds.map(async (kind, index) => {
            const first = results[index];
            if (first.ok || first.failure !== "token_expired") return first;
            const again = await read(kind, current);
            return !again.ok && again.failure === "token_expired" ? { ok: false as const, failure: "token_again" as const } : again;
          }),
        );
      }
      const next: Shown = {};
      kinds.forEach((kind, index) => {
        if (kind === "summary") next.summary = results[index] as MediaResult<MediaSummary>;
        else next.transcript = results[index] as MediaResult<MediaTranscript>;
      });
      setShown(next);
    });

  const playRecording = () =>
    run("recording", async (signal) => {
      setRecording(null);
      let current = await getLink("recording", false, signal);
      if (!current.kinds.includes("recording")) {
        setRecording({ failure: "expired" });
        return;
      }
      let result = await readMedia(current.urls.recording as string, current.token, "recording", signal);
      if (!result.ok && result.failure === "token_expired") {
        current = await getLink("recording", true, signal);
        result = await readMedia(current.urls.recording as string, current.token, "recording", signal);
        if (!result.ok && result.failure === "token_expired") result = { ok: false, failure: "token_again" };
      }
      if (!result.ok) {
        setRecording({ failure: result.failure });
        return;
      }
      if (typeof URL.createObjectURL !== "function") {
        setRecording({ failure: "unreachable" });
        return;
      }
      if (objectUrl.current && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(result.value as Blob);
      setRecording({ url: objectUrl.current });
    });

  const expired = content.state === "expired" || problem?.kind === "expired";
  const none = content.state === "none" || problem?.kind === "none";
  const unavailable = !content.linkAvailable || problem?.kind === "unavailable";
  const recordingUntil = content.recordingUntil ? Date.parse(content.recordingUntil) : Number.NaN;
  const canPlay = content.hasRecording && !Number.isNaN(recordingUntil) && recordingUntil > openedAt;

  let body: ReactNode;
  if (none) body = <p>{zh ? "這通沒有保存內容。" : "No content was kept for this call."}</p>;
  else if (expired)
    body = <p>{zh ? "內容已超過保存期限，不能再查看。" : "The content is past its retention period and can no longer be viewed."}</p>;
  else
    body = (
      <>
        <p>
          {zh
            ? `逐字稿與摘要可以查看到 ${dateText(content.transcriptUntil, zh)}。`
            : `Transcript and summary can be viewed until ${dateText(content.transcriptUntil, zh)}.`}
          {content.recordingUntil &&
            (zh
              ? `錄音可以查看到 ${dateText(content.recordingUntil, zh)}。`
              : ` The recording can be viewed until ${dateText(content.recordingUntil, zh)}.`)}
        </p>
        {!content.hasRecording && (
          <p className="portal-hint">
            {zh
              ? "這通沒有錄音（依你的錄音設定，或客人要求不錄音）。"
              : "There is no recording for this call (because of your recording setting or the caller's request)."}
          </p>
        )}
        {unavailable && (
          <p className="portal-note" role="status">
            {zh ? "查看內容的功能還沒開放。" : "Viewing call content is not available yet."}
          </p>
        )}
        <div className="portal-actions">
          <button
            type="button"
            className="portal-button"
            disabled={locked || unavailable || busy !== null}
            onClick={() => void showContent()}
          >
            {busy === "content" ? (zh ? "處理中…" : "Working…") : zh ? "查看內容" : "Show content"}
          </button>
          {canPlay && (
            <button
              type="button"
              className="portal-button-secondary"
              disabled={locked || unavailable || busy !== null}
              onClick={() => void playRecording()}
            >
              {busy === "recording" ? (zh ? "處理中…" : "Working…") : zh ? "播放錄音" : "Play recording"}
            </button>
          )}
        </div>
        {busy !== null && (
          <p className="portal-muted" role="status">
            {zh ? "正在讀取內容…" : "Loading content…"}
          </p>
        )}
        {problem?.kind === "other" && (
          <p className="portal-error" role="alert">
            {linkErrorText(problem.error, zh, locale)}
          </p>
        )}
        {problem?.kind === "pending" && (
          <p className="portal-note" role="status">
            {mediaFailureText("not_ready", zh)}
          </p>
        )}
        {recording && "url" in recording && (
          // The transcript on this page is the text of the recording.
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio controls src={recording.url} aria-label={zh ? "錄音" : "Recording"} data-voice-recording="" />
        )}
        {recording && "failure" in recording && (
          <p className="portal-error" role="alert">
            {mediaFailureText(recording.failure, zh)}
          </p>
        )}
        {shown && <ShownContent shown={shown} zh={zh} />}
      </>
    );

  return (
    <section className="portal-panel" aria-labelledby="voice-call-content-title">
      <h3 id="voice-call-content-title">{zh ? "內容" : "Content"}</h3>
      {body}
    </section>
  );
}

/** M17 errors other than the ones that change the section (§12.1, phase 1 §9). */
function linkErrorText(error: unknown, zh: boolean, locale: "en" | "zh"): ReactNode {
  const code = error instanceof PortalError ? error.code : "";
  if (code === "password_change_required")
    return (
      <>
        {zh ? "請先到「" : "Change the temporary password we gave you under "}
        <Link href="/account/security">{zh ? "安全性" : "Security"}</Link>
        {zh ? "」變更我們發給你的臨時密碼，才能查看內容或標記。" : " before viewing content or flagging calls."}
      </>
    );
  if (code === "voice_content_link_limit" || (error instanceof PortalError && error.status === 429))
    return zh ? "查看次數太多了，請 1 小時後再試。" : "Too many views. Try again in an hour.";
  if (code === "call_not_found")
    return zh ? "這通紀錄不存在，或不屬於你的店。" : "This call does not exist or does not belong to your store.";
  // A malformed M17 answer is not sent anywhere; it reads like any other failed load.
  if (!(error instanceof PortalError) || error.status >= 500) return mediaFailureText("invalid", zh);
  return voiceErrorText(error, locale);
}

function ShownContent({ shown, zh }: { shown: Shown; zh: boolean }) {
  const failures = new Set<string>();
  for (const result of [shown.summary, shown.transcript]) if (result && !result.ok) failures.add(mediaFailureText(result.failure, zh));
  const summary = shown.summary?.ok ? shown.summary.value : null;
  const transcript = shown.transcript?.ok ? shown.transcript.value : null;
  return (
    <>
      {[...failures].map((text) => (
        <p key={text} className="portal-error" role="alert">
          {text}
        </p>
      ))}
      {summary && (
        <>
          <h4>{zh ? "摘要" : "Summary"}</h4>
          <dl className="portal-meta">
            <dt>{zh ? "摘要" : "Summary"}</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{summary.summary || "—"}</dd>
            <dt>{zh ? "回電號碼" : "Callback number"}</dt>
            <dd>{summary.callback_number || "—"}</dd>
            <dt>{zh ? "留言內容" : "Message"}</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{summary.message_text || "—"}</dd>
          </dl>
        </>
      )}
      {transcript && (
        <>
          <h4>{zh ? "逐字稿" : "Transcript"}</h4>
          {transcript.segments.length === 0 ? (
            <p className="portal-muted">—</p>
          ) : (
            <ol className="voice-call-transcript" style={{ listStyle: "none", padding: 0, fontSize: 13, lineHeight: 1.7 }}>
              {transcript.segments.map((segment, index) => (
                <li key={index} style={{ marginBottom: 8, overflowWrap: "anywhere" }}>
                  <strong>{SPEAKERS[segment.speaker]?.[zh ? 1 : 0] ?? (zh ? "系統" : "System")}</strong>{" "}
                  <span className="portal-hint">{clock(segment.start_ms)}</span> <span style={{ whiteSpace: "pre-wrap" }}>{segment.text}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </>
  );
}
