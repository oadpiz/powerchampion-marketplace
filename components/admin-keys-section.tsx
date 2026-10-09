"use client";

import { useState } from "react";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import {
  ResourceState,
  dateLabel,
  ownerLabel,
  usdLabel,
  usePortalResource,
  type GatewayOwner,
} from "./admin-resource";
import { useLocale } from "./locale-provider";

type GatewayKey = {
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
type KeysResponse = {
  keys: GatewayKey[];
  envKeys: GatewayKey[];
  gatewayConfigured: boolean;
};
type CustomerOption = {
  id: string;
  email: string;
  name: string;
  status: "active" | "disabled";
};
type IssuedKey = { secret: string; label: string; prefix: string };
type Dialog =
  | { kind: "issue" }
  | { kind: "limits"; key: GatewayKey }
  | { kind: "balance"; key: GatewayKey };

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

function ErrorLine({ message }: { message: string | null }) {
  return message === null ? null : (
    <p className="portal-error" role="alert">
      {message}
    </p>
  );
}

export function GatewayNotConnected() {
  const zh = useLocale().locale === "zh";
  return (
    <p className="portal-note" role="status">
      {zh
        ? "閘道尚未連線（PC_GATEWAY_ADMIN_TOKEN 未設定）"
        : "Gateway not connected (PC_GATEWAY_ADMIN_TOKEN is not set)"}
    </p>
  );
}

function IssueKeyDialog({
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
    (customer) => customer.status === "active",
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

function LimitsDialog({
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

function TopUpDialog({
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

function SecretDialog({ issued, onClose }: { issued: IssuedKey; onClose: () => void }) {
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

function limitText(value: number, zh: boolean) {
  return value === 0 ? (zh ? "不限" : "Unlimited") : value.toLocaleString(zh ? "zh-TW" : "en-US");
}

function LimitCells({ item, zh }: { item: GatewayKey; zh: boolean }) {
  return (
    <td>
      <div>{zh ? "每分鐘請求：" : "RPM: "}{limitText(item.rpm, zh)}</div>
      <div>{zh ? "每日 token：" : "Daily tokens: "}{limitText(item.dailyTokenLimit, zh)}</div>
      <div>{zh ? "同時處理：" : "In-flight: "}{limitText(item.maxInflight, zh)}</div>
    </td>
  );
}

export function AdminKeysSection() {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const resource = usePortalResource<KeysResponse>("/admin/keys");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle(item: GatewayKey) {
    if (pending) return;
    setPending(item.gatewayKeyId);
    setMessage(null);
    try {
      await portalRequest(`/admin/keys/${encodeURIComponent(item.gatewayKeyId)}/disable`, {
        method: "POST",
        body: JSON.stringify({ disabled: item.disabledAt === null }),
      });
      resource.refresh();
    } catch (reason: unknown) {
      setMessage(portalErrorText(reason, locale));
    } finally {
      setPending(null);
    }
  }

  const data = resource.data;
  return (
    <>
      <ResourceState {...resource}>
        {data && !data.gatewayConfigured ? (
          <GatewayNotConnected />
        ) : (
          data && (
            <>
              <section className="portal-panel">
                <div className="portal-actions">
                  <h2>{zh ? "閘道金鑰" : "Gateway keys"}</h2>
                  <button type="button" className="portal-button" onClick={() => setDialog({ kind: "issue" })}>
                    {zh ? "為客戶簽發金鑰" : "Issue key for a customer"}
                  </button>
                  <button type="button" className="portal-button-secondary" onClick={resource.refresh}>
                    {zh ? "重新整理" : "Refresh"}
                  </button>
                </div>
                <ErrorLine message={message} />
                {data.keys.length > 0 ? (
                  <div className="portal-table-wrap">
                    <table className="portal-table">
                      <caption className="sr-only">{zh ? "閘道 API 金鑰" : "Gateway API keys"}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{zh ? "前綴" : "Prefix"}</th>
                          <th scope="col">{zh ? "標籤" : "Label"}</th>
                          <th scope="col">{zh ? "持有人" : "Owner"}</th>
                          <th scope="col">{zh ? "餘額" : "Balance"}</th>
                          <th scope="col">{zh ? "限額" : "Limits"}</th>
                          <th scope="col">{zh ? "狀態" : "Status"}</th>
                          <th scope="col">{zh ? "最後使用" : "Last used"}</th>
                          <th scope="col">{zh ? "動作" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.keys.map((item) => (
                          <tr key={item.gatewayKeyId}>
                            <td><code>{item.prefix}</code></td>
                            <td>{item.label}</td>
                            <td>{ownerLabel(item.owner, zh)}</td>
                            <td>{item.balanceUsd === null ? (zh ? "後付" : "Postpaid") : usdLabel(item.balanceUsd, 2)}</td>
                            <LimitCells item={item} zh={zh} />
                            <td>
                              <span className={item.disabledAt === null ? "portal-badge" : "portal-badge portal-danger"}>
                                {item.disabledAt === null ? (zh ? "啟用" : "Enabled") : zh ? "停用" : "Disabled"}
                              </span>
                            </td>
                            <td>{dateLabel(item.lastUsedAt, zh)}</td>
                            <td>
                              <div className="portal-actions">
                                <button type="button" className="portal-text-button" disabled={pending !== null} onClick={() => toggle(item)}>
                                  {item.disabledAt === null ? (zh ? "停用" : "Disable") : zh ? "啟用" : "Enable"}
                                </button>
                                <button type="button" className="portal-text-button" onClick={() => setDialog({ kind: "limits", key: item })}>
                                  {zh ? "調限額" : "Limits"}
                                </button>
                                <button type="button" className="portal-text-button" disabled={item.balanceUsd === null} onClick={() => setDialog({ kind: "balance", key: item })}>
                                  {zh ? "加值" : "Top up"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="portal-empty">{zh ? "閘道上尚無金鑰。" : "No keys on the gateway yet."}</p>
                )}
              </section>
              {data.envKeys.length > 0 && (
                <section className="portal-panel">
                  <h2>{zh ? "環境金鑰（唯讀）" : "Environment keys (read-only)"}</h2>
                  <div className="portal-table-wrap">
                    <table className="portal-table">
                      <caption className="sr-only">{zh ? "由環境變數設定的金鑰" : "Keys defined by environment variables"}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{zh ? "前綴" : "Prefix"}</th>
                          <th scope="col">{zh ? "標籤" : "Label"}</th>
                          <th scope="col">{zh ? "限額" : "Limits"}</th>
                          <th scope="col">{zh ? "最後使用" : "Last used"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.envKeys.map((item) => (
                          <tr key={item.gatewayKeyId}>
                            <td><code>{item.prefix}</code></td>
                            <td>{item.label}</td>
                            <LimitCells item={item} zh={zh} />
                            <td>{dateLabel(item.lastUsedAt, zh)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )
        )}
      </ResourceState>
      {dialog?.kind === "issue" && (
        <IssueKeyDialog
          onClose={() => setDialog(null)}
          onIssued={(result) => {
            setDialog(null);
            setIssued(result);
            resource.refresh();
          }}
        />
      )}
      {dialog?.kind === "limits" && (
        <LimitsDialog
          target={dialog.key}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            resource.refresh();
          }}
        />
      )}
      {dialog?.kind === "balance" && (
        <TopUpDialog
          target={dialog.key}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            resource.refresh();
          }}
        />
      )}
      {issued && <SecretDialog issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}
