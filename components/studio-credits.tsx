"use client";

import Link from "next/link";
import { ledgerKindLabel, ledgerNote, planLabel, signedCredits, studioErrorText, timeLabel } from "../lib/studio-client";
import { useLocale } from "./locale-provider";
import { useStudio } from "./studio-shell";

const PLAN_CREDITS: Record<string, number> = { creator: 1000, merchant: 4000, agency: 15000 };

/** /studio/credits: balance, reserved credits, plan and the last 50 ledger rows. */
export function StudioCreditsPage() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const { credits, creditsError, refreshCredits } = useStudio();

  return (
    <>
      <header className="portal-header studio-header">
        <div>
          <p className="portal-kicker">CREDITS</p>
          <h1>{zh ? "點數" : "Credits"}</h1>
          <p>
            {zh
              ? "1 點約等於 NT$1。每個步驟先預留點數，完成後依實際產出結算，沒產生的部分自動退還。"
              : "1 credit is about NT$1. Each step reserves credits first and settles on what was produced; the rest is refunded automatically."}
          </p>
        </div>
      </header>
      {creditsError !== null && !credits && (
        <div className="portal-panel">
          <p className="portal-error" role="alert">
            {studioErrorText(creditsError, locale)}
          </p>
          <button className="portal-button-secondary" type="button" onClick={refreshCredits}>
            {zh ? "重新載入" : "Try again"}
          </button>
        </div>
      )}
      {!credits && creditsError === null && (
        <p className="portal-empty" role="status">
          {zh ? "正在載入點數…" : "Loading credits…"}
        </p>
      )}
      {credits && (
        <>
          <div className="portal-grid studio-credit-grid">
            <div className="portal-panel portal-stat">
              <span>{zh ? "可用點數" : "Available"}</span>
              <strong data-testid="credits-balance">{credits.balance.toLocaleString()}</strong>
              <small>{zh ? "可以立即使用" : "Ready to use"}</small>
            </div>
            <div className="portal-panel portal-stat">
              <span>{zh ? "預留中" : "Reserved"}</span>
              <strong>{credits.reserved.toLocaleString()}</strong>
              <small>{zh ? "進行中的步驟，完成後結算" : "Held by steps in progress"}</small>
            </div>
            <div className="portal-panel portal-stat">
              <span>{zh ? "方案" : "Plan"}</span>
              <strong className="studio-plan">{planLabel(credits.plan, locale)}</strong>
              <small>
                {credits.plan && PLAN_CREDITS[credits.plan]
                  ? zh
                    ? `每月 ${PLAN_CREDITS[credits.plan].toLocaleString()} 點`
                    : `${PLAN_CREDITS[credits.plan].toLocaleString()} credits a month`
                  : zh
                    ? "由管理員開通"
                    : "Set up by our team"}
                {credits.period_end ? (zh ? `・至 ${timeLabel(credits.period_end, locale)}` : ` · until ${timeLabel(credits.period_end, locale)}`) : ""}
              </small>
            </div>
          </div>
          <p className="portal-hint studio-credit-hint">
            {zh
              ? "目前不提供線上付款，點數由團隊人工加值。需要加值或更換方案，請"
              : "Online payment is not available yet; credits are added by our team. To top up or change plans, "}
            <Link href="/contact">{zh ? "聯絡我們" : "contact us"}</Link>
            {zh
              ? "。參考：Creator 方案 1,000 點約 20 支（以每支 3 鏡動態影片、約 46 點計）。"
              : ". For reference, Creator's 1,000 credits make about 20 videos (at 3 motion shots, about 46 credits, each)."}
          </p>
          <section className="portal-panel">
            <div className="portal-panel-heading">
              <h2>{zh ? "最近 50 筆紀錄" : "Last 50 entries"}</h2>
            </div>
            {credits.recent.length === 0 ? (
              <p className="portal-empty">{zh ? "還沒有任何點數紀錄。" : "No credit activity yet."}</p>
            ) : (
              <div className="portal-table-wrap">
                <table className="portal-table studio-ledger">
                  <caption className="sr-only">{zh ? "點數紀錄" : "Credit ledger"}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{zh ? "時間" : "Time"}</th>
                      <th scope="col">{zh ? "類型" : "Type"}</th>
                      <th scope="col">{zh ? "說明" : "Details"}</th>
                      <th scope="col" className="studio-num">
                        {zh ? "點數" : "Credits"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {credits.recent.map((row) => (
                      <tr key={row.id}>
                        <td>{timeLabel(row.created_at, locale)}</td>
                        <td>
                          <span className={`studio-ledger-kind studio-ledger-${row.kind}`}>{ledgerKindLabel(row.kind, locale)}</span>
                        </td>
                        <td>{ledgerNote(row, locale) || "—"}</td>
                        <td className={`studio-num ${row.delta > 0 ? "studio-plus" : row.delta < 0 ? "studio-minus" : ""}`}>{signedCredits(row.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
