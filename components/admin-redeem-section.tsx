"use client";

import { useState } from "react";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import { CodesOnceDialog, ConfirmDisableDialog, GenerateCodesDialog, type IssuedBatch } from "./admin-redeem-dialogs";
import { GatewayNotConnected, ResourceState, dateLabel, downloadText, usePortalResource, type GatewayOwner } from "./admin-resource";
import { useLocale } from "./locale-provider";

type CodeStatus = "active" | "redeemed" | "disabled" | "expired";
type RedeemCode = {
  codeId: string;
  amountUsd: string | null;
  label: string | null;
  createdAt: string | null;
  createdBy: string | null;
  redeemedAt: string | null;
  redeemedByKeyId: string | null;
  redeemedBy: GatewayOwner | null;
  disabledAt: string | null;
  expiresAt: string | null;
  status: CodeStatus;
};
type RedeemList = {
  gatewayConfigured: boolean;
  codes: RedeemCode[];
  total: number;
  counts: Record<CodeStatus, number>;
  truncated: boolean;
};

const STATUSES: CodeStatus[] = ["active", "redeemed", "disabled", "expired"];
const STATUS_LABEL: Record<CodeStatus, [string, string]> = {
  active: ["Active", "可用"],
  redeemed: ["Redeemed", "已兌換"],
  disabled: ["Disabled", "已停用"],
  expired: ["Expired", "已過期"],
};

