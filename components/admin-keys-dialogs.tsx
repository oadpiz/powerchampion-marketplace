"use client";

import { useState } from "react";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import {
  ownerLabel,
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
  initial,
}: {
  onClose: () => void;
  onIssued: (issued: IssuedKey) => void;
  /** Prefills the form to issue a replacement key for an existing key's customer. */
  initial?: { userId: string; label: string; replaces: string };
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const customers = usePortalResource<{ customers: CustomerOption[] }>(
    "/admin/customers",
  );
  const [userId, setUserId] = useState(initial?.userId ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
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
      title={initial ? (zh ? "為同一位客戶再簽一把金鑰" : "Issue a new key for the same customer") : zh ? "為客戶簽發金鑰" : "Issue a key for a customer"}
      confirmLabel={zh ? "簽發金鑰" : "Issue key"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
      inFlight={busy}
    >
      {initial && (
        <p className="portal-note">
          {zh
            ? `舊金鑰「${initial.replaces}」不會自動停用。客戶換上新金鑰後，再回來停用舊的。`
            : `The old key “${initial.replaces}” stays active. Once the customer has switched to the new key, come back and disable the old one.`}
        </p>
      )}
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
        {zh ? "標籤（自己看的名稱，例如「正式環境」）" : "Label"}
        <input maxLength={80} value={label} disabled={busy} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "預付金額（USD）" : "Prepaid amount (USD)"}
        <input type="number" min="0.01" max="100000" step="0.01" value={prepaid} disabled={busy} onChange={(event) => setPrepaid(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "每日上限：token 數（選填，0 = 不限）" : "Daily token limit (optional, 0 = unlimited)"}
        <input type="number" min="0" step="1" value={daily} disabled={busy} onChange={(event) => setDaily(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "每分鐘上限：請求次數（選填）" : "Requests per minute (optional)"}
        <input type="number" min="0" step="1" value={rpm} disabled={busy} onChange={(event) => setRpm(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "同時處理上限：請求數（選填）" : "Max in-flight requests (optional)"}
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
      title={zh ? `調整用量上限：${target.label}` : `Adjust limits: ${target.label}`}
      confirmLabel={zh ? "儲存" : "Save"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
      inFlight={busy}
    >
      <p className="portal-hint">
        {zh
          ? "超過上限的請求會被擋下。填 0 代表不限。"
          : "Requests over a limit are refused. 0 means unlimited."}
      </p>
      <label className="portal-field">
        {zh ? "每日上限：token 數" : "Daily token limit"}
        <input type="number" min="0" step="1" value={daily} disabled={busy} onChange={(event) => setDaily(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "每分鐘上限：請求次數" : "Requests per minute"}
        <input type="number" min="0" step="1" value={rpm} disabled={busy} onChange={(event) => setRpm(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "同時處理上限：請求數" : "Max in-flight requests"}
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
  /** Receives the balance the gateway reports after the top-up, when it sends one. */
  onDone: (balanceUsd: string | null) => void;
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
      const result = await portalRequest<{ balanceUsd?: string | null }>(
        `/admin/keys/${encodeURIComponent(target.gatewayKeyId)}/balance`,
        { method: "POST", body: JSON.stringify({ addUsd }) },
      );
      onDone(result?.balanceUsd ?? null);
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
        {zh ? "客戶：" : "Customer: "}
        {ownerLabel(target.owner, zh)}
        <br />
        {zh ? "目前餘額：" : "Current balance: "}
        {usdLabel(target.balanceUsd, 2)}
        {zh ? "（輸入的金額會加在上面）" : " (the amount is added to this)"}
      </p>
      <label className="portal-field">
        {zh ? "金額（USD）" : "Amount (USD)"}
        <input type="number" min="0.01" max="100000" step="0.01" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <ErrorLine message={message} />
    </AdminDialog>
  );
}

/** Asks before disabling a key, naming the key and its customer. Enabling needs no confirmation. */
export function DisableKeyDialog({
  target,
  onClose,
  onConfirm,
  inFlight,
}: {
  target: GatewayKey;
  onClose: () => void;
  onConfirm: () => void;
  inFlight: boolean;
}) {
  const zh = useLocale().locale === "zh";
  const owner = target.owner ? target.owner.name ? `${target.owner.name}（${target.owner.email}）` : target.owner.email : null;
  const ownerEn = target.owner ? target.owner.name ? `${target.owner.name} (${target.owner.email})` : target.owner.email : null;
  return (
    <AdminDialog
      title={zh ? `停用金鑰「${target.label}」？` : `Disable the key “${target.label}”?`}
      confirmLabel={zh ? "確認停用" : "Disable key"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={onConfirm}
      onClose={onClose}
      inFlight={inFlight}
      danger
    >
      <p>
        {zh
          ? `${owner ? `客戶 ${owner}` : "這把未歸屬客戶"}的金鑰「${target.label}」（開頭 ${target.prefix}）會立刻無法呼叫 API。`
          : `The key “${target.label}” (starts with ${target.prefix}) ${ownerEn ? `of ${ownerEn}` : "with no customer"} stops working for API calls right away.`}
      </p>
      <p className="portal-hint">
        {zh ? "之後可以再按「啟用」恢復，餘額不會消失。" : "You can enable it again later; the balance is kept."}
      </p>
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
