"use client";

import { useState } from "react";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import {
  usdLabel,
  usePortalResource,
  type GatewayOwner,
} from "./admin-resource";
import { useLocale } from "./locale-provider";

export type GatewayKey = {
  gatewayKeyId: string;
  prefix: string;
  label: string;
  dailyTokenLimit: number;
  rpm: number;
  maxInflight: number;
  balanceUsd: string | null;
  createdAt: string | number | null;
  expiresAt: string | number | null;
  disabledAt: string | number | null;
  lastUsedAt: string | number | null;
  modelIds: string[];
  owner: GatewayOwner | null;
  portalKeyId: string | null;
  portalStatus: "active" | "revoked" | null;
};
type CustomerOption = {
  id: string;
  email: string;
  name: string;
  role: "customer" | "admin";
  status: "active" | "disabled";
};
export type IssuedKey = { secret: string; label: string; prefix: string };

function parseOptionalCount(value: string): number | undefined | null {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

const MAX_USD = 100000;

/** Matches the server rule: above 0, at most 100,000, at most two decimals. */
function parseUsd(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value);
  return amount > 0 && amount <= MAX_USD ? amount : null;
}

export function ErrorLine({ message }: { message: string | null }) {
  return message === null ? null : (
    <p className="portal-error" role="alert">
      {message}
    </p>
  );
}
export function IssueKeyDialog({
  onClose,
  onIssued,
}: {
  onClose: () => void;
  onIssued: (issued: IssuedKey) => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const customers = usePortalResource<{ customers: CustomerOption[] }>(
    "/admin/customers",
  );
  const [userId, setUserId] = useState("");
  const [label, setLabel] = useState("");
  const [prepaid, setPrepaid] = useState("");
  const [daily, setDaily] = useState("");
  const [rpm, setRpm] = useState("");
  const [inflight, setInflight] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = (customers.data?.customers ?? []).filter(
    (customer) => customer.status === "active" && customer.role === "customer",
  );

  async function submit() {
    const prepaidUsd = parseUsd(prepaid);
    const limits = [parseOptionalCount(daily), parseOptionalCount(rpm), parseOptionalCount(inflight)];
    if (!userId || !label.trim() || prepaidUsd === null || limits.includes(null)) {
      setMessage(
        zh
          ? "請選擇客戶、填寫標籤；預付金額須大於 0、最多 100,000 且最多兩位小數；限額須為 0 以上的整數。"
          : "Pick a customer and enter a label. The prepaid amount must be above 0, at most 100,000, with at most two decimals; limits must be whole numbers from 0.",
      );
      return;
    }
    const [dailyTokenLimit, rpmLimit, maxInflight] = limits as (number | undefined)[];
    setBusy(true);
    setMessage(null);
    try {
      const result = await portalRequest<{
        key: { label: string; prefix: string };
        secret: string;
      }>(`/admin/customers/${encodeURIComponent(userId)}/keys`, {
        method: "POST",
        body: JSON.stringify({
          label: label.trim(),
          prepaidUsd,
          ...(dailyTokenLimit !== undefined && { dailyTokenLimit }),
          ...(rpmLimit !== undefined && { rpm: rpmLimit }),
          ...(maxInflight !== undefined && { maxInflight }),
        }),
      });
      onIssued({ secret: result.secret, label: result.key.label, prefix: result.key.prefix });
    } catch (reason: unknown) {
      setMessage(portalErrorText(reason, locale));
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      title={zh ? "為客戶簽發金鑰" : "Issue a key for a customer"}
      confirmLabel={zh ? "簽發金鑰" : "Issue key"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
      inFlight={busy}
    >
      <label className="portal-field">
        {zh ? "客戶" : "Customer"}
        <select
          value={userId}
          disabled={busy || customers.loading}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value="">{customers.loading ? (zh ? "載入中…" : "Loading…") : zh ? "選擇客戶" : "Select a customer"}</option>
          {active.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name ? `${customer.name} (${customer.email})` : customer.email}
            </option>
          ))}
        </select>
      </label>
      <label className="portal-field">
        {zh ? "標籤" : "Label"}
        <input maxLength={80} value={label} disabled={busy} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "預付金額（USD）" : "Prepaid amount (USD)"}
        <input type="number" min="0.01" max="100000" step="0.01" value={prepaid} disabled={busy} onChange={(event) => setPrepaid(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "每日 token 上限（選填，0 = 不限）" : "Daily token limit (optional, 0 = unlimited)"}
        <input type="number" min="0" step="1" value={daily} disabled={busy} onChange={(event) => setDaily(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "每分鐘請求數（選填）" : "Requests per minute (optional)"}
        <input type="number" min="0" step="1" value={rpm} disabled={busy} onChange={(event) => setRpm(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "同時處理數上限（選填）" : "Max in-flight requests (optional)"}
        <input type="number" min="0" step="1" value={inflight} disabled={busy} onChange={(event) => setInflight(event.target.value)} />
      </label>
      <ErrorLine message={customers.error ? portalErrorText(customers.error, locale) : message} />
    </AdminDialog>
  );
}

export function LimitsDialog({
  target,
  onClose,
  onDone,
}: {
  target: GatewayKey;
  onClose: () => void;
  onDone: () => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [daily, setDaily] = useState(String(target.dailyTokenLimit));
  const [rpm, setRpm] = useState(String(target.rpm));
  const [inflight, setInflight] = useState(String(target.maxInflight));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    const values = [daily, rpm, inflight].map(parseOptionalCount);
    if (values.some((value) => value === null || value === undefined)) {
      setMessage(zh ? "限額須為 0 以上的整數。" : "Limits must be whole numbers from 0.");
      return;
    }
    const [dailyTokenLimit, rpmLimit, maxInflight] = values as number[];
    setBusy(true);
    setMessage(null);
    try {
      await portalRequest(`/admin/keys/${encodeURIComponent(target.gatewayKeyId)}/limits`, {
        method: "POST",
        body: JSON.stringify({ dailyTokenLimit, rpm: rpmLimit, maxInflight }),
      });
      onDone();
    } catch (reason: unknown) {
      setMessage(portalErrorText(reason, locale));
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      title={zh ? `調整限額：${target.label}` : `Adjust limits: ${target.label}`}
      confirmLabel={zh ? "儲存" : "Save"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
      inFlight={busy}
    >
      <p className="portal-hint">{zh ? "0 代表不限。" : "0 means unlimited."}</p>
      <label className="portal-field">
        {zh ? "每日 token 上限" : "Daily token limit"}
        <input type="number" min="0" step="1" value={daily} disabled={busy} onChange={(event) => setDaily(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "每分鐘請求數" : "Requests per minute"}
        <input type="number" min="0" step="1" value={rpm} disabled={busy} onChange={(event) => setRpm(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "同時處理數上限" : "Max in-flight requests"}
        <input type="number" min="0" step="1" value={inflight} disabled={busy} onChange={(event) => setInflight(event.target.value)} />
      </label>
      <ErrorLine message={message} />
    </AdminDialog>
  );
}

export function TopUpDialog({
  target,
  onClose,
  onDone,
}: {
  target: GatewayKey;
  onClose: () => void;
  onDone: () => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    const addUsd = parseUsd(amount);
    if (addUsd === null) {
      setMessage(
        zh
          ? "金額須大於 0、最多 100,000 且最多兩位小數。"
          : "Enter an amount above 0, at most 100,000, with at most two decimals.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await portalRequest(`/admin/keys/${encodeURIComponent(target.gatewayKeyId)}/balance`, {
        method: "POST",
        body: JSON.stringify({ addUsd }),
      });
      onDone();
    } catch (reason: unknown) {
      setMessage(portalErrorText(reason, locale));
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      title={zh ? `為金鑰加值：${target.label}` : `Top up key: ${target.label}`}
      confirmLabel={zh ? "加值" : "Add balance"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
      inFlight={busy}
    >
      <p className="portal-hint">
        {zh ? "目前餘額：" : "Current balance: "}
        {usdLabel(target.balanceUsd, 2)}
      </p>
      <label className="portal-field">
        {zh ? "金額（USD）" : "Amount (USD)"}
        <input type="number" min="0.01" max="100000" step="0.01" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <ErrorLine message={message} />
    </AdminDialog>
  );
}

export function SecretDialog({ issued, onClose }: { issued: IssuedKey; onClose: () => void }) {
  const zh = useLocale().locale === "zh";
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <AdminDialog
      title={zh ? "請立即複製這把金鑰" : "Copy this key now"}
      confirmLabel={zh ? "我已交付給客戶" : "I have delivered it to the customer"}
      onConfirm={onClose}
      onClose={onClose}
      dismissible={false}
    >
      <p className="portal-note">
        {zh
          ? `「${issued.label}」（${issued.prefix}）的完整金鑰只會顯示這一次，關閉後無法再次查看。`
          : `The full key for “${issued.label}” (${issued.prefix}) is shown only once and cannot be viewed again after you close this.`}
      </p>
      <div className="portal-secret">
        <code>{issued.secret}</code>
      </div>
      <div className="portal-actions">
        <button type="button" className="portal-button-secondary" onClick={copy}>
          {copied ? (zh ? "已複製" : "Copied") : zh ? "複製金鑰" : "Copy key"}
        </button>
      </div>
    </AdminDialog>
  );
}
