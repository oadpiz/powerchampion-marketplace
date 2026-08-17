"use client";

import { useState } from "react";
import { openLaunchAccess } from "./demo-checkout";
import { useLocale } from "./locale-provider";

type ConsoleViewProps = {
  compact?: boolean;
  empty?: boolean;
};

type BalanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; plan: string; remaining: number | null }
  | { status: "error"; message: string };

export function ConsoleView({ compact = false }: ConsoleViewProps) {
  const { locale } = useLocale();
  const [apiKey, setApiKey] = useState("");
  const [balance, setBalance] = useState<BalanceState>({ status: "idle" });

  const text = locale === "en" ? {
    liveLabel: "Live — queries the gateway directly",
    title: "Check your balance",
    lead: "Paste your API key to look up remaining prepaid credit. The request goes to the b300 gateway and nowhere else.",
    placeholder: "sk-…",
    check: "Check balance",
    checking: "Checking…",
    plan: "Plan",
    remaining: "Remaining balance",
    postpaid: "Unlimited (postpaid)",
    invalidKey: "That key was not accepted. Check for typos — keys look like sk-… If you don't have one yet, request it by email.",
    networkError: "Could not reach the gateway. Try again.",
    requestKey: "Need a key?",
    redeemHint: "Top up with redeem codes: POST /v1/redeem",
  } : {
    liveLabel: "即時 — 直接查詢閘道",
    title: "查詢你的餘額",
    lead: "貼上你的 API Key 查詢預付餘額。請求只會送往 b300 閘道，不會傳到其他地方。",
    placeholder: "sk-…",
    check: "查詢餘額",
    checking: "查詢中…",
    plan: "方案",
    remaining: "剩餘餘額",
    postpaid: "無限（後付）",
    invalidKey: "此金鑰未被接受。請檢查是否輸入錯誤 — 金鑰格式為 sk-…。還沒有金鑰？可透過 email 申請。",
    networkError: "無法連上閘道，請再試一次。",
    requestKey: "需要 Key？",
    redeemHint: "使用 redeem code 儲值：POST /v1/redeem",
  };

  async function checkBalance(event: React.FormEvent) {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) return;
    setBalance({ status: "loading" });
    try {
      const response = await fetch("/api/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (response.status === 401 || response.status === 403) {
        setBalance({ status: "error", message: text.invalidKey });
        return;
      }
      if (!response.ok) {
        setBalance({ status: "error", message: text.networkError });
        return;
      }
      const data = await response.json();
      setBalance({
        status: "ok",
        plan: data.plan?.title ?? "prepaid",
        remaining: typeof data.plan?.remaining_usd === "number" ? data.plan.remaining_usd : null,
      });
    } catch {
      setBalance({ status: "error", message: text.networkError });
    }
  }

  const money = new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-Hant", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

  const Heading = compact ? "h3" : "h2";

  return (
    <div className={`console-view${compact ? " console-view-compact" : ""}`}>
      <div className="console-topline">
        <p><span className="status-dot status-dot-live" />{text.liveLabel}</p>
      </div>

      <div className="console-summary">
        <div className="balance-block">
          <Heading>{text.title}</Heading>
          <p className="balance-lead">{text.lead}</p>
          <form className="balance-form" onSubmit={checkBalance}>
            <input
              aria-label={text.placeholder}
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={text.placeholder}
              spellCheck={false}
              type="password"
              value={apiKey}
            />
            <button disabled={balance.status === "loading" || !apiKey.trim()} type="submit">
              {balance.status === "loading" ? text.checking : text.check}
            </button>
          </form>
          {balance.status === "ok" && (
            <dl className="balance-result" role="status">
              <div>
                <dt>{text.plan}</dt>
                <dd>{balance.plan === "postpaid" ? text.postpaid : balance.plan}</dd>
              </div>
              <div>
                <dt>{text.remaining}</dt>
                <dd>
                  {balance.remaining === null
                    ? text.postpaid
                    : <strong>{money.format(balance.remaining)}</strong>}
                </dd>
              </div>
            </dl>
          )}
          {balance.status === "error" && (
            <p className="balance-error" role="alert">{balance.message}</p>
          )}
          <p className="balance-hint">
            {text.redeemHint}
            {" · "}
            <button className="balance-request-link" onClick={() => openLaunchAccess()} type="button">{text.requestKey}</button>
          </p>
        </div>
      </div>
    </div>
  );
}
