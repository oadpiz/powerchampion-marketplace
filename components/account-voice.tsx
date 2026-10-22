"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PortalError, portalErrorText, portalRequest } from "../lib/portal-client";
import { AccountVoiceCalls } from "./account-voice-calls";
import { AccountVoiceFaq } from "./account-voice-faq";
import { AccountVoiceSetup } from "./account-voice-setup";
import { AccountVoiceTry } from "./account-voice-try";
import { useLocale } from "./locale-provider";

export type VoiceSub = "setup" | "faq" | "try" | "calls";

/** Limits from GET /me/voice (contract §1.5). Read them from here; never hard-code them in a page. */
export type VoiceLimits = {
  storeNameChars: number;
  greetingChars: number;
  openingNonSpaceMax: number;
  openingSecondsMax: number;
  charsPerSecond: number;
  questionChars: number;
  variantChars: number;
  variantsMax: number;
  faqChars: number;
  kbCharsMax: number;
  faqMax: number;
  csvBodyBytes: number;
  hoursSegmentsPerDay: number;
  closuresMax: number;
  closureNoteChars: number;
  maxMessageSecondsMin: number;
  maxMessageSecondsMax: number;
  retentionDaysMax: number;
  retentionDaysMaxFull: number;
  tryLimit: number;
  tryWindowHours: number;
  ticketTtlSeconds: number;
};

/** GET /me/voice (contract §3.1, M1): decides whether the tab is shown and feeds the shell and its sub-pages. */
export type VoiceSummary = {
  store: {
    id: string;
    name: string;
    industry: string;
    templateId: string | null;
    status: string;
    currentVersion: number | null;
    publishedAt: string | null;
    hasUnpublishedChanges: boolean;
    faqCount: number;
    kbChars: number;
    aiAnswerEnabled: boolean;
    updatedAt: string;
  };
  account: { passwordChangeRequired: boolean };
  try: {
    available: boolean;
    limit: number;
    windowHours: number;
    used: number;
    remaining: number;
    lastIssuedAt: string | null;
  };
  limits: VoiceLimits;
};

/** What every sub-page receives. Call onChanged after a successful write so the shell re-reads M1. */
export type VoiceSubProps = { summary: VoiceSummary; onChanged: () => void };

export type VoiceState =
  | { status: "loading"; summary: null; error: null }
  | { status: "none"; summary: null; error: null }
  | { status: "ready"; summary: VoiceSummary; error: null }
  | { status: "error"; summary: null; error: unknown };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Only a real M1 body shows the tab; a mock or proxy answering some other JSON must not. */
export function isVoiceSummary(value: unknown): value is VoiceSummary {
  if (!record(value) || !record(value.store) || !record(value.account) || !record(value.try) || !record(value.limits)) return false;
  const { store, account } = value;
  return (
    typeof store.id === "string" &&
    typeof store.name === "string" &&
    typeof store.status === "string" &&
    typeof account.passwordChangeRequired === "boolean"
  );
}

/**
 * Loads GET /me/voice once a user is signed in. Any failure (404 when the account has no store or the
 * feature is off, network errors, unexpected bodies) leaves the tab hidden: only "ready" shows it.
 */
export function useVoiceSummary(userId: string | undefined, refresh: number) {
  const [state, setState] = useState<VoiceState>({ status: "loading", summary: null, error: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    async function load() {
      // A refresh after a sub-page write keeps the current summary on screen, so the sub-page is not remounted.
      setState((previous) => (previous.status === "ready" ? previous : { status: "loading", summary: null, error: null }));
      try {
        const result = await portalRequest<unknown>("/me/voice", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setState(
          isVoiceSummary(result)
            ? { status: "ready", summary: result, error: null }
            : { status: "none", summary: null, error: null },
        );
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof PortalError && cause.status === 404) setState({ status: "none", summary: null, error: null });
        // A failed refresh keeps the last good summary; only a first load shows the error.
        else setState((previous) => (previous.status === "ready" ? previous : { status: "error", summary: null, error: cause }));
      }
    }
    void load();
    return () => controller.abort();
  }, [userId, refresh, reload]);
  return { ...state, reload: () => setReload((value) => value + 1) };
}

