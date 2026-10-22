"use client";

import { useEffect, useRef, useState } from "react";
import { PortalError, portalRequest } from "../lib/portal-client";
import type { CallContent, MediaKind } from "../lib/voice-calls";
import { parseLink, readMedia, type MediaFailure, type MediaLink } from "../lib/voice-media";
import { fill, qualityErrorText, say, taipeiDate, type Copy } from "./admin-voice-quality-labels";
import { useLocale } from "./locale-provider";

/*
 * The drawer's "Content" block (phase2-contract §7.4 A12, §8.3, §11.2 and §11.3 "內容"). The portal keeps no
 * transcript, summary or recording: A12 signs a 5-minute token and the browser reads each kind from the Taiwan host
 * with it. The token lives only in a ref and in the Authorization header: never in a URL, state that renders, a log
 * or an error message (§6.5). The link and every read go through lib/voice-media.ts, like the store page: the link is
 * checked before anything is sent, a redirect is an error, a recording must be audio/* and a transcript or summary
 * must have the §8.3 shape. The recording is fetched as a blob (an <audio src> cannot carry a header) and its
 * object URL is revoked when the drawer closes. Every A12 is audited and counted (60 per hour per account), so a
 * token that expired is renewed once automatically and never more.
 */

const C = {
  title: { zh: "內容", en: "Content" },
  audited: { zh: "查看內容會記在稽核紀錄。", en: "Viewing content is recorded in the audit log." },
  until: { zh: "逐字稿與摘要可以查看到 {date}。", en: "Transcript and summary can be viewed until {date}." },
  recordingUntil: { zh: "錄音可以查看到 {date}。", en: "The recording can be viewed until {date}." },
  show: { zh: "查看內容", en: "Show content" },
  play: { zh: "播放錄音", en: "Play recording" },
  loading: { zh: "正在讀取內容…", en: "Loading content…" },
  none: { zh: "這通沒有保存內容。", en: "No content was kept for this call." },
  expired: { zh: "內容已超過保存期限，不能再查看。", en: "The content is past its retention period and can no longer be viewed." },
  // §11.2 says "your recording setting" to the store; here the operator reads about the store's setting.
  noRecording: {
    zh: "這通沒有錄音（依店家的錄音設定，或客人要求不錄音）。",
    en: "There is no recording for this call (because of the store's recording setting or the caller's request).",
  },
  notReady: {
    zh: "內容還在處理，通常在通話結束後幾分鐘內完成。請稍後再試。",
    en: "The content is still being processed, usually within a few minutes after the call. Try again later.",
  },
  linkExpired: { zh: "查看連結已過期，請再按一次「查看內容」。", en: 'The viewing link expired. Choose "Show content" again.' },
  unreachable: { zh: "內容暫時讀不到，請稍後再試。", en: "The content cannot be loaded right now. Try again later." },
  failed: { zh: "內容讀取失敗，請重新整理後再試。", en: "The content could not be loaded. Reload and try again." },
  off: { zh: "查看內容的功能還沒開放。", en: "Viewing call content is not available yet." },
  transcript: { zh: "逐字稿", en: "Transcript" },
  summary: { zh: "摘要", en: "Summary" },
  callback: { zh: "回電號碼", en: "Callback number" },
  message: { zh: "留言內容", en: "Message" },
  urgent: { zh: "緊急", en: "Urgent" },
  noSegments: { zh: "逐字稿是空的。", en: "The transcript is empty." },
  player: { zh: "通話錄音", en: "Call recording" },
} satisfies Record<string, Copy>;

const SPEAKER: Record<string, Copy> = {
  caller: { zh: "客人", en: "Caller" },
  ai: { zh: "AI", en: "AI" },
  system: { zh: "系統", en: "System" },
};

type Segment = { speaker: string; startMs: number | null; text: string };
type Summary = { summary: string; callbackNumber: string | null; messageText: string | null; urgent: boolean };
/** One kind's result: its data, or the Taiwan host's error code ("network" for no answer or a 5xx). */
type Read<T> = { ok: true; value: T } | { ok: false; code: string };

/** §8.3 error codes (and "network", "expired_again") to the §11.2 / §12.1 copy. */
function mediaErrorText(code: string, zh: boolean): string {
  switch (code) {
    case "media_not_ready":
      return say(C.notReady, zh);
    case "expired_again":
      return say(C.linkExpired, zh);
    case "network":
      return say(C.unreachable, zh);
    case "media_not_found":
      return say(C.none, zh);
    case "media_expired":
      return say(C.expired, zh);
    default:
      return say(C.failed, zh);
  }
}

