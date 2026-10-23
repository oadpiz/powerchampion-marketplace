"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { PortalError, portalErrorText, portalRequest } from "../lib/portal-client";
import type { VoiceSubProps, VoiceSummary } from "./account-voice";
import { useLocale } from "./locale-provider";

/** POST /me/voice/try (contract §3.12, M12). */
export type VoiceTryTicket = {
  ticket: string;
  url: string;
  expiresAt: string;
  version: number;
  remaining?: number;
};

/** Contract §6.1 / §6.4 step 2: two base64url segments joined by one dot, at most 128 KiB. */
const TICKET = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TICKET_MAX_CHARS = 131_072;

/**
 * The tab to open for a ticket: `url + "#t=" + ticket` (contract §6.3). The ticket must only ever travel in the
 * fragment, so a URL that is not plain http(s) or that already has a query or fragment is refused (null).
 */
export function tryLink(url: unknown, ticket: unknown): string | null {
  if (typeof url !== "string" || typeof ticket !== "string") return null;
  if (ticket.length > TICKET_MAX_CHARS || !TICKET.test(ticket)) return null;
  if (url.includes("?") || url.includes("#")) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return `${url}#t=${ticket}`;
}

type Failure = { kind: "limit" | "unavailable" | "other"; error: unknown };
type Issued = { id: number; link: string; deadline: number; expired: boolean };