export function AdminRedeemSection() {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const resource = usePortalResource<RedeemList>("/admin/redeem/codes");
  const [status, setStatus] = useState<CodeStatus | "all">("all");
  const [label, setLabel] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [batch, setBatch] = useState<IssuedBatch | null>(null);
  const [disable, setDisable] = useState<{ codeIds: string[]; label: string | null } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    setMessage(null);
    try {
      const exported = await portalRequest<{ filename: string; csv: string; rows: number }>("/admin/redeem/codes/export");
      downloadText(exported.filename || "redeem_codes.csv", exported.csv, "text/csv");
    } catch (reason: unknown) {
      setMessage(portalErrorText(reason, locale));
    } finally {
      setExporting(false);
    }
  }

  const data = resource.data;
  const labels = data ? [...new Set(data.codes.map((code) => code.label).filter((value): value is string => Boolean(value)))].sort() : [];
  const visible = (data?.codes ?? []).filter((code) => (status === "all" || code.status === status) && (label === "" || code.label === label));
  const activeInLabel = label === "" ? [] : (data?.codes ?? []).filter((code) => code.label === label && code.status === "active");
  return (
    <>
      <ResourceState {...resource}>
        {data && !data.gatewayConfigured ? (
          <GatewayNotConnected />
        ) : (
          data && (
            <>
              <div className="portal-grid">
                {STATUSES.map((name) => (
                  <div key={name} className="portal-panel portal-stat">
                    <span>{STATUS_LABEL[name][zh ? 1 : 0]}</span>
                    <strong>{(data.counts?.[name] ?? 0).toLocaleString(zh ? "zh-TW" : "en-US")}</strong>
                  </div>
                ))}
              </div>
              <section className="portal-panel">
                <div className="portal-actions">
                  <button type="button" className="portal-button" onClick={() => setGenerating(true)}>
                    {zh ? "產生兌換碼" : "Generate codes"}
                  </button>
                  <button type="button" className="portal-button-secondary" disabled={exporting} onClick={exportCsv}>
                    {zh ? "匯出 CSV" : "Export CSV"}
                  </button>
                  <button type="button" className="portal-button-secondary" onClick={resource.refresh}>
                    {zh ? "重新整理" : "Refresh"}
                  </button>
                </div>
                <p className="portal-note">{zh ? "匯出檔只含雜湊，不含兌換碼明文。" : "The export contains hashes only, never the plaintext codes."}</p>
                {message !== null && (
                  <p className="portal-error" role="alert">{message}</p>
                )}
                <div className="portal-actions">
                  <label className="portal-field">
                    {zh ? "狀態" : "Status"}
                    <select value={status} onChange={(event) => setStatus(event.target.value as CodeStatus | "all")}>
                      <option value="all">{zh ? "全部" : "All"}</option>
                      {STATUSES.map((name) => (
                        <option key={name} value={name}>{STATUS_LABEL[name][zh ? 1 : 0]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="portal-field">
                    {zh ? "批次標籤" : "Batch label"}
                    <select value={label} onChange={(event) => setLabel(event.target.value)}>
                      <option value="">{zh ? "全部標籤" : "All labels"}</option>
                      {labels.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  {activeInLabel.length > 0 && (
                    <button
                      type="button"
                      className="portal-button-secondary"
                      // Only the newest 1000 codes are loaded; a bulk action would silently miss older ones.
                      disabled={data.truncated}
                      onClick={() => setDisable({ codeIds: activeInLabel.map((code) => code.codeId), label })}
                    >
                      {zh ? `停用此標籤的 ${activeInLabel.length} 張可用兌換碼` : `Disable all ${activeInLabel.length} active codes with this label`}
                    </button>
                  )}
                </div>
                {activeInLabel.length > 0 && data.truncated && (
                  <p className="portal-note">
                    {zh
                      ? "清單只載入最新 1000 筆，批次停用可能漏掉較舊的兌換碼，因此暫停使用；請逐張停用，或用 CSV 匯出比對完整清單。"
                      : "Bulk disable is off while only the newest 1,000 codes are loaded, because it could miss older codes with this label. Disable codes one by one, or use the CSV export to check the full list."}
                  </p>
                )}
                {data.truncated && (
                  <p className="portal-note" role="status">
                    {zh
                      ? `只顯示最新 1000 筆，共 ${data.total.toLocaleString("zh-TW")} 筆；完整資料請用 CSV 匯出。`
                      : `Showing the newest 1,000 of ${data.total.toLocaleString("en-US")} codes; use the CSV export for all of them.`}
                  </p>
                )}
                {visible.length === 0 ? (
                  <p className="portal-empty">{zh ? "沒有符合條件的兌換碼。" : "No codes match."}</p>
                ) : (
                  <div className="portal-table-wrap">
                    <table className="portal-table">
                      <caption className="sr-only">{zh ? "兌換碼" : "Redeem codes"}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{zh ? "兌換碼 ID" : "Code ID"}</th>
                          <th scope="col">{zh ? "面額" : "Amount"}</th>
                          <th scope="col">{zh ? "標籤" : "Label"}</th>
                          <th scope="col">{zh ? "狀態" : "Status"}</th>
                          <th scope="col">{zh ? "建立時間" : "Created"}</th>
                          <th scope="col">{zh ? "建立者" : "Created by"}</th>
                          <th scope="col">{zh ? "兌換時間" : "Redeemed"}</th>
                          <th scope="col">{zh ? "兌換者" : "Redeemed by"}</th>
                          <th scope="col">{zh ? "到期" : "Expires"}</th>
                          <th scope="col">{zh ? "動作" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((code) => (
                          <tr key={code.codeId}>
                            <td><code>{code.codeId}</code></td>
                            <td>{code.amountUsd === null ? "—" : `$${code.amountUsd}`}</td>
                            <td>{code.label ?? "—"}</td>
                            <td>{STATUS_LABEL[code.status]?.[zh ? 1 : 0] ?? code.status}</td>
                            <td>{dateLabel(code.createdAt, zh)}</td>
                            <td>{code.createdBy ?? "—"}</td>
                            <td>{dateLabel(code.redeemedAt, zh)}</td>
                            <td>{code.redeemedBy?.email ?? code.redeemedByKeyId ?? "—"}</td>
                            <td>{code.expiresAt === null ? (zh ? "不過期" : "Never") : dateLabel(code.expiresAt, zh)}</td>
                            <td>
                              {code.status === "active" && (
                                <button type="button" className="portal-text-button" aria-label={zh ? `停用 ${code.codeId}` : `Disable ${code.codeId}`} onClick={() => setDisable({ codeIds: [code.codeId], label: null })}>
                                  {zh ? "停用" : "Disable"}
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
          )
        )}
      </ResourceState>
      {generating && (
        <GenerateCodesDialog
          onClose={() => setGenerating(false)}
          onIssued={(issued) => {
            setGenerating(false);
            setBatch(issued);
            resource.refresh();
          }}
        />
      )}
      {batch !== null && <CodesOnceDialog batch={batch} onClose={() => setBatch(null)} />}
      {disable !== null && (
        <ConfirmDisableDialog
          codeIds={disable.codeIds}
          label={disable.label}
          onClose={() => setDisable(null)}
          onDone={() => {
            setDisable(null);
            resource.refresh();
          }}
          onPartial={resource.refresh}
        />
      )}
    </>
  );
}