/** The §8.3 transcript shape, read defensively: only string text is shown, as text. */
function segmentsOf(data: unknown): Segment[] | null {
  const segments = (data as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments)) return null;
  return segments
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string")
    .map((item) => ({
      speaker: typeof item.speaker === "string" ? item.speaker : "",
      startMs: typeof item.start_ms === "number" && Number.isFinite(item.start_ms) ? item.start_ms : null,
      text: item.text as string,
    }));
}

function summaryOf(data: unknown): Summary | null {
  if (typeof data !== "object" || data === null) return null;
  const value = data as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  return { summary: text("summary") ?? "", callbackNumber: text("callback_number"), messageText: text("message_text"), urgent: value.urgent === true };
}

/** lib/voice-media.ts failures as the codes mediaErrorText words (§8.3). */
const FAILURE_CODE: Record<MediaFailure, string> = {
  token_expired: "media_token_expired",
  token_again: "expired_again",
  invalid: "media_token_invalid",
  not_ready: "media_not_ready",
  not_found: "media_not_found",
  expired: "media_expired",
  unreachable: "network",
};

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function AdminVoiceQualityContent({ rowId, content }: { rowId: string; content: CallContent }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const media = useRef<MediaLink | null>(null);
  const renewing = useRef<Promise<MediaLink> | null>(null);
  /** Aborted when the drawer closes, so no read outlives it. */
  const reads = useRef(new AbortController());
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<"show" | "play" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [kinds, setKinds] = useState<MediaKind[]>([]);
  const [transcript, setTranscript] = useState<Read<Segment[]> | null>(null);
  const [summary, setSummary] = useState<Read<Summary> | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    reads.current = controller;
    return () => {
      controller.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
      media.current = null;
    };
  }, []);

  /** A12: a new token (one audited, counted request; concurrent renewals share it). A malformed answer is not used. */
  function requestLink(): Promise<MediaLink> {
    renewing.current ??= portalRequest<unknown>(`/admin/voice/quality/calls/${rowId}/content-link`, { method: "POST", body: "{}" })
      .then((result) => {
        const link = parseLink(result);
        if (!link) throw new PortalError(502, "service_unavailable", "Unexpected answer.");
        media.current = link;
        setKinds(link.kinds);
        return link;
      })
      .finally(() => {
        renewing.current = null;
      });
    return renewing.current;
  }

  async function read(kind: MediaKind, retried = false): Promise<Read<unknown>> {
    const current = media.current;
    const url = current?.urls[kind];
    if (!current || !url) return { ok: false, code: "media_not_found" };
    const result = await readMedia(url, current.token, kind, reads.current.signal);
    if (result.ok) return result;
    if (result.failure !== "token_expired") return { ok: false, code: FAILURE_CODE[result.failure] };
    if (retried) return { ok: false, code: "expired_again" };
    try {
      await requestLink();
    } catch {
      return { ok: false, code: "expired_again" };
    }
    return read(kind, true);
  }

  function linkErrorText(error: unknown): string {
    // The BFF turns A12's 503 voice_media_unavailable into service_unavailable (§12.1).
    if (error instanceof PortalError && error.status === 503) return say(C.off, zh);
    return qualityErrorText(error, locale);
  }

  async function show() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("show");
    setMessage(null);
    try {
      const link = await requestLink();
      const [readTranscript, readSummary] = await Promise.all([
        link.kinds.includes("transcript") ? read("transcript") : Promise.resolve(null),
        link.kinds.includes("summary") ? read("summary") : Promise.resolve(null),
      ]);
      if (readTranscript) {
        const segments = readTranscript.ok ? segmentsOf(readTranscript.value) : null;
        setTranscript(readTranscript.ok ? (segments ? { ok: true, value: segments } : { ok: false, code: "unknown" }) : readTranscript);
      }
      if (readSummary) {
        const parsed = readSummary.ok ? summaryOf(readSummary.value) : null;
        setSummary(readSummary.ok ? (parsed ? { ok: true, value: parsed } : { ok: false, code: "unknown" }) : readSummary);
      }
    } catch (error: unknown) {
      if (reads.current.signal.aborted) return;
      setMessage(linkErrorText(error));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function play() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("play");
    setRecordingError(null);
    try {
      // A token about to expire is renewed first rather than spent on a download that may fail half-way.
      const current = media.current;
      if (!current || current.expiresAt - Date.now() < 10_000) await requestLink();
      const result = await read("recording");
      if (!result.ok) {
        setRecordingError(mediaErrorText(result.code, zh));
        return;
      }
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(result.value as Blob);
      setRecording(objectUrl.current);
    } catch (error: unknown) {
      if (reads.current.signal.aborted) return;
      setRecordingError(linkErrorText(error));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const speaker = (value: string) => (SPEAKER[value] ? say(SPEAKER[value], zh) : value || "—");
  return (
    <div className="voice-quality-content" aria-labelledby="voice-quality-content-title" role="group">
      <h3 id="voice-quality-content-title">{say(C.title, zh)}</h3>
      {content.state === "none" ? (
        <p className="portal-muted">{say(C.none, zh)}</p>
      ) : content.state === "expired" ? (
        <p className="portal-muted">{say(C.expired, zh)}</p>
      ) : (
        <>
          <p className="portal-muted">
            {content.transcriptUntil && fill(say(C.until, zh), { date: taipeiDate(content.transcriptUntil, zh) })}
            {content.recordingUntil && (
              <>
                {" "}
                {fill(say(C.recordingUntil, zh), { date: taipeiDate(content.recordingUntil, zh) })}
              </>
            )}
          </p>
          {!content.hasRecording && <p className="portal-muted">{say(C.noRecording, zh)}</p>}
          <p className="portal-hint">{say(C.audited, zh)}</p>
          {!content.linkAvailable && (
            <p className="portal-note" role="status">
              {say(C.off, zh)}
            </p>
          )}
          <div className="portal-actions">
            <button type="button" className="portal-button-secondary" disabled={!content.linkAvailable || busy !== null} onClick={() => void show()}>
              {busy === "show" ? say(C.loading, zh) : say(C.show, zh)}
            </button>
            {kinds.includes("recording") && (
              <button type="button" className="portal-button-secondary" disabled={busy !== null} onClick={() => void play()}>
                {busy === "play" ? say(C.loading, zh) : say(C.play, zh)}
              </button>
            )}
          </div>
          {busy === "show" && (
            <p className="portal-muted" role="status">
              {say(C.loading, zh)}
            </p>
          )}
          {message !== null && (
            <p className="portal-error" role="alert">
              {message}
            </p>
          )}
          {recordingError !== null && (
            <p className="portal-error" role="alert">
              {recordingError}
            </p>
          )}
          {recording !== null && (
            <audio controls src={recording} aria-label={say(C.player, zh)}>
              <track kind="captions" />
            </audio>
          )}
          {summary !== null && (
            <>
              <h4>{say(C.summary, zh)}</h4>
              {summary.ok ? (
                <dl className="portal-meta">
                  <dt>{say(C.summary, zh)}</dt>
                  <dd>{summary.value.summary || "—"}</dd>
                  <dt>{say(C.callback, zh)}</dt>
                  <dd>{summary.value.callbackNumber ?? "—"}</dd>
                  <dt>{say(C.message, zh)}</dt>
                  <dd>{summary.value.messageText ?? "—"}</dd>
                  {summary.value.urgent && (
                    <>
                      <dt>{say(C.urgent, zh)}</dt>
                      <dd>{say(C.urgent, zh)}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className="portal-error" role="alert">
                  {mediaErrorText(summary.code, zh)}
                </p>
              )}
            </>
          )}
          {transcript !== null && (
            <>
              <h4>{say(C.transcript, zh)}</h4>
              {transcript.ok ? (
                transcript.value.length === 0 ? (
                  <p className="portal-muted">{say(C.noSegments, zh)}</p>
                ) : (
                  <ol className="voice-quality-transcript">
                    {transcript.value.map((segment, index) => (
                      <li key={index}>
                        <strong>{speaker(segment.speaker)}</strong>
                        {segment.startMs !== null && <span className="portal-muted"> {clock(segment.startMs)}</span>}
                        {zh ? "：" : ": "}
                        {segment.text}
                      </li>
                    ))}
                  </ol>
                )
              ) : (
                <p className="portal-error" role="alert">
                  {mediaErrorText(transcript.code, zh)}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
