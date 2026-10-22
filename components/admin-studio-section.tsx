"use client";

import { useState, type FormEvent } from "react";
import { portalRequest } from "../lib/portal-client";
import { newIdempotencyKey, planLabel } from "../lib/studio-client";
import { AdminDialog } from "./admin-dialog";
import { reportCsv, taipeiDate, taipeiMonth, type StudioReport } from "../lib/studio-report";
import { ResourceState, downloadText, errorMessage, usdLabel, usePortalResource } from "./admin-resource";
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

function MonthField({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const zh = useLocale().locale === "zh";
  return (
    <label className="portal-field portal-month-field">
      {zh ? "月份" : "Month"}
      <input
        type="month"
        value={month}
        onChange={(event) => {
          if (/^\d{4}-\d{2}$/.test(event.target.value)) onChange(event.target.value);
        }}
      />
    </label>
  );
}

/** The monthly credits report the owner issues invoices from (Asia/Taipei months, from the credit ledger). */
function ReportPanel({ month }: { month: string }) {
  const zh = useLocale().locale === "zh";
  const report = usePortalResource<StudioReport>(`/admin/studio/report?month=${encodeURIComponent(month)}`);
  const number = (value: number) => value.toLocaleString(zh ? "zh-TW" : "en-US");
  const data = report.data;
  return (
    <ResourceState {...report}>
      {data && (
        <section className="portal-panel">
          <h2>{zh ? `${data.month} 點數月報` : `Credits report, ${data.month}`}</h2>
          <p className="portal-hint">
            {zh
              ? "1 點 = NT$1 牌價。方案：Creator 1,000 點 NT$990、Merchant 4,000 點 NT$2,990、Agency 15,000 點 NT$9,900。可依方案或依本月消耗開立發票。"
              : "1 credit = NT$1 list value. Plans: Creator 1,000 credits for NT$990, Merchant 4,000 for NT$2,990, Agency 15,000 for NT$9,900. Invoice by plan or by consumption."}
          </p>
          <p className="portal-muted">
            {zh
              ? "月份以台北時間計。消耗＝已結算扣點減退點，算在結算當月（月底送出、次月完成的步驟算次月）。餘額含保留中的點數。期初 + 發放 − 消耗 − 到期扣除 = 期末。方案為目前方案。"
              : "Months are Asia/Taipei. Consumed = settled charges net of refunds, counted in the month a step settled (a step reserved on the 31st and settled on the 1st counts in the new month). Balances include reserved credits. Opening + granted − consumed − expired = closing. Plan is the current plan."}
          </p>
          <div className="portal-actions">
            <button
              className="portal-button"
              type="button"
              disabled={data.users.length === 0}
              onClick={() => downloadText(`studio-credits-${data.month}.csv`, reportCsv(data), "text/csv;charset=utf-8")}
            >
              {zh ? "下載 CSV" : "Download CSV"}
            </button>
          </div>
          {data.users.length === 0 ? (
            <p className="portal-empty">{zh ? "這個月份沒有點數紀錄。" : "No credit activity or balances this month."}</p>
          ) : (
            <div className="portal-table-wrap">
              <table className="portal-table">
                <caption className="sr-only">{zh ? "各帳號點數月報" : "Monthly credits per account"}</caption>
                <thead>
                  <tr>
                    <th scope="col">{zh ? "帳號" : "Account"}</th>
                    <th scope="col">{zh ? "方案" : "Plan"}</th>
                    <th scope="col">{zh ? "期初餘額" : "Opening"}</th>
                    <th scope="col">{zh ? "本月發放" : "Granted"}</th>
                    <th scope="col">{zh ? "本月消耗" : "Consumed"}</th>
                    <th scope="col">{zh ? "到期扣除" : "Expired"}</th>
                    <th scope="col">{zh ? "期末餘額" : "Closing"}</th>
                    <th scope="col">{zh ? "匯出影片" : "Videos exported"}</th>
                    <th scope="col">{zh ? "步驟數" : "Steps"}</th>
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
                      <td>{planLabel(row.plan, zh ? "zh" : "en")}</td>
                      <td>{number(row.opening_balance)}</td>
                      <td>
                        {number(row.credits_granted)}
                        {row.grants.map((grant, index) => (
                          <small className="portal-muted studio-report-grant" key={index}>
                            <br />
                            {taipeiDate(grant.created_at)} +{number(grant.credits)}
                            {grant.note ? ` ${grant.note}` : ""}
                          </small>
                        ))}
                      </td>
                      <td>{number(row.credits_consumed)}</td>
                      <td>{number(row.credits_expired)}</td>
                      <td>
                        {number(row.closing_balance)}
                        {row.reserved_at_close > 0 && (
                          <small className="portal-muted">{zh ? `（其中 ${number(row.reserved_at_close)} 保留中）` : ` (${number(row.reserved_at_close)} reserved)`}</small>
                        )}
                      </td>
                      <td>{number(row.videos_exported)}</td>
                      <td>{number(row.ops)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{zh ? "合計" : "Total"}</th>
                    <td />
                    <td>{number(data.totals.opening_balance)}</td>
                    <td>{number(data.totals.credits_granted)}</td>
                    <td>{number(data.totals.credits_consumed)}</td>
                    <td>{number(data.totals.credits_expired)}</td>
                    <td>{number(data.totals.closing_balance)}</td>
                    <td>{number(data.totals.videos_exported)}</td>
                    <td>{number(data.totals.ops)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}
    </ResourceState>
  );
}

const TABS = ["usage", "report"] as const;

/** Admin: the video studio's credit grants, per-account usage (credits vs list cost vs estimated GPU cost) and the monthly invoicing report. */
export function AdminStudioSection() {
  const zh = useLocale().locale === "zh";
  const [tab, setTab] = useState<(typeof TABS)[number]>("usage");
  const [month, setMonth] = useState(currentMonth);
  const [reportMonth, setReportMonth] = useState(() => taipeiMonth());
  const label = (item: (typeof TABS)[number]) => (item === "usage" ? (zh ? "使用量" : "Usage") : zh ? "月報（開發票用）" : "Monthly report (for invoices)");
  return (
    <>
      <GrantPanel />
      <div className="portal-tabs" role="tablist" aria-label={zh ? "影片工作室報表" : "Studio reports"}>
        {TABS.map((item, index) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`studio-admin-tab-${item}`}
            aria-controls={`studio-admin-panel-${item}`}
            aria-selected={tab === item}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? "portal-button" : "portal-button-secondary"}
            onClick={() => setTab(item)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
              setTab(next);
              document.getElementById(`studio-admin-tab-${next}`)?.focus();
            }}
          >
            {label(item)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`studio-admin-panel-${tab}`} aria-labelledby={`studio-admin-tab-${tab}`}>
        {tab === "usage" ? (
          <>
            <section className="portal-panel">
              <MonthField month={month} onChange={setMonth} />
            </section>
            <UsagePanel key={month} month={month} />
          </>
        ) : (
          <>
            <section className="portal-panel">
              <MonthField month={reportMonth} onChange={setReportMonth} />
            </section>
            <ReportPanel key={reportMonth} month={reportMonth} />
          </>
        )}
      </div>
    </>
  );
}
