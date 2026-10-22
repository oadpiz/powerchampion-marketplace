"use client";

import { useState, type FormEvent } from "react";
import { portalRequest } from "../lib/portal-client";
import { newIdempotencyKey, planLabel } from "../lib/studio-client";
import { AdminDialog } from "./admin-dialog";
import { ResourceState, errorMessage, usdLabel, usePortalResource } from "./admin-resource";
import { useLocale } from "./locale-provider";

type Customer = { id: string; email: string; name: string; role: string; status: string };
type GrantResult = { account: { user_id: string; balance: number; reserved: number; plan: string | null; period_end: number | null } };
type UsageRow = {
  user_id: string;
  email: string | null;
  name: string | null;
  ops: number;
  active_ops: number;
  credits_granted: number;
  credits_charged: number;
  credits_refunded: number;
  agent_ops: number | null;
  credits_quoted: number | null;
  credits_produced: number | null;
  list_cost_usd: number | null;
  gpu_seconds: number | null;
  est_gpu_usd: number | null;
};
type Usage = { month: string; agent_status: string; gpu_usd_per_hour: number | null; users: UsageRow[]; note?: string };

const PLANS = ["creator", "merchant", "agency"] as const;

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function GrantPanel() {
  const zh = useLocale().locale === "zh";
  const customers = usePortalResource<{ customers: Customer[] }>("/admin/customers");
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [plan, setPlan] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [check, setCheck] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // One key per filled-in grant: a retry after a lost response is applied once (server-side dedupe).
  const [requestKey, setRequestKey] = useState(newIdempotencyKey);
  const credits = Number(amount);
  const who = customers.data?.customers.find((item) => item.id === userId)?.email ?? userId;
  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setRequestKey(newIdempotencyKey());
    setDone(null);
  };

  function review(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!userId || !Number.isInteger(credits) || credits === 0 || Math.abs(credits) > 1_000_000) {
      setCheck(zh ? "請選擇帳號，並輸入不為 0 的整數點數（上限 1,000,000；負數為扣除）。" : "Choose an account and a non-zero whole number of credits (up to 1,000,000; negative removes).");
      return;
    }
    setCheck(null);
    setError(null);
    setConfirming(true);
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const body: Record<string, unknown> = { user_id: userId, credits, idempotency_key: requestKey };
      if (plan) body.plan = plan;
      if (periodEnd) body.period_end = Math.floor(new Date(`${periodEnd}T23:59:59`).getTime() / 1000);
      if (note.trim()) body.note = note.trim();
      const result = await portalRequest<GrantResult>("/admin/studio/credits/grant", { method: "POST", body: JSON.stringify(body) });
      setConfirming(false);
      setRequestKey(newIdempotencyKey());
      setDone(
        zh
          ? `已${credits > 0 ? "發放" : "扣除"} ${Math.abs(credits).toLocaleString()} 點給 ${who}。目前可用 ${result.account.balance.toLocaleString()} 點，方案 ${planLabel(result.account.plan, "zh")}。`
          : `${credits > 0 ? "Granted" : "Removed"} ${Math.abs(credits).toLocaleString()} credits for ${who}. Available now: ${result.account.balance.toLocaleString()}, plan ${planLabel(result.account.plan, "en")}.`,
      );
      setAmount("");
      setNote("");
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="portal-panel">
      <h2>{zh ? "發放點數" : "Grant credits"}</h2>
      <p className="portal-muted">
        {zh
          ? "影片工作室點數與 API 金鑰餘額分開計算。每次發放都會寫入操作紀錄；輸入負數可扣除尚未使用的點數。"
          : "Studio credits are separate from API key balances. Every grant is audited; a negative number removes unused credits."}
      </p>
      <ResourceState {...customers}>
        <form className="portal-form studio-grant-form" onSubmit={review} noValidate>
          <label className="portal-field">
            {zh ? "帳號" : "Account"}
            <select value={userId} onChange={(event) => change(setUserId)(event.target.value)} disabled={busy}>
              <option value="">{zh ? "請選擇帳號" : "Choose an account"}</option>
              {customers.data?.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.email}
                  {customer.name ? ` (${customer.name})` : ""}
                  {customer.status === "disabled" ? (zh ? "（已停用）" : " (disabled)") : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-field">
            {zh ? "點數" : "Credits"}
            <input type="number" inputMode="numeric" step={1} value={amount} onChange={(event) => change(setAmount)(event.target.value)} disabled={busy} placeholder="1000" />
          </label>
          <label className="portal-field">
            {zh ? "方案（選填）" : "Plan (optional)"}
            <select value={plan} onChange={(event) => change(setPlan)(event.target.value)} disabled={busy}>
              <option value="">{zh ? "不變更" : "Keep current"}</option>
              {PLANS.map((item) => (
                <option key={item} value={item}>
                  {planLabel(item, zh ? "zh" : "en")}
                </option>
              ))}
            </select>
          </label>
          <label className="portal-field">
            {zh ? "方案到期日（選填）" : "Plan period end (optional)"}
            <input type="date" value={periodEnd} onChange={(event) => change(setPeriodEnd)(event.target.value)} disabled={busy} />
          </label>
          <label className="portal-field studio-span">
            {zh ? "備註（選填，例如匯款編號）" : "Note (optional, e.g. a payment reference)"}
            <input type="text" maxLength={200} value={note} onChange={(event) => change(setNote)(event.target.value)} disabled={busy} />
          </label>
          {check && (
            <p className="portal-error studio-span" role="alert">
              {check}
            </p>
          )}
          {error !== null && !confirming && (
            <p className="portal-error studio-span" role="alert">
              {errorMessage(error, zh)}
            </p>
          )}
          {done && (
            <p className="portal-note studio-span" role="status">
              {done}
            </p>
          )}
          <div className="portal-actions studio-span">
            <button className="portal-button" type="submit" disabled={busy}>
              {busy ? (zh ? "處理中…" : "Working…") : zh ? "確認發放" : "Grant"}
            </button>
          </div>
        </form>
      </ResourceState>
      {confirming && (
        <AdminDialog
          title={zh ? "確認發放點數" : "Confirm credit grant"}
          confirmLabel={
            busy
              ? zh
                ? "處理中…"
                : "Working…"
              : credits > 0
                ? zh
                  ? `發放 ${credits.toLocaleString()} 點`
                  : `Grant ${credits.toLocaleString()} credits`
                : zh
                  ? `扣除 ${Math.abs(credits).toLocaleString()} 點`
                  : `Remove ${Math.abs(credits).toLocaleString()} credits`
          }
          cancelLabel={zh ? "取消" : "Cancel"}
          danger={credits < 0}
          inFlight={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void submit()}
        >
          <dl className="portal-meta">
            <dt>{zh ? "帳號" : "Account"}</dt>
            <dd>{who}</dd>
            <dt>{zh ? "點數" : "Credits"}</dt>
            <dd>{credits > 0 ? `+${credits.toLocaleString()}` : credits.toLocaleString()}</dd>
            {plan && (
              <>
                <dt>{zh ? "方案" : "Plan"}</dt>
                <dd>{planLabel(plan, zh ? "zh" : "en")}</dd>
              </>
            )}
            {periodEnd && (
              <>
                <dt>{zh ? "到期日" : "Period end"}</dt>
                <dd>{periodEnd}</dd>
              </>
            )}
            {note.trim() && (
              <>
                <dt>{zh ? "備註" : "Note"}</dt>
                <dd>{note.trim()}</dd>
              </>
            )}
          </dl>
          <p className="portal-muted">
            {zh ? "送出後會寫入操作紀錄；重複送出同一筆不會重複發放。" : "This is audited. Sending the same grant again does not apply it twice."}
          </p>
          {error !== null && (
            <p className="portal-error" role="alert">
              {errorMessage(error, zh)}
            </p>
          )}
        </AdminDialog>
      )}
    </section>
  );
}