const SUBS: { sub: VoiceSub; href: string; en: string; zh: string }[] = [
  { sub: "setup", href: "/account/voice/setup", en: "Setup", zh: "設定" },
  { sub: "faq", href: "/account/voice/faq", en: "FAQ", zh: "常見問答" },
  { sub: "try", href: "/account/voice/try", en: "Try a call", zh: "試打一通" },
  // Phase 2 (phase2-contract §10.3); /account/voice/calls/<id> stays under this item.
  { sub: "calls", href: "/account/voice/calls", en: "Calls", zh: "通話紀錄" },
];

const STATUS: Record<string, [string, string]> = {
  draft: ["Draft", "草稿"],
  testing: ["Testing", "測試中"],
  live: ["Live", "已上線"],
  suspended: ["Suspended", "已停用"],
};

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

/**
 * The first thing a store sees on the account overview (verifier finding 2026-10-22): the overview is about API keys,
 * and "Phone agent" was the sixth tab with nothing pointing at it. Shown only when GET /me/voice answered 200.
 */
export function VoiceStart({ summary, zh }: { summary: VoiceSummary; zh: boolean }) {
  const { store, account } = summary;
  const status = STATUS[store.status]?.[zh ? 1 : 0] ?? store.status;
  // A suspended store can only look (verifier finding 2026-10-22): same words as the Try page, and no "try a call".
  const suspended = store.status === "suspended";
  const text = suspended
    ? zh
      ? `這家店的電話客服已暫停，暫時不能試打，也不能套用新內容。有問題請聯絡我們。${account.passwordChangeRequired ? "臨時密碼仍請到「安全性」換掉。" : ""}`
      : `Phone agent is suspended for this store: test calls and applying changes are paused. Contact us if you have questions.${account.passwordChangeRequired ? " Please still replace the temporary password under Security." : ""}`
    : account.passwordChangeRequired
      ? zh
        ? "第一步：到「安全性」把我們給你的臨時密碼換掉。接著到電話客服完成設定，試打一通聽聽看。"
        : "First, replace the temporary password we gave you under Security. Then finish the phone agent setup and try a call."
      : store.currentVersion === null
        ? zh
          ? "到電話客服完成設定、帶入常見問答，按「套用」後就能試打一通聽聽看。"
          : 'Finish the setup and add your questions, then use "Apply" and try a call.'
        : zh
          ? `目前套用第 ${store.currentVersion} 版。可以繼續修改，或試打一通聽聽看。`
          : `Version ${store.currentVersion} is applied. Keep editing, or try a call.`;
  return (
    <section className="portal-panel" aria-labelledby="voice-start-title" data-voice-start="">
      <div className="portal-panel-heading">
        <h2 id="voice-start-title">{zh ? `電話客服：${store.name}` : `Phone agent: ${store.name}`}</h2>
        <span className="portal-badge">{status}</span>
      </div>
      <p>{text}</p>
      <div className="portal-actions">
        {account.passwordChangeRequired && (
          <Link className="portal-button" href="/account/security">
            {zh ? "變更臨時密碼" : "Change the temporary password"}
          </Link>
        )}
        <Link className={account.passwordChangeRequired ? "portal-button-secondary" : "portal-button"} href="/account/voice">
          {suspended
            ? zh
              ? "查看電話客服設定"
              : "View the phone agent settings"
            : zh
              ? "前往電話客服設定"
              : "Open the phone agent setup"}
        </Link>
      </div>
    </section>
  );
}

/**
 * /account/voice[/setup|faq|try|calls[/<id>]]: the shell around the merchant sub-pages (contract §8.1;
 * phase2-contract §10.2-§10.3 added the call records).
 */
