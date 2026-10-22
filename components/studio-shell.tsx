"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { PortalError, portalErrorText, portalRequest, type PortalUser } from "../lib/portal-client";
import { isStudioUnconfigured, studioApi, type StudioCredits } from "../lib/studio-client";
import { useLocale } from "./locale-provider";

type StudioSession = {
  user: PortalUser;
  credits: StudioCredits | null;
  creditsError: unknown;
  refreshCredits: () => void;
};

const StudioContext = createContext<StudioSession | null>(null);

export function useStudio(): StudioSession {
  const value = useContext(StudioContext);
  if (!value) throw new Error("useStudio outside the studio frame");
  return value;
}

const NAV = [
  { href: "/studio", zh: "我的影片", en: "My videos" },
  { href: "/studio/new", zh: "新增影片", en: "New video" },
  { href: "/studio/credits", zh: "點數", en: "Credits" },
  { href: "/studio/trash", zh: "回收區", en: "Trash" },
] as const;

function currentNav(pathname: string) {
  if (pathname.startsWith("/studio/new")) return "/studio/new";
  if (pathname.startsWith("/studio/credits")) return "/studio/credits";
  if (pathname.startsWith("/studio/trash")) return "/studio/trash";
  return "/studio";
}

/** Shown instead of every studio page while the portal has no video agent (503 studio_unconfigured). */
function StudioClosed({ zh }: { zh: boolean }) {
  return (
    <section className="portal-panel studio-closed" aria-labelledby="studio-closed-title">
      <div className="studio-empty-art" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="portal-kicker">VIDEO STUDIO</p>
      <h1 id="studio-closed-title">{zh ? "影片工作室尚未開放" : "The video studio is not open yet"}</h1>
      <p className="portal-muted">
        {zh
          ? "我們正在準備影片工作室：輸入商品或主題，AI 寫分鏡，逐鏡修改後產生影片。開放後即可在這裡使用，你的帳號與 API 服務不受影響。"
          : "We are getting the video studio ready: give a product or a topic, AI writes the storyboard, and you edit it shot by shot. It will open here; your account and API services are not affected."}
      </p>
      <div className="portal-actions">
        <Link className="portal-button" href="/contact">
          {zh ? "聯絡我們" : "Contact us"}
        </Link>
        <Link className="portal-button-secondary" href="/account">
          {zh ? "回到帳戶" : "Back to account"}
        </Link>
      </div>
    </section>
  );
}

/** Shared by every /studio page: the client-side session check, the studio navigation and the credits badge. */
export function StudioFrame({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const pathname = usePathname() ?? "/studio";
  const [user, setUser] = useState<PortalUser | null>(null);
  const [sessionError, setSessionError] = useState<unknown>(null);
  const [checking, setChecking] = useState(true);
  const [credits, setCredits] = useState<StudioCredits | null>(null);
  const [creditsError, setCreditsError] = useState<unknown>(null);
  const [creditsRevision, setCreditsRevision] = useState(0);
  const [sessionRevision, setSessionRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    portalRequest<{ user: PortalUser }>("/session", { signal: controller.signal })
      .then((session) => {
        if (controller.signal.aborted) return;
        setUser(session.user);
        setSessionError(null);
        setChecking(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setUser(null);
        setSessionError(cause);
        setChecking(false);
      });
    return () => controller.abort();
  }, [sessionRevision]);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    studioApi
      .credits(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setCredits(value);
        setCreditsError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setCreditsError(cause);
      });
    return () => controller.abort();
  }, [userId, creditsRevision, pathname]);

  const refreshCredits = useCallback(() => setCreditsRevision((value) => value + 1), []);
  const signedOut = sessionError instanceof PortalError && sessionError.status === 401;
  const active = currentNav(pathname);
  // The first credits answer decides whether the studio is open at all, so pages wait for it
  // instead of each asking the missing agent and showing an error.
  const closed = isStudioUnconfigured(creditsError);
  const creditsSettled = credits !== null || creditsError !== null;

  return (
    <main id="main-content" className="platform-page portal-page studio-page">
      <div className="studio-bar">
        <nav className="studio-nav" aria-label={zh ? "影片工作室導覽" : "Video studio navigation"}>
          <span className="studio-brand" aria-hidden="true">
            <span className="studio-brand-mark">▶</span>
            {zh ? "影片工作室" : "Video Studio"}
          </span>
          {!closed && NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined}>
              {zh ? item.zh : item.en}
            </Link>
          ))}
        </nav>
        {user && !closed && (
          <Link href="/studio/credits" className="studio-credit-badge" aria-label={zh ? "可用點數" : "Available credits"}>
            <span aria-hidden="true">◆</span>
            {credits ? (
              <>
                <strong data-testid="studio-balance">{credits.balance.toLocaleString()}</strong>
                <span>{zh ? "點可用" : "credits"}</span>
                {credits.reserved > 0 && (
                  <small>
                    {zh ? `預留 ${credits.reserved.toLocaleString()}` : `${credits.reserved.toLocaleString()} reserved`}
                  </small>
                )}
              </>
            ) : (
              <span>{creditsError ? (zh ? "點數無法讀取" : "Credits unavailable") : zh ? "讀取點數…" : "Loading credits…"}</span>
            )}
          </Link>
        )}
      </div>
      {checking ? (
        <p className="portal-empty" role="status">
          {zh ? "正在確認登入狀態…" : "Checking your session…"}
        </p>
      ) : signedOut ? (
        <section className="portal-panel studio-signin">
          <p className="portal-kicker">VIDEO STUDIO</p>
          <h2>{zh ? "登入後開始製作影片" : "Sign in to make videos"}</h2>
          <p className="portal-muted">
            {zh
              ? "影片工作室使用你的 PowerChampion 帳號。登入後即可建立商品影片、逐鏡修改並匯出。"
              : "The video studio uses your PowerChampion account. Sign in to create product videos, edit them shot by shot and export them."}
          </p>
          <div className="portal-actions">
            <Link className="portal-button" href={`/login?next=${encodeURIComponent(pathname)}`}>
              {zh ? "登入" : "Sign in"}
            </Link>
            <Link className="portal-button-secondary" href="/register">
              {zh ? "建立帳號" : "Create account"}
            </Link>
          </div>
        </section>
      ) : sessionError || !user ? (
        <section className="portal-panel portal-empty">
          <p role="alert" className="portal-error">
            {portalErrorText(sessionError, locale)}
          </p>
          <button className="portal-button-secondary" type="button" onClick={() => setSessionRevision((value) => value + 1)}>
            {zh ? "重新載入" : "Try again"}
          </button>
        </section>
      ) : closed ? (
        <StudioClosed zh={zh} />
      ) : !creditsSettled ? (
        <p className="portal-empty" role="status">
          {zh ? "正在載入影片工作室…" : "Loading the video studio…"}
        </p>
      ) : (
        <StudioContext.Provider value={{ user, credits, creditsError, refreshCredits }}>{children}</StudioContext.Provider>
      )}
    </main>
  );
}