function UsagePanel({ month }: { month: string }) {
  const zh = useLocale().locale === "zh";
  const usage = usePortalResource<Usage>(`/admin/studio/usage?month=${encodeURIComponent(month)}`);
  const number = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value.toLocaleString(zh ? "zh-TW" : "en-US"));
  const data = usage.data;
  return (
    <ResourceState {...usage}>
      {data && (
        <section className="portal-panel">
          <h2>{zh ? "使用量" : "Usage"}</h2>
          {data.agent_status !== "ok" && (
            <p className="portal-note" role="status">
              {zh
                ? `影片服務的成本資料暫時無法取得（${data.agent_status}），下表只有入口網站的點數紀錄。`
                : `Cost data from the video service is unavailable (${data.agent_status}); the table shows the portal's credit records only.`}
            </p>
          )}
          <p className="portal-hint">
            {zh
              ? `GPU 成本為估算：GPU 秒數 × 每小時 ${usdLabel(data.gpu_usd_per_hour, 2)}，在閘道以 GPU 成本計費（D-V8）之前僅供參考。牌價成本為閘道公開價格。`
              : `GPU cost is an estimate: GPU seconds × ${usdLabel(data.gpu_usd_per_hour, 2)} per hour, until the gateway bills at GPU cost (D-V8). List cost uses the gateway's published prices.`}
          </p>
          {data.users.length === 0 ? (
            <p className="portal-empty">{zh ? "本月尚無影片工作室用量。" : "No studio usage this month."}</p>
          ) : (
            <div className="portal-table-wrap">
              <table className="portal-table">
                <caption className="sr-only">{zh ? "各帳號影片工作室用量" : "Studio usage per account"}</caption>
                <thead>
                  <tr>
                    <th scope="col">{zh ? "帳號" : "Account"}</th>
                    <th scope="col">{zh ? "步驟" : "Steps"}</th>
                    <th scope="col">{zh ? "發放" : "Granted"}</th>
                    <th scope="col">{zh ? "實扣點數" : "Charged"}</th>
                    <th scope="col">{zh ? "退還" : "Refunded"}</th>
                    <th scope="col">{zh ? "牌價成本" : "List cost"}</th>
                    <th scope="col">{zh ? "GPU 秒數" : "GPU seconds"}</th>
                    <th scope="col">{zh ? "估算 GPU 成本" : "Est. GPU cost"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((row) => (
                    <tr key={row.user_id}>
                      <td>
                        {row.email ?? row.user_id}
                        {row.name && (
                          <>
                            <br />
                            <small className="portal-muted">{row.name}</small>
                          </>
                        )}
                      </td>
                      <td>
                        {number(row.ops)}
                        {row.active_ops > 0 && <small className="portal-muted">{zh ? `（${row.active_ops} 進行中）` : ` (${row.active_ops} active)`}</small>}
                      </td>
                      <td>{number(row.credits_granted)}</td>
                      <td>{number(row.credits_charged)}</td>
                      <td>{number(row.credits_refunded)}</td>
                      <td>{usdLabel(row.list_cost_usd, 4)}</td>
                      <td>{number(row.gpu_seconds)}</td>
                      <td>{usdLabel(row.est_gpu_usd, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </ResourceState>
  );
}

/** Admin: the video studio's credit grants and per-account usage (credits vs list cost vs estimated GPU cost). */
export function AdminStudioSection() {
  const zh = useLocale().locale === "zh";
  const [month, setMonth] = useState(currentMonth);
  return (
    <>
      <GrantPanel />
      <section className="portal-panel">
        <label className="portal-field portal-month-field">
          {zh ? "月份" : "Month"}
          <input
            type="month"
            value={month}
            onChange={(event) => {
              if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value);
            }}
          />
        </label>
      </section>
      <UsagePanel key={month} month={month} />
    </>
  );
}