export function AccountVoice({
  sub,
  callId,
  state,
  onReload,
}: {
  sub?: VoiceSub;
  /** One call on /account/voice/calls/<id>; ignored on the other sub-pages. */
  callId?: string;
  state: VoiceState;
  onReload: () => void;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  // /account/voice shows the same content as /account/voice/setup (contract §7.2).
  const current: VoiceSub = sub ?? "setup";
  if (state.status === "loading")
    return (
      <p className="portal-empty" role="status">
        {zh ? "正在載入電話客服設定…" : "Loading phone agent settings…"}
      </p>
    );
  if (state.status === "none")
    return (
      <section className="portal-panel portal-empty">
        <p>
          {zh
            ? "這個帳號沒有開通電話客服。電話客服帳號由我們開通，需要的話請聯絡我們。"
            : "Phone agent is not set up for this account. We set up phone agent accounts; contact us if you need one."}
        </p>
      </section>
    );
  if (state.status === "error")
    return (
      <section className="portal-panel portal-empty">
        <p role="alert" className="portal-error">
          {portalErrorText(state.error, locale)}
        </p>
        <button className="portal-button-secondary" onClick={onReload}>
          {zh ? "重新載入" : "Try again"}
        </button>
      </section>
    );
  const { store, account } = state.summary;
  const status = STATUS[store.status]?.[zh ? 1 : 0] ?? store.status;
  return (
    <>
      <section className="portal-panel" aria-labelledby="voice-store-name">
        <h2 id="voice-store-name">
          {store.name} <span className="portal-badge">{status}</span>
        </h2>
        <p>
          {store.currentVersion === null
            ? zh
              ? "還沒有套用任何版本"
              : "No version applied yet"
            : zh
              ? `目前套用：第 ${store.currentVersion} 版（${dateTime(store.publishedAt, zh)}）`
              : `Applied: version ${store.currentVersion} (${dateTime(store.publishedAt, zh)})`}
        </p>
        {/* With no version yet, M1 always says there are unpublished changes (contract §3.1); the line above
            already says nothing is applied, so this one would only suggest edits the store never made. */}
        {store.hasUnpublishedChanges && store.currentVersion !== null && (
          <p className="portal-note" role="status">
            {zh
              ? "有尚未套用的變更。到「設定」按「儲存並套用」後，試打才會用到新內容。"
              : 'You have changes that are not applied yet. Use "Save and apply" on Setup before you try a call.'}
          </p>
        )}
        {account.passwordChangeRequired && (
          <p className="portal-note" role="status">
            {zh ? "你目前的密碼是我們發給你的臨時密碼。請先到「" : "Your current password was issued by us. Change it under "}
            <Link href="/account/security">{zh ? "安全性" : "Security"}</Link>
            {zh ? "」變更密碼，才能儲存設定或試打。" : " before you can save settings or try a call."}
          </p>
        )}
        {store.status === "suspended" && (
          <p className="portal-note" role="status">
            {zh
              ? "這家店的電話客服已暫停，目前只能查看設定。有問題請聯絡我們。"
              : "Phone agent is suspended for this store; settings are read-only. Contact us if you have questions."}
          </p>
        )}
      </section>
      <nav className="portal-nav" aria-label={zh ? "電話客服頁面" : "Phone agent pages"}>
        {SUBS.map((item) => (
          <Link key={item.sub} href={item.href} aria-current={current === item.sub ? "page" : undefined}>
            {item[locale]}
          </Link>
        ))}
      </nav>
      {current === "setup" && <AccountVoiceSetup summary={state.summary} onChanged={onReload} />}
      {current === "faq" && <AccountVoiceFaq summary={state.summary} onChanged={onReload} />}
      {current === "try" && <AccountVoiceTry summary={state.summary} onChanged={onReload} />}
      {current === "calls" && <AccountVoiceCalls summary={state.summary} onChanged={onReload} callId={callId} />}
    </>
  );
}
