"use client";

import { Fragment, useState } from "react";
import { GatewayNotConnected } from "./admin-keys-section";
import {
  ResourceState,
  dateLabel,
  ownerLabel,
  usdLabel,
  usePortalResource,
  type GatewayOwner,
} from "./admin-resource";
import { useLocale } from "./locale-provider";

type ModelUsage = {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
};
type KeyUsage = {
  gatewayKeyId: string;
  label: string;
  owner: GatewayOwner | null;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  byModel: ModelUsage[];
};
type UsageReport = {
  month: string;
  source: "gateway" | "unconfigured";
  totals: { requests: number; costUsd: string };
  amountStatus: string | null;
  unpricedModels: string[];
  keys: KeyUsage[];
  byCustomer: { owner: GatewayOwner | null; requests: number; costUsd: string }[];
  updatedAt: string | number | null;
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function UsageReportView({ month }: { month: string }) {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<UsageReport>(
    `/admin/usage?month=${encodeURIComponent(month)}`,
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const number = (value: number) =>
    value.toLocaleString(zh ? "zh-TW" : "en-US");
  const report = resource.data;
  return (
    <ResourceState {...resource}>
      {report && report.source === "unconfigured" ? (
        <GatewayNotConnected />
      ) : (
        report && (
          <>
            <div className="portal-grid">
              <div className="portal-panel portal-stat">
                <span>{zh ? "請求數" : "Requests"}</span>
                <strong>{number(report.totals.requests)}</strong>
              </div>
              <div className="portal-panel portal-stat">
                <span>{zh ? "費用（USD）" : "Cost (USD)"}</span>
                <strong>{usdLabel(report.totals.costUsd, 4)}</strong>
                <small>
                  {zh ? "更新於 " : "Updated "}
                  {dateLabel(report.updatedAt, zh)}
                </small>
              </div>
            </div>
            {report.amountStatus !== "confirmed" && (
              <p className="portal-note" role="status">
                {zh
                  ? `金額尚未確認（狀態：${report.amountStatus ?? "未提供"}），僅供估算。`
                  : `Amounts are not confirmed (status: ${report.amountStatus ?? "not provided"}); treat them as estimates.`}
              </p>
            )}
            {report.unpricedModels.length > 0 && (
              <p className="portal-note" role="status">
                {zh
                  ? `以下模型尚未定價，費用未計入：${report.unpricedModels.join("、")}`
                  : `These models have no price, so their cost is not included: ${report.unpricedModels.join(", ")}`}
              </p>
            )}
            <section className="portal-panel">
              <h2>{zh ? "依客戶" : "By customer"}</h2>
              {report.byCustomer.length > 0 ? (
                <div className="portal-table-wrap">
                  <table className="portal-table">
                    <caption className="sr-only">{zh ? "各客戶用量" : "Usage by customer"}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{zh ? "持有人" : "Owner"}</th>
                        <th scope="col">{zh ? "請求" : "Requests"}</th>
                        <th scope="col">{zh ? "費用" : "Cost"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byCustomer.map((row, index) => (
                        <tr key={row.owner?.id ?? `unowned-${index}`}>
                          <td>{ownerLabel(row.owner, zh)}</td>
                          <td>{number(row.requests)}</td>
                          <td>{usdLabel(row.costUsd, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="portal-empty">{zh ? "本月尚無用量。" : "No usage this month."}</p>
              )}
            </section>
            <section className="portal-panel">
              <h2>{zh ? "依金鑰" : "By key"}</h2>
              {report.keys.length > 0 ? (
                <div className="portal-table-wrap">
                  <table className="portal-table">
                    <caption className="sr-only">{zh ? "各金鑰用量" : "Usage by key"}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{zh ? "金鑰" : "Key"}</th>
                        <th scope="col">{zh ? "持有人" : "Owner"}</th>
                        <th scope="col">{zh ? "請求" : "Requests"}</th>
                        <th scope="col">{zh ? "輸入 token" : "Input tokens"}</th>
                        <th scope="col">{zh ? "輸出 token" : "Output tokens"}</th>
                        <th scope="col">{zh ? "費用" : "Cost"}</th>
                        <th scope="col">{zh ? "模型" : "Models"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.keys.map((row) => {
                        const open = expanded === row.gatewayKeyId;
                        return (
                          <Fragment key={row.gatewayKeyId}>
                            <tr>
                              <td>
                                {row.label}
                                <br />
                                <code>{row.gatewayKeyId}</code>
                              </td>
                              <td>{ownerLabel(row.owner, zh)}</td>
                              <td>{number(row.requests)}</td>
                              <td>{number(row.inputTokens)}</td>
                              <td>{number(row.outputTokens)}</td>
                              <td>{usdLabel(row.costUsd, 4)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="portal-text-button"
                                  aria-expanded={open}
                                  aria-label={zh ? `${row.label} 的模型明細` : `Models for ${row.label}`}
                                  onClick={() => setExpanded(open ? null : row.gatewayKeyId)}
                                >
                                  {open ? (zh ? "收合" : "Hide") : zh ? "展開" : "Show"} ({row.byModel.length})
                                </button>
                              </td>
                            </tr>
                            {open &&
                              row.byModel.map((model) => (
                                <tr key={`${row.gatewayKeyId}:${model.model}`}>
                                  <td colSpan={2}>
                                    <small>{zh ? "模型" : "Model"}</small> {model.model}
                                  </td>
                                  <td>{number(model.requests)}</td>
                                  <td>{number(model.inputTokens)}</td>
                                  <td>{number(model.outputTokens)}</td>
                                  <td>{usdLabel(model.costUsd, 4)}</td>
                                  <td />
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="portal-empty">{zh ? "本月尚無用量。" : "No usage this month."}</p>
              )}
            </section>
          </>
        )
      )}
    </ResourceState>
  );
}

export function AdminUsageSection() {
  const zh = useLocale().locale === "zh";
  const [month, setMonth] = useState(currentMonth);
  return (
    <>
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
      <UsageReportView key={month} month={month} />
    </>
  );
}
