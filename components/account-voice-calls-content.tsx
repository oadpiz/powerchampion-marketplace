"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { PortalError, portalRequest } from "../lib/portal-client";
import { dateText, type CallContent, type MediaKind, type MediaSummary, type MediaTranscript } from "../lib/voice-calls";
import { parseLink, readMedia, type MediaFailure, type MediaLink, type MediaResult } from "../lib/voice-media";
import { voiceErrorText } from "../lib/voice-setup";
import { useLocale } from "./locale-provider";

/** A link with less than this left is not reused for a new read: ask M17 for a fresh one. */
const REUSE_MARGIN_MS = 15_000;

type TextKind = "summary" | "transcript";
type Shown = { summary?: MediaResult<MediaSummary>; transcript?: MediaResult<MediaTranscript> };

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
type LinkProblem = { kind: "unavailable" } | { kind: "none" } | { kind: "expired" } | { kind: "other"; error: unknown };

function linkProblem(error: unknown): LinkProblem {
  if (error instanceof PortalError) {
    // The BFF turns the backend's 503 voice_media_unavailable into 503 service_unavailable (phase2-contract §1.2).
    if (error.status === 503 || error.code === "voice_media_unavailable") return { kind: "unavailable" };
    if (error.code === "call_content_unavailable") return { kind: "none" };
    if (error.status === 410 || error.code === "call_content_expired") return { kind: "expired" };
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
          {/* The heading names the block once; the summary text follows it without a second "Summary" label. */}
          <h4>{zh ? "摘要" : "Summary"}</h4>
          <p style={{ whiteSpace: "pre-wrap" }} data-voice-summary="">
            {summary.summary || "—"}
          </p>
          <dl className="portal-meta">
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
