"use client";

import Link from "next/link";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  PortalError,
  portalErrorText,
  portalRequest,
  type PortalUser,
} from "../lib/portal-client";
import { useLocale } from "./locale-provider";

type Section = "overview" | "keys" | "usage" | "credits";
type Key = {
  id: string;
  label: string;
  prefix: string;
  status: string;
  createdAt: string;
};
type Credit = {
  id: string;
  amountUsd: number;
  status: string;
  reference: string;
  createdAt: string;
  reviewedAt?: string | null;
};
type Overview = {
  user: PortalUser;
  keyCount: number;
  pendingCreditCount: number;
  approvedCreditUsd: number;
  gatewayConfigured: boolean;
};
type Keys = { keys: Key[]; gatewayConfigured: boolean };
type Usage = {
  month: string;
  rows: {
    model: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }[];
  source: "gateway" | "unconfigured";
  updatedAt: string | null;
};
type Credits = { requests: Credit[] };
const NAV: { section: Section; href: string; en: string; zh: string }[] = [
  { section: "overview", href: "/account", en: "Overview", zh: "總覽" },
  { section: "keys", href: "/account/keys", en: "API keys", zh: "API 金鑰" },
  { section: "usage", href: "/account/usage", en: "Usage", zh: "使用量" },
  {
    section: "credits",
    href: "/account/credits",
    en: "Credit requests",
    zh: "儲值申請",
  },
];
const number = (value: number) => value.toLocaleString("en-US");
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
function date(value: string | null | undefined, zh: boolean) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString(zh ? "zh-TW" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
function statusText(value: string, zh: boolean) {
  const known: Record<string, [string, string]> = {
    active: ["Active", "使用中"],
    revoked: ["Revoked", "已撤銷"],
    pending: ["Pending review", "待審核"],
    approved: ["Approved record", "已核准紀錄"],
    rejected: ["Rejected", "未核准"],
  };
  return known[value]?.[zh ? 1 : 0] ?? value;
}

export function AccountPortal({ section = "overview" }: { section?: Section }) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [user, setUser] = useState<PortalUser | null>(null);
  const [data, setData] = useState<Overview | Keys | Usage | Credits | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [mutationError, setMutationError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [revokeKey, setRevokeKey] = useState<Key | null>(null);
  const [amount, setAmount] = useState("50");
  const [reference, setReference] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const mutationBusy = useRef(false);
  const currentPath =
    NAV.find((item) => item.section === section)?.href ?? "/account";
  const heading =
    NAV.find((item) => item.section === section)?.[locale] ?? "Overview";

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const session = await portalRequest<{ user: PortalUser }>("/session", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setUser(session.user);
        const path =
          section === "overview"
            ? "/overview"
            : section === "usage"
              ? `/usage?month=${encodeURIComponent(month)}`
              : `/${section}`;
        const result = await portalRequest<Overview | Keys | Usage | Credits>(
          path,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setData(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause);
          if (cause instanceof PortalError && cause.status === 401)
            setUser(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [section, month, refresh]);

  useEffect(() => () => mutationController.current?.abort(), []);

  useEffect(() => {
    if (!revokeKey || !dialog.current) return;
    const element = dialog.current;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    element.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (typeof element.close === "function") element.close();
      previous?.focus();
    };
  }, [revokeKey]);

  async function mutate<T>(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<T | null> {
    if (mutationBusy.current) return null;
    mutationBusy.current = true;
    const controller = new AbortController();
    mutationController.current = controller;
    setBusy(true);
    setMutationError(null);
    try {
      return await portalRequest<T>(path, {
        method,
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      if (!controller.signal.aborted) setMutationError(cause);
      return null;
    } finally {
      mutationBusy.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !label.trim() || secret) return;
    const result = await mutate<{ key: Key; secret: string }>("/keys", "POST", {
      label: label.trim(),
    });
    if (result) {
      setSecret(result.secret);
      setCopyState("idle");
      setLabel("");
      setData((previous) =>
        previous && "keys" in previous
          ? { ...previous, keys: [result.key, ...previous.keys] }
          : previous,
      );
    }
  }

  async function revoke() {
    if (!revokeKey || busy) return;
    const id = revokeKey.id;
    const result = await mutate<{ ok: boolean }>(
      `/keys/${encodeURIComponent(id)}`,
      "DELETE",
    );
    if (result) {
      setRevokeKey(null);
      setSecret(null);
      setRefresh((value) => value + 1);
    }
  }

  async function submitCredit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const result = await mutate<unknown>("/credits", "POST", {
      amountUsd: Number(amount),
      reference: reference.trim(),
    });
    if (result) {
      setSubmitted(true);
      setReference("");
      setRefresh((value) => value + 1);
    }
  }

  async function signOut() {
    const result = await mutate<{ ok: boolean }>("/auth/logout", "POST");
    if (result) {
      setUser(null);
      setData(null);
      setSecret(null);
      setError(new PortalError(401, "auth_required", "Signed out"));
    }
  }

  async function copySecret() {
    try {
      if (secret) await navigator.clipboard.writeText(secret);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  const authRequired = error instanceof PortalError && error.status === 401;
  const unconfigured = (
    <p className="portal-note">
      {zh
        ? "金鑰與用量服務尚未連接至模型閘道。完成設定前，無法發行新金鑰或讀取實際用量。"
        : "Key and usage services are not connected to the model gateway. New key issuance and actual usage reporting are unavailable until setup is complete."}
    </p>
  );

  return (
    <main id="main-content" className="platform-page portal-page">
      <header className="portal-header">
        <div>
          <p className="portal-kicker">YOUR ACCOUNT</p>
          <h1>{heading}</h1>
          <p>
            {user
              ? `${user.name} · ${user.email}`
              : zh
                ? "你的 PowerChampion 工作區"
                : "Your PowerChampion workspace"}
          </p>
        </div>
        <div className="portal-actions">
          {user?.role === "admin" && (
            <Link className="portal-button-secondary" href="/admin">
              {zh ? "管理後台" : "Administration"} ↗
            </Link>
          )}
          {user && (
            <button
              className="portal-button-secondary"
              disabled={busy}
              onClick={signOut}
            >
              {zh ? "登出" : "Sign out"}
            </button>
          )}
        </div>
      </header>
      <nav
        className="portal-nav"
        aria-label={zh ? "帳號導覽" : "Account navigation"}
      >
        {NAV.map((item) => (
          <Link
            key={item.section}
            href={item.href}
            aria-current={section === item.section ? "page" : undefined}
          >
            {item[locale]}
          </Link>
        ))}
      </nav>
      {loading && (
        <p className="portal-empty" role="status">
          {zh ? "正在載入帳號資料…" : "Loading account information…"}
        </p>
      )}
      {error !== null && (
        <section className="portal-panel portal-empty">
          <p role="alert" className="portal-error">
            {portalErrorText(error, locale)}
          </p>
          {authRequired ? (
            <div className="portal-actions">
              <Link
                className="portal-button"
                href={`/login?next=${encodeURIComponent(currentPath)}`}
              >
                {zh ? "登入" : "Sign in"}
              </Link>
              <Link className="portal-button-secondary" href="/register">
                {zh ? "建立帳號" : "Create account"}
              </Link>
            </div>
          ) : (
            <button
              className="portal-button-secondary"
              onClick={() => setRefresh((value) => value + 1)}
            >
              {zh ? "重新載入" : "Try again"}
            </button>
          )}
        </section>
      )}
      {mutationError !== null && !revokeKey && (
        <p className="portal-error" role="alert">
          {portalErrorText(mutationError, locale)}
        </p>
      )}

      {!loading &&
        !error &&
        data &&
        section === "overview" &&
        "keyCount" in data && (
          <>
            <div className="portal-grid">
              <div className="portal-panel portal-stat">
                <p>{zh ? "API 金鑰" : "API keys"}</p>
                <strong>{number(data.keyCount)}</strong>
                <Link href="/account/keys">
                  {zh ? "管理金鑰" : "Manage keys"} ↗
                </Link>
              </div>
              <div className="portal-panel portal-stat">
                <p>{zh ? "待審核儲值申請" : "Pending credit requests"}</p>
                <strong>{number(data.pendingCreditCount)}</strong>
                <Link href="/account/credits">
                  {zh ? "查看申請" : "View requests"} ↗
                </Link>
              </div>
              <div className="portal-panel portal-stat">
                <p>{zh ? "已核准申請金額" : "Approved request amount"}</p>
                <strong>{money(data.approvedCreditUsd)}</strong>
                <span>
                  {zh
                    ? "此數字為審核紀錄，並非模型閘道餘額。"
                    : "Review records, not your gateway balance."}
                </span>
              </div>
            </div>
            {!data.gatewayConfigured && unconfigured}
            <section className="portal-panel">
              <div className="portal-panel-heading">
                <h2>{zh ? "接下來做什麼" : "Build from here"}</h2>
                <span className="portal-badge">
                  {data.gatewayConfigured
                    ? zh
                      ? "已設定閘道"
                      : "Gateway configured"
                    : zh
                      ? "等待服務設定"
                      : "Awaiting service setup"}
                </span>
              </div>
              <div className="portal-next-grid">
                <Link href="/models">
                  <b>01</b>
                  <h3>{zh ? "選擇模型" : "Find your model"}</h3>
                  <p>
                    {zh
                      ? "比較模型能力、價格與適用情境。"
                      : "Compare capabilities, pricing and suitable workloads."}
                  </p>
                </Link>
                <Link href="/account/keys">
                  <b>02</b>
                  <h3>{zh ? "建立 API 金鑰" : "Create an API key"}</h3>
                  <p>
                    {zh
                      ? "為每個應用程式建立可獨立撤銷的金鑰。"
                      : "Keep separate, revocable keys for your applications."}
                  </p>
                </Link>
                <Link href="/playground">
                  <b>03</b>
                  <h3>{zh ? "傳送第一個請求" : "Send your first request"}</h3>
                  <p>
                    {zh
                      ? "在測試台驗證提示詞，再帶入程式碼。"
                      : "Test your prompt in the playground, then take it into code."}
                  </p>
                </Link>
              </div>
            </section>
          </>
        )}

      {!loading && !error && data && section === "keys" && "keys" in data && (
        <>
          {!data.gatewayConfigured && unconfigured}
          {secret && (
            <section
              className="portal-panel portal-secret"
              aria-labelledby="secret-title"
            >
              <h2 id="secret-title">
                {zh ? "立即安全保存這把金鑰" : "Save this key securely now"}
              </h2>
              <p>
                {zh
                  ? "完整金鑰只會顯示這一次，關閉後無法再次查看。請存入安全的密碼管理工具。"
                  : "The full key is shown only once. After dismissing it, you cannot view it again. Save it in a secure password manager."}
              </p>
              <code>{secret}</code>
              <div className="portal-actions">
                <button className="portal-button" onClick={copySecret}>
                  {zh ? "複製金鑰" : "Copy key"}
                </button>
                <button
                  className="portal-button-secondary"
                  onClick={() => {
                    setSecret(null);
                    setCopyState("idle");
                  }}
                >
                  {zh ? "我已保存金鑰" : "I have saved this key"}
                </button>
              </div>
              <p role="status" className="portal-hint">
                {copyState === "copied"
                  ? zh
                    ? "已複製"
                    : "Copied"
                  : copyState === "error"
                    ? zh
                      ? "無法自動複製，請選取金鑰手動複製。"
                      : "Copy is unavailable. Select the key and copy it manually."
                    : ""}
              </p>
            </section>
          )}
          <section className="portal-panel">
            <div className="portal-panel-heading">
              <h2>{zh ? "建立 API 金鑰" : "Create an API key"}</h2>
              <Link href="/docs">
                {zh ? "金鑰使用方式" : "Using your key"} ↗
              </Link>
            </div>
            <form className="portal-inline-form" onSubmit={createKey}>
              <label className="portal-field">
                {zh ? "金鑰名稱" : "Key label"}
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  maxLength={100}
                  required
                  placeholder={zh ? "例如：正式環境" : "e.g. Production app"}
                  disabled={busy || !data.gatewayConfigured || !!secret}
                />
              </label>
              <button
                className="portal-button"
                disabled={
                  busy || !data.gatewayConfigured || !label.trim() || !!secret
                }
              >
                {busy
                  ? zh
                    ? "處理中…"
                    : "Please wait…"
                  : zh
                    ? "建立 API 金鑰"
                    : "Create API key"}
              </button>
            </form>
          </section>
          <section className="portal-panel">
            <div className="portal-panel-heading">
              <h2>{zh ? "你的金鑰" : "Your keys"}</h2>
              <button
                className="portal-text-button"
                disabled={busy}
                onClick={() => setRefresh((value) => value + 1)}
              >
                {zh ? "重新整理" : "Refresh"}
              </button>
            </div>
            {data.keys.length === 0 ? (
              <p className="portal-empty">
                {zh
                  ? "尚未建立 API 金鑰。"
                  : "You have not created any API keys yet."}
              </p>
            ) : (
              <div className="portal-table-wrap">
                <table className="portal-table">
                  <thead>
                    <tr>
                      <th>{zh ? "名稱" : "Label"}</th>
                      <th>{zh ? "金鑰前綴" : "Prefix"}</th>
                      <th>{zh ? "狀態" : "Status"}</th>
                      <th>{zh ? "建立日期" : "Created"}</th>
                      <th>{zh ? "操作" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.keys.map((item) => (
                      <tr key={item.id}>
                        <td>{item.label}</td>
                        <td>
                          <code>{item.prefix}…</code>
                        </td>
                        <td>
                          <span className="portal-badge">
                            {statusText(item.status, zh)}
                          </span>
                        </td>
                        <td>{date(item.createdAt, zh)}</td>
                        <td>
                          {item.status === "active" && (
                            <button
                              className="portal-text-button portal-danger"
                              disabled={busy || !data.gatewayConfigured}
                              aria-label={`${zh ? "撤銷" : "Revoke"} ${item.label}`}
                              onClick={() => {
                                setMutationError(null);
                                setRevokeKey(item);
                              }}
                            >
                              {zh ? "撤銷" : "Revoke"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {!loading && !error && data && section === "usage" && "rows" in data && (
        <section className="portal-panel">
          <div className="portal-panel-heading">
            <h2>{zh ? "每月模型用量" : "Monthly model usage"}</h2>
            <label className="portal-field portal-month-field">
              {zh ? "月份" : "Month"}
              <input
                type="month"
                value={month}
                onChange={(event) => {
                  if (/^\d{4}-\d{2}$/.test(event.target.value))
                    setMonth(event.target.value);
                }}
              />
            </label>
          </div>
          {data.source === "unconfigured" ? (
            <p className="portal-note">
              {zh
                ? "用量報表尚未連接，這不代表用量為零。服務完成設定後才會顯示閘道回報的實際資料。"
                : "Usage reporting is not connected. This does not mean your usage is zero. Actual gateway data will appear once reporting is configured."}
            </p>
          ) : (
            <>
              {data.rows.length === 0 ? (
                <p className="portal-empty">
                  {zh
                    ? "閘道未回報此月份的使用紀錄。"
                    : "The gateway reported no usage records for this month."}
                </p>
              ) : (
                <div className="portal-table-wrap">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>{zh ? "模型" : "Model"}</th>
                        <th>{zh ? "請求數" : "Requests"}</th>
                        <th>{zh ? "輸入 Tokens" : "Input tokens"}</th>
                        <th>{zh ? "輸出 Tokens" : "Output tokens"}</th>
                        <th>{zh ? "費用（USD）" : "Cost (USD)"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.model}>
                          <td>
                            <code>{row.model}</code>
                          </td>
                          <td>{number(row.requests)}</td>
                          <td>{number(row.inputTokens)}</td>
                          <td>{number(row.outputTokens)}</td>
                          <td>{money(row.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="portal-hint">
                {zh
                  ? "資料來源：模型閘道。更新時間："
                  : "Source: model gateway. Updated: "}
                {date(data.updatedAt, zh)}
              </p>
            </>
          )}
        </section>
      )}

      {submitted && section === "credits" && (
        <p className="portal-note" role="status">
          {zh
            ? "已送出驗證申請，請等待人工審核。此操作尚未增加模型閘道額度。"
            : "Verification request submitted. It is awaiting manual review and has not added gateway credits."}
        </p>
      )}
      {!loading &&
        !error &&
        data &&
        section === "credits" &&
        "requests" in data && (
          <>
            <section className="portal-panel">
              <h2>{zh ? "提交付款驗證" : "Submit payment verification"}</h2>
              <p className="portal-muted">
                {zh
                  ? "已依團隊提供的付款方式完成付款後，請提交金額與參考編號，供團隊核對。尚未付款請先聯繫我們。"
                  : "After paying through the instructions provided by our team, submit the amount and reference for review. Contact us first if you have not arranged payment."}
              </p>
              <p className="portal-note">
                {zh
                  ? "此表單只建立待審核紀錄，不會扣款，也不會增加模型閘道額度。實際可用餘額請至餘額查詢確認。"
                  : "This form creates a review request. It does not charge your payment method or add gateway credits. Check your gateway balance separately."}
              </p>
              <form className="portal-credit-form" onSubmit={submitCredit}>
                <label className="portal-field">
                  {zh ? "已付款金額（USD）" : "Amount paid (USD)"}
                  <input
                    type="number"
                    min={10}
                    max={10000}
                    step="0.01"
                    value={amount}
                    required
                    disabled={busy}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
                <label className="portal-field">
                  {zh ? "付款參考編號" : "Payment reference"}
                  <input
                    value={reference}
                    maxLength={160}
                    required
                    disabled={busy}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder={
                      zh
                        ? "轉帳或付款確認編號"
                        : "Bank transfer or payment confirmation reference"
                    }
                  />
                </label>
                <div className="portal-actions">
                  <button
                    className="portal-button"
                    disabled={
                      busy ||
                      !reference.trim() ||
                      Number(amount) < 10 ||
                      Number(amount) > 10000
                    }
                  >
                    {busy
                      ? zh
                        ? "處理中…"
                        : "Please wait…"
                      : zh
                        ? "提交驗證申請"
                        : "Submit verification request"}
                  </button>
                  <Link href="/console">
                    {zh ? "查詢閘道餘額" : "Check gateway balance"} ↗
                  </Link>
                  <Link href="mailto:info@powerchampion.org">
                    {zh ? "聯繫付款團隊" : "Contact payment support"} ↗
                  </Link>
                </div>
              </form>
            </section>
            <section className="portal-panel">
              <h2>{zh ? "申請紀錄" : "Request history"}</h2>
              {data.requests.length === 0 ? (
                <p className="portal-empty">
                  {zh
                    ? "尚未提交儲值驗證申請。"
                    : "No credit verification requests yet."}
                </p>
              ) : (
                <div className="portal-table-wrap">
                  <table className="portal-table">
                    <thead>
                      <tr>
                        <th>{zh ? "金額" : "Amount"}</th>
                        <th>{zh ? "付款參考編號" : "Reference"}</th>
                        <th>{zh ? "狀態" : "Status"}</th>
                        <th>{zh ? "申請日期" : "Submitted"}</th>
                        <th>{zh ? "審核日期" : "Reviewed"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.requests.map((item) => (
                        <tr key={item.id}>
                          <td>{money(item.amountUsd)}</td>
                          <td>{item.reference}</td>
                          <td>
                            <span className="portal-badge">
                              {statusText(item.status, zh)}
                            </span>
                          </td>
                          <td>{date(item.createdAt, zh)}</td>
                          <td>{date(item.reviewedAt, zh)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

      {revokeKey && (
        <dialog
          ref={dialog}
          className="portal-dialog"
          aria-labelledby="revoke-title"
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setRevokeKey(null);
          }}
        >
          <h2 id="revoke-title">
            {zh ? "撤銷 API 金鑰？" : "Revoke API key?"}
          </h2>
          <p>
            {zh
              ? `即將撤銷「${revokeKey.label}」（${revokeKey.prefix}…）。使用這把金鑰的應用程式將無法再傳送請求。`
              : `You are revoking “${revokeKey.label}” (${revokeKey.prefix}…). Applications using this key will no longer be able to send requests.`}
          </p>
          {mutationError !== null && (
            <p className="portal-error" role="alert">
              {portalErrorText(mutationError, locale)}
            </p>
          )}
          <div className="portal-actions">
            <button
              className="portal-button-secondary"
              disabled={busy}
              onClick={() => setRevokeKey(null)}
            >
              {zh ? "取消" : "Cancel"}
            </button>
            <button
              className="portal-button portal-button-danger"
              disabled={busy}
              onClick={revoke}
            >
              {busy
                ? zh
                  ? "處理中…"
                  : "Please wait…"
                : zh
                  ? "撤銷金鑰"
                  : "Revoke key"}
            </button>
          </div>
        </dialog>
      )}
    </main>
  );
}
