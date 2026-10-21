"use client";

import { useState } from "react";
import { PortalError, portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import { downloadText } from "./admin-resource";
import { useLocale } from "./locale-provider";

export type IssuedCode = { code: string; codeId: string; amountUsd: string };
export type IssuedBatch = { codes: IssuedCode[]; count: number; amountUsd: string; label: string; expiresDays: number | null };

// Same limits as the portal backend (server/admin_redeem.py).
const MAX_CODE_CENTS = 100000;
const MAX_BATCH = 500;
const MAX_EXPIRES_DAYS = 3650;
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

function cents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return amount > 0 && amount <= MAX_CODE_CENTS ? amount : null;
}

const money = (amountCents: number) =>
  `$${Math.floor(amountCents / 100).toLocaleString("en-US")}.${String(amountCents % 100).padStart(2, "0")}`;

type Step = "form" | "confirm";

export function GenerateCodesDialog({ onClose, onIssued }: { onClose: () => void; onIssued: (batch: IssuedBatch) => void }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState("");
  const [label, setLabel] = useState("");
  const [expires, setExpires] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unconfirmedLabel, setUnconfirmedLabel] = useState<string | null>(null);
  const [needsAcknowledgement, setNeedsAcknowledgement] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const amountCents = cents(amount);
  const countValue = /^\d{1,3}$/.test(count.trim()) ? Number(count) : NaN;
  const expiresValue = expires.trim() === "" ? null : /^\d{1,4}$/.test(expires.trim()) ? Number(expires) : NaN;

  function validate(): string | null {
    if (amountCents === null) return zh ? "每張面額須大於 0、最多 1,000 美元，最多兩位小數。" : "Each code must be above 0 and at most 1,000 USD, with at most two decimals.";
    if (!Number.isInteger(countValue) || countValue < 1 || countValue > MAX_BATCH) return zh ? "張數須為 1–500。" : "Generate from 1 to 500 codes.";
    if (!label.trim() || label.trim().length > 80 || UNSAFE.test(label)) return zh ? "請輸入 1–80 字的批次標籤。" : "Enter a batch label of 1 to 80 characters.";
    if (expiresValue !== null && (!Number.isInteger(expiresValue) || expiresValue < 1 || expiresValue > MAX_EXPIRES_DAYS))
      return zh ? "有效天數須為 1–3,650，或留空表示不過期。" : "Expiry must be 1 to 3,650 days, or empty for no expiry.";
    return null;
  }

  async function submit() {
    if (busy) return;
    if (step === "form") {
      const invalid = validate();
      setMessage(invalid);
      if (!invalid) setStep("confirm");
      return;
    }
    if (needsAcknowledgement && !acknowledged) {
      setMessage(zh ? "請先確認已檢查並停用該標籤的兌換碼。" : "Confirm that you checked and disabled the codes with this label first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setUnconfirmedLabel(null);
    try {
      const batch = await portalRequest<IssuedBatch>("/admin/redeem/codes", {
        method: "POST",
        body: JSON.stringify({
          amountUsd: (amountCents ?? 0) / 100,
          count: countValue,
          label: label.trim(),
          ...(expiresValue === null ? {} : { expiresDays: expiresValue }),
          ...(needsAcknowledgement && acknowledged ? { acknowledgeUnconfirmed: true } : {}),
        }),
      });
      onIssued(batch);
    } catch (reason: unknown) {
      if (reason instanceof PortalError && reason.code === "gateway_unavailable") setUnconfirmedLabel(label.trim());
      else if (reason instanceof PortalError && reason.code === "redeem_issue_unconfirmed_recent") setNeedsAcknowledgement(true);
      else setMessage(portalErrorText(reason, locale));
      setBusy(false);
    }
  }

  const total = amountCents !== null && Number.isInteger(countValue) ? amountCents * countValue : null;
  return (
    <AdminDialog
      title={zh ? "產生兌換碼" : "Generate redeem codes"}
      confirmLabel={step === "form" ? (zh ? "下一步" : "Next") : busy ? (zh ? "產生中…" : "Generating…") : zh ? "產生" : "Generate"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
      inFlight={busy}
    >
      {step === "form" ? (
        <>
          <label className="portal-field">
            {zh ? "每張面額（USD）" : "Amount per code (USD)"}
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="portal-field">
            {zh ? "張數" : "Number of codes"}
            <input inputMode="numeric" value={count} onChange={(event) => setCount(event.target.value)} />
          </label>
          <label className="portal-field">
            {zh ? "批次標籤" : "Batch label"}
            <input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label className="portal-field">
            {zh ? "有效天數（選填）" : "Valid for days (optional)"}
            <input inputMode="numeric" value={expires} onChange={(event) => setExpires(event.target.value)} />
          </label>
        </>
      ) : (
        <>
          <p role="status">
            {zh
              ? `將產生 ${countValue} 張、每張 ${money(amountCents ?? 0)}，合計 ${money(total ?? 0)}。`
              : `This will generate ${countValue} codes at ${money(amountCents ?? 0)} each, ${money(total ?? 0)} in total.`}
          </p>
          <p className="portal-note">
            {zh ? `標籤「${label.trim()}」` : `Label “${label.trim()}”`}
            {" · "}
            {expiresValue === null ? (zh ? "不過期" : "No expiry") : zh ? `${expiresValue} 天後到期` : `Expires after ${expiresValue} days`}
          </p>
          <button type="button" className="portal-text-button" disabled={busy} onClick={() => setStep("form")}>
            {zh ? "修改" : "Edit"}
          </button>
          {needsAcknowledgement && (
            <div className="portal-error" role="alert">
              <p>
                {zh
                  ? `最近一次以「${label.trim()}」產生兌換碼時閘道沒有確認結果。請先在清單中篩選這個標籤：那裡的兌換碼已建立但從未顯示過，請先停用，再重試。`
                  : `A recent issue with the label “${label.trim()}” was not confirmed by the gateway. Filter the list by this label first: any codes there were created but never shown, so disable them before retrying.`}
              </p>
              <label>
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />{" "}
                {zh ? "我已檢查並停用該標籤的兌換碼，仍要產生" : "I checked and disabled codes with this label; generate anyway"}
              </label>
            </div>
          )}
        </>
      )}
      {unconfirmedLabel !== null && (
        <p className="portal-error" role="alert">
          {zh
            ? `閘道沒有確認結果，可能已建立標籤為「${unconfirmedLabel}」的兌換碼（明文已無法取回）。請重新整理清單，停用該標籤的兌換碼後再產生。`
            : `The gateway did not confirm the result. Codes labelled “${unconfirmedLabel}” may have been created (their plaintext cannot be recovered). Refresh the list, disable the codes with that label, then generate again.`}
        </p>
      )}
      {message !== null && (
        <p className="portal-error" role="alert">{message}</p>
      )}
    </AdminDialog>
  );
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The only place plaintext codes are shown. They live in this component's props until "I have saved them". */
export function CodesOnceDialog({ batch, onClose }: { batch: IssuedBatch; onClose: () => void }) {
  const zh = useLocale().locale === "zh";
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(batch.codes.map((item) => item.code).join("\n"));
      setCopyMessage(zh ? "已複製全部兌換碼。" : "All codes copied.");
    } catch {
      setCopyMessage(zh ? "無法複製，請手動選取。" : "Could not copy. Select the codes manually.");
    }
  }
  function download() {
    const rows = [["code", "code_id", "amount_usd", "label"], ...batch.codes.map((item) => [item.code, item.codeId, item.amountUsd, batch.label])];
    // Built in the browser; the file never passes through a server.
    downloadText(`redeem_codes-${batch.label.replace(/[^A-Za-z0-9_-]+/g, "_") || "batch"}.csv`, rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n", "text/csv");
  }
  return (
    <AdminDialog
      title={zh ? "兌換碼只會顯示這一次" : "These codes are shown only once"}
      confirmLabel={zh ? "我已保存" : "I have saved them"}
      onConfirm={onClose}
      onClose={onClose}
      dismissible={false}
      extraActions={
        <>
          <button type="button" className="portal-button-secondary" onClick={copyAll}>
            {zh ? "複製全部" : "Copy all"}
          </button>
          <button type="button" className="portal-button-secondary" onClick={download}>
            {zh ? "下載 CSV（含明文）" : "Download CSV (includes plaintext)"}
          </button>
        </>
      }
    >
      <p className="portal-note">
        {zh
          ? "關閉後就無法再取得這些兌換碼的明文；入口網站與閘道都只保存雜湊。"
          : "After you close this, the plaintext cannot be shown again; the portal and the gateway keep only hashes."}
      </p>
      <div className="portal-table-wrap">
        <table className="portal-table">
          <caption className="sr-only">{zh ? "新產生的兌換碼" : "New redeem codes"}</caption>
          <thead>
            <tr>
              <th scope="col">{zh ? "兌換碼" : "Code"}</th>
              <th scope="col">Code ID</th>
              <th scope="col">{zh ? "面額" : "Amount"}</th>
            </tr>
          </thead>
          <tbody>
            {batch.codes.map((item) => (
              <tr key={item.codeId}>
                <td><code>{item.code}</code></td>
                <td><code>{item.codeId}</code></td>
                <td>{`$${item.amountUsd}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {copyMessage !== null && (
        <p className="portal-note" role="status">{copyMessage}</p>
      )}
    </AdminDialog>
  );
}

/** Disables one code, or every active code in a label (codeIds has several entries). */
export function ConfirmDisableDialog({
  codeIds,
  label,
  onClose,
  onDone,
}: {
  codeIds: string[];
  label: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    let failed = 0;
    let lastError: unknown = null;
    for (const codeId of codeIds) {
      try {
        await portalRequest(`/admin/redeem/codes/${encodeURIComponent(codeId)}/disable`, { method: "POST" });
      } catch (reason: unknown) {
        // Already disabled (404) means the goal holds; anything else is reported.
        if (!(reason instanceof PortalError && reason.code === "redeem_code_not_found")) {
          failed += 1;
          lastError = reason;
        }
      }
    }
    setBusy(false);
    if (failed) {
      setMessage(
        `${zh ? `有 ${failed} 張停用失敗：` : `${failed} could not be disabled: `}${portalErrorText(lastError, locale)}`,
      );
      return;
    }
    onDone();
  }
  const single = codeIds.length === 1 && label === null;
  return (
    <AdminDialog
      title={single ? (zh ? `停用兌換碼 ${codeIds[0]}？` : `Disable code ${codeIds[0]}?`) : zh ? `停用標籤「${label}」的 ${codeIds.length} 張兌換碼？` : `Disable ${codeIds.length} codes labelled “${label}”?`}
      confirmLabel={zh ? "停用" : "Disable"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={confirm}
      onClose={onClose}
      inFlight={busy}
      danger
    >
      <p>{zh ? "停用後就不能再兌換，也無法恢復。" : "Disabled codes can no longer be redeemed. This cannot be undone."}</p>
      {message !== null && (
        <p className="portal-error" role="alert">{message}</p>
      )}
    </AdminDialog>
  );
}