function dateTime(value: string | null, zh: boolean) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString(zh ? "zh-TW" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

const setupLink = (zh: boolean) => <Link href="/account/voice/setup">{zh ? "設定" : "Setup"}</Link>;

/** Contract §8.4 / §9: copy for the limit and the unavailable states, whether M1 or M12 reported them. */
function limitText(zh: boolean, summary: VoiceSummary) {
  const { limit, windowHours } = summary.try;
  return zh
    ? `今天的試打次數用完了（${windowHours} 小時內最多 ${limit} 次），請稍後再試。`
    : `You have used all test calls for now (${limit} per ${windowHours} hours). Try again later.`;
}
const unavailableText = (zh: boolean) =>
  zh ? "試打暫時無法使用，請稍後再試或聯絡我們。" : "Test calls are unavailable right now. Try again later or contact us.";

/** M12 errors by code (contract §9); anything else falls back to the portal's status copy. */
function failureText(failure: Failure, zh: boolean, summary: VoiceSummary, locale: "en" | "zh"): ReactNode {
  if (failure.kind === "limit") return limitText(zh, summary);
  if (failure.kind === "unavailable") return unavailableText(zh);
  const code = failure.error instanceof PortalError ? failure.error.code : "";
  if (code === "password_change_required")
    return (
      <>
        {zh ? "請先到「" : "Change the temporary password we gave you under "}
        <Link href="/account/security">{zh ? "安全性" : "Security"}</Link>
        {zh ? "」變更我們發給你的臨時密碼，再修改設定或試打。" : " before editing or trying a call."}
      </>
    );
  if (code === "not_published")
    return (
      <>
        {zh ? "還沒有套用任何版本。請先到「" : "Nothing is applied yet. Use \"Save and apply\" on "}
        {setupLink(zh)}
        {zh ? "」按「儲存並套用」。" : " first."}
      </>
    );
  if (code === "store_suspended")
    return zh ? "這家店的電話客服已暫停，目前只能查看。" : "Phone agent is suspended for this store; it is read-only.";
  if (code === "voice_store_not_found")
    return zh ? "這個帳號沒有開通電話客服。" : "Phone agent is not set up for this account.";
  return portalErrorText(failure.error, locale);
}

function classify(error: unknown): Failure["kind"] {
  if (!(error instanceof PortalError)) return "other";
  // The BFF turns the backend's 503 voice_try_unavailable into 503 service_unavailable (contract §10 item 1).
  if (error.status === 429 || error.code === "voice_try_limit") return "limit";
  if (error.status === 503 || error.code === "voice_try_unavailable") return "unavailable";
  return "other";
}

/** /account/voice/try (contract §8.4, T9): issues a test-call ticket (M12) and opens the demo page with it. */
export function AccountVoiceTry({ summary, onChanged }: VoiceSubProps): ReactElement {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  // The count M12 answered with, kept only until the shell passes a refreshed M1 summary.
  const [seen, setSeen] = useState<{ summary: VoiceSummary; remaining: number } | null>(null);
  // Blocks a second request before React re-renders the disabled button (double click).
  const inFlight = useRef(false);
  const issueCount = useRef(0);
  const mounted = useRef(true);

  const { store } = summary;
  const ttlSeconds = summary.limits.ticketTtlSeconds;
  const ttlMinutes = Math.round(ttlSeconds / 60);
  const remaining = Math.max(
    0,
    seen && seen.summary === summary ? Math.min(seen.remaining, summary.try.remaining) : summary.try.remaining,
  );
  const published = store.currentVersion !== null;
  // A 429 sets `seen` to 0, so the button stays off until a refreshed M1 says otherwise.
  const limitReached = remaining <= 0;
  const suspended = store.status === "suspended";
  const blocked = !published || suspended || !summary.try.available || limitReached;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A ticket is valid for ticketTtlSeconds (§6.1); after that the fallback link is replaced by the expiry notice.
  useEffect(() => {
    if (!issued || issued.expired) return;
    const id = issued.id;
    const timer = window.setTimeout(
      () => setIssued((current) => (current && current.id === id ? { ...current, expired: true } : current)),
      Math.max(0, issued.deadline - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [issued]);

  async function start() {
    if (inFlight.current || blocked) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setIssued(null);
    const asked = summary;
    try {
      // Bodiless POSTs still send {} so the backend sees application/json (contract §1.1).
      const result = await portalRequest<VoiceTryTicket>("/me/voice/try", { method: "POST", body: "{}" });
      if (!mounted.current) return;
      const link = tryLink(result?.url, result?.ticket);
      if (!link) {
        setFailure({ kind: "unavailable", error: null });
      } else {
        issueCount.current += 1;
        setIssued({ id: issueCount.current, link, deadline: Date.now() + ttlSeconds * 1000, expired: false });
        if (typeof result.remaining === "number") setSeen({ summary: asked, remaining: result.remaining });
        window.open(link, "_blank", "noopener");
      }
      onChanged();
    } catch (error) {
      if (!mounted.current) return;
      const kind = classify(error);
      setFailure({ kind, error });
      if (kind === "limit") setSeen({ summary: asked, remaining: 0 });
      // The store's state changed under us (published, suspended, used up, misconfigured): re-read M1.
      if (error instanceof PortalError && [404, 409, 429, 503].includes(error.status)) onChanged();
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function openFallback(event: MouseEvent<HTMLAnchorElement>) {
    // Timers stall while a laptop sleeps; never hand out a ticket past its lifetime.
    if (issued && Date.now() >= issued.deadline) {
      event.preventDefault();
      setIssued({ ...issued, expired: true });
    }
  }

  return (
    <section className="portal-panel" aria-labelledby="voice-try-title">
      <h2 id="voice-try-title">{zh ? "試打一通" : "Try a call"}</h2>
      <p className="portal-muted">
        {zh
          ? "按下按鈕會開一個新分頁。請允許使用麥克風，直接對著電腦說話；聽到的是電話音質。"
          : "The button opens a new tab. Allow the microphone and speak to your computer; you will hear phone-quality audio."}
      </p>
      {published && (
        <p>
          {zh
            ? `試打會用：第 ${store.currentVersion} 版（${dateTime(store.publishedAt, zh)}）`
            : `Test calls use version ${store.currentVersion} (${dateTime(store.publishedAt, zh)})`}
        </p>
      )}
      {/* A suspended store cannot apply anything, so it is not told to (verifier finding 2026-10-22). */}
      {suspended ? (
        <p className="portal-note" role="status">
          {zh
            ? "這家店的電話客服已暫停，暫時不能試打，也不能套用新內容。有問題請聯絡我們。"
            : "Phone agent is suspended for this store: test calls and applying changes are paused. Contact us if you have questions."}
        </p>
      ) : !published ? (
        <p className="portal-note" role="status">
          {zh ? "還沒有套用任何版本。請先到「" : "Nothing is applied yet. Use \"Save and apply\" on "}
          {setupLink(zh)}
          {zh ? "」按「儲存並套用」，再回來試打。" : ", then come back."}
        </p>
      ) : null}
      {published && !suspended && store.hasUnpublishedChanges && (
        <p className="portal-note" role="status">
          {zh
            ? `有尚未套用的變更，試打會用第 ${store.currentVersion} 版。要試新內容，請先到「`
            : `Some changes are not applied; test calls use version ${store.currentVersion}. Use "Save and apply" on `}
          {setupLink(zh)}
          {zh ? "」按「儲存並套用」。" : " to try them."}
        </p>
      )}
      <p>
        {zh
          ? `${summary.try.windowHours} 小時內還可以試打 ${remaining} 次（上限 ${summary.try.limit} 次）`
          : `${remaining} test calls left in the last ${summary.try.windowHours} hours (limit ${summary.try.limit})`}
      </p>
      {failure ? (
        <p className="portal-error" role="alert">
          {failureText(failure, zh, summary, locale)}
        </p>
      ) : limitReached ? (
        <p className="portal-note" role="status">
          {limitText(zh, summary)}
        </p>
      ) : (
        !summary.try.available && (
          <p className="portal-note" role="status">
            {unavailableText(zh)}
          </p>
        )
      )}
      <div className="portal-actions">
        <button type="button" className="portal-button" disabled={busy || blocked} onClick={() => void start()}>
          {busy ? (zh ? "處理中…" : "Working…") : zh ? "試打一通" : "Try a call"}
        </button>
      </div>
      {issued &&
        (issued.expired ? (
          <p className="portal-note" role="status">
            {zh
              ? `這個試打連結已過期（${ttlMinutes} 分鐘）。請重新按「試打一通」。`
              : `This test link has expired (${ttlMinutes} minutes). Press "Try a call" again.`}
          </p>
        ) : (
          <p className="portal-note" role="status">
            {zh
              ? `已開啟試打分頁（${ttlMinutes} 分鐘內有效，只能用一次）。`
              : `The test call opened in a new tab (valid for ${ttlMinutes} minutes, one use).`}{" "}
            <a href={issued.link} target="_blank" rel="noopener noreferrer" onClick={openFallback}>
              {zh ? "沒有出現新分頁？按這裡開始試打" : "No new tab? Start the test call here"}
            </a>
          </p>
        ))}
      <p className="portal-hint">
        {zh
          ? "試打不計費、不留存錄音。試打一律會用 AI 回答，讓你先聽聽看；正式來電要等我們開啟「AI 回答」。"
          : "Test calls are free and not recorded. They always use AI answers so you can hear them; real calls use AI answers only after we turn them on."}
      </p>
    </section>
  );
}
