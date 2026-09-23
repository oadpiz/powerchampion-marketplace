"use client";

import Link from "next/link";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  portalErrorText,
  portalRequest,
  safeAccountReturn,
  type PortalUser,
} from "../lib/portal-client";
import { useLocale } from "./locale-provider";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const register = mode === "register";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [signedIn, setSignedIn] = useState<PortalUser | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const [returnPath, setReturnPath] = useState("/account");

  useEffect(() => {
    // Read optional return navigation only after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReturnPath(
      safeAccountReturn(
        new URLSearchParams(window.location.search).get("next"),
      ),
    );
    return () => controller.current?.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await portalRequest<{ user: PortalUser }>(
        `/auth/${mode}`,
        {
          method: "POST",
          signal: abort.signal,
          body: JSON.stringify({
            email: email.trim(),
            password,
            ...(register ? { name: name.trim() } : {}),
          }),
        },
      );
      setPassword("");
      setSignedIn(result.user);
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause);
    } finally {
      inFlight.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  const title = register
    ? zh
      ? "建立你的帳號"
      : "Create your account"
    : zh
      ? "歡迎回來"
      : "Welcome back";
  return (
    <main
      id="main-content"
      className="platform-page portal-page portal-auth-page"
    >
      <section className="portal-auth-story">
        <p className="portal-kicker">POWERCHAMPION PLATFORM</p>
        <h1>
          {zh ? (
            <>
              從模型，
              <br />
              到你的下一個產品。
            </>
          ) : (
            <>
              From a model.
              <br />
              To your next product.
            </>
          )}
        </h1>
        <p>
          {zh
            ? "在同一個工作區管理帳號、API 金鑰、用量與儲值申請。"
            : "One workspace for your account, API keys, usage and credit requests."}
        </p>
        <Link href="/models">{zh ? "探索模型" : "Explore models"} ↗</Link>
      </section>
      <section
        className="portal-panel portal-auth-card"
        aria-labelledby="auth-title"
      >
        <p className="portal-kicker">
          {register ? "GET STARTED" : "YOUR WORKSPACE"}
        </p>
        <h2 id="auth-title">{title}</h2>
        {signedIn ? (
          <div className="portal-auth-success" role="status">
            <p>
              {zh
                ? `已登入為 ${signedIn.email}。`
                : `You are signed in as ${signedIn.email}.`}
            </p>
            <Link className="portal-button" href={returnPath}>
              {zh ? "前往工作區" : "Open workspace"} ↗
            </Link>
            {signedIn.role === "admin" && (
              <Link className="portal-text-link" href="/admin">
                {zh ? "開啟管理後台" : "Open administration"}
              </Link>
            )}
          </div>
        ) : (
          <>
            <p className="portal-muted">
              {register
                ? zh
                  ? "建立帳號後即可進入工作區。模型請求另依用量計費。"
                  : "Create an account to open your workspace. Model requests are billed separately by usage."
                : zh
                  ? "使用電子郵件與密碼登入你的工作區。"
                  : "Sign in to your workspace with your email and password."}
            </p>
            <form onSubmit={submit} className="portal-form">
              {register && (
                <label className="portal-field">
                  {zh ? "姓名" : "Name"}
                  <input
                    autoComplete="name"
                    value={name}
                    maxLength={100}
                    required
                    disabled={busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              <label className="portal-field">
                {zh ? "電子郵件" : "Email"}
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  maxLength={254}
                  required
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="portal-field">
                {zh ? "密碼" : "Password"}
                <input
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  value={password}
                  minLength={register ? 12 : 1}
                  maxLength={128}
                  required
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={
                    register ? "portal-password-help" : undefined
                  }
                />
              </label>
              {register && (
                <p className="portal-hint" id="portal-password-help">
                  {zh
                    ? "至少 12 個字元，請使用未在其他網站使用的密碼。"
                    : "Use at least 12 characters and a password you do not use elsewhere."}
                </p>
              )}
              {error !== null && (
                <p className="portal-error" role="alert">
                  {portalErrorText(error, locale)}
                </p>
              )}
              <button
                className="portal-button"
                type="submit"
                disabled={
                  busy ||
                  !email.trim() ||
                  !password ||
                  (register && (!name.trim() || password.length < 12))
                }
              >
                {busy
                  ? zh
                    ? "處理中…"
                    : "Please wait…"
                  : register
                    ? zh
                      ? "建立帳號"
                      : "Create account"
                    : zh
                      ? "登入"
                      : "Sign in"}
              </button>
            </form>
            <p className="portal-auth-switch">
              {register
                ? zh
                  ? "已經有帳號？"
                  : "Already have an account?"
                : zh
                  ? "第一次來？"
                  : "New to PowerChampion?"}{" "}
              <Link href={`${register ? "/login" : "/register"}${returnPath === "/account" ? "" : `?next=${encodeURIComponent(returnPath)}`}`}>
                {register
                  ? zh
                    ? "登入"
                    : "Sign in"
                  : zh
                    ? "建立帳號"
                    : "Create account"}
              </Link>
            </p>
            <p className="portal-hint">
              {zh ? "需要帳號協助？" : "Need help with your account?"}{" "}
              <Link href="mailto:info@powerchampion.org">
                {zh ? "聯繫支援" : "Contact support"}
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
