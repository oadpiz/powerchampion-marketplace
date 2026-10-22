"use client";

import { useEffect, useId, useState } from "react";
import {
  EMPTY_FILTERS,
  LOW_BALANCE_USD,
  NO_OWNER,
  STATUS_FILTERS,
  balanceLevel,
  customerOptions,
  filtersFromSearch,
  isDisabled,
  isExpired,
  matchesFilters,
  relativeTimeLabel,
  searchWithFilters,
  statusCounts,
  type KeyFilters,
  type StatusFilter,
} from "../lib/admin-keys-view";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import {
  DisableKeyDialog,
  IssueKeyDialog,
  LimitsDialog,
  SecretDialog,
  TopUpDialog,
  type GatewayKey,
  type IssuedKey,
} from "./admin-keys-dialogs";
import {
  GatewayNotConnected,
  ResourceState,
  dateLabel,
  ownerLabel,
  usdLabel,
  usePortalResource,
} from "./admin-resource";
import { useLocale } from "./locale-provider";

type KeysResponse = {
  keys: GatewayKey[];
  envKeys: GatewayKey[];
  gatewayConfigured: boolean;
};
type Dialog =
  | { kind: "issue"; initial?: { userId: string; label: string; replaces: string } }
  | { kind: "limits"; key: GatewayKey }
  | { kind: "balance"; key: GatewayKey }
  | { kind: "disable"; key: GatewayKey };
type Toast = { id: number; tone: "success" | "error"; text: string };

const STATUS_LABEL: Record<StatusFilter, [string, string]> = {
  all: ["All keys", "全部金鑰"],
  active: ["Active", "使用中"],
  disabled: ["Disabled", "已停用"],
  low: ["Low balance", "餘額偏低"],
};

function limitLine(value: number, zh: boolean, unitZh: string, unitEn: string) {
  if (value === 0) return zh ? "不限" : "Unlimited";
  return `${value.toLocaleString(zh ? "zh-TW" : "en-US")} ${zh ? unitZh : unitEn}`;
}

function LimitCells({ item, zh }: { item: GatewayKey; zh: boolean }) {
  return (
    <td className="admin-keys-limits">
      <div>{zh ? "每分鐘上限：" : "Per minute: "}{limitLine(item.rpm, zh, "次請求", "requests")}</div>
      <div>{zh ? "每日上限：" : "Per day: "}{limitLine(item.dailyTokenLimit, zh, "token", "tokens")}</div>
      <div>{zh ? "同時處理上限：" : "At once: "}{limitLine(item.maxInflight, zh, "個請求", "requests")}</div>
    </td>
  );
}

function ColumnHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <th scope="col">
      <span className="admin-keys-th-title">{title}</span>
      {hint && <span className="admin-keys-th-hint">{hint}</span>}
    </th>
  );
}

function LastUsed({ value, zh }: { value: GatewayKey["lastUsedAt"]; zh: boolean }) {
  const relative = relativeTimeLabel(value, zh);
  const absolute = value === null || value === "" ? undefined : dateLabel(value, zh);
  return <span title={absolute}>{relative}</span>;
}

function BalanceCell({ item, zh }: { item: GatewayKey; zh: boolean }) {
  const level = balanceLevel(item.balanceUsd);
  if (level === "postpaid")
    return (
      <td>
        <strong className="admin-keys-balance">{zh ? "後付" : "Postpaid"}</strong>
        <span className="admin-keys-cell-hint">{zh ? "不使用預付餘額" : "No prepaid balance"}</span>
      </td>
    );
  return (
    <td>
      <strong className={`admin-keys-balance admin-keys-balance-${level}`} data-balance-level={level}>
        {usdLabel(item.balanceUsd, 2)}
      </strong>
      {level === "empty" && (
        <span className="portal-badge admin-keys-badge-empty">{zh ? "餘額用完" : "Out of balance"}</span>
      )}
      {level === "low" && (
        <span className="portal-badge admin-keys-badge-low">{zh ? "餘額偏低" : "Low balance"}</span>
      )}
    </td>
  );
}

function ToastList({ toasts, onDismiss, zh }: { toasts: Toast[]; onDismiss: (id: number) => void; zh: boolean }) {
  return (
    <div className="admin-keys-toasts">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`admin-keys-toast admin-keys-toast-${toast.tone}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            className="portal-text-button"
            aria-label={zh ? "關閉通知" : "Dismiss notification"}
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function initialFilters(): KeyFilters {
  return typeof window === "undefined" ? EMPTY_FILTERS : filtersFromSearch(window.location.search);
}

export function AdminKeysSection() {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const resource = usePortalResource<KeysResponse>("/admin/keys");
  // A quiet reload after an action, so the table stays in place instead of flashing "loading".
  const [fresh, setFresh] = useState<KeysResponse | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filters, setFilters] = useState<KeyFilters>(initialFilters);
  const searchId = useId();
  const customerId = useId();

  useEffect(() => {
    // Keep the filters in the address bar so a reload or a shared link shows the same list.
    const url = new URL(window.location.href);
    const search = searchWithFilters(url.search, filters);
    if (search !== url.search) window.history.replaceState(window.history.state, "", `${url.pathname}${search}${url.hash}`);
  }, [filters]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => setToasts((current) => current.slice(1)), 6000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  function notify(tone: Toast["tone"], text: string) {
    setToasts((current) => [...current.slice(-2), { id: Date.now() + Math.random(), tone, text }]);
  }

  async function reload() {
    try {
      setFresh(await portalRequest<KeysResponse>("/admin/keys"));
    } catch {
      notify("error", zh ? "動作已完成，但清單沒能更新，請按「重新整理」。" : "The action finished, but the list could not be updated. Press Refresh.");
    }
  }

  function refreshAll() {
    setFresh(null);
    resource.refresh();
  }

  async function setDisabled(item: GatewayKey, disabled: boolean) {
    if (pending) return;
    setPending(item.gatewayKeyId);
    try {
      await portalRequest(`/admin/keys/${encodeURIComponent(item.gatewayKeyId)}/disable`, {
        method: "POST",
        body: JSON.stringify({ disabled }),
      });
      setDialog(null);
      notify(
        "success",
        disabled
          ? zh ? `已停用「${item.label}」。` : `Disabled “${item.label}”.`
          : zh ? `已啟用「${item.label}」。` : `Enabled “${item.label}”.`,
      );
      await reload();
    } catch (reason: unknown) {
      setDialog(null);
      notify(
        "error",
        `${disabled ? (zh ? `「${item.label}」停用失敗：` : `Could not disable “${item.label}”: `) : zh ? `「${item.label}」啟用失敗：` : `Could not enable “${item.label}”: `}${portalErrorText(reason, locale)}`,
      );
    } finally {
      setPending(null);
    }
  }

  function update(change: Partial<KeyFilters>) {
    setFilters((current) => ({ ...current, ...change }));
  }

  const data = fresh ?? resource.data;
  const keys = data?.keys ?? [];
  const visible = keys.filter((item) => matchesFilters(item, filters));
  const counts = statusCounts(keys);
  const { owners, hasUnowned } = customerOptions(keys);
  const unknownCustomer =
    filters.customer !== "" && filters.customer !== NO_OWNER && !owners.some((owner) => owner.id === filters.customer);
  const filtered = filters.query.trim() !== "" || filters.customer !== "" || filters.status !== "all";
  const number = (value: number) => value.toLocaleString(zh ? "zh-TW" : "en-US");

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
                  <h2>{zh ? "客戶的 API 金鑰" : "Customer API keys"}</h2>
                  <button type="button" className="portal-button" onClick={() => setDialog({ kind: "issue" })}>
                    {zh ? "為客戶簽發金鑰" : "Issue key for a customer"}
                  </button>
                  <button type="button" className="portal-button-secondary" onClick={refreshAll}>
                    {zh ? "重新整理" : "Refresh"}
                  </button>
                </div>
                <p className="portal-hint">
                  {zh
                    ? `每一列是一把客戶用來呼叫 API 的金鑰。餘額低於 $${LOW_BALANCE_USD} 會以黃色提醒，用完會變紅。`
                    : `Each row is a key a customer uses to call the API. Balances under $${LOW_BALANCE_USD} are flagged in amber, and red when empty.`}
                </p>
                {keys.length > 0 ? (
                  <>
                    <div className="admin-keys-status" role="group" aria-label={zh ? "依狀態篩選" : "Filter by status"}>
                      {STATUS_FILTERS.map((status) => (
                        <button
                          key={status}
                          type="button"
                          className={`admin-keys-status-button admin-keys-status-${status}`}
                          aria-pressed={filters.status === status}
                          onClick={() => update({ status })}
                        >
                          <span>{STATUS_LABEL[status][zh ? 1 : 0]}</span>
                          <strong>{number(counts[status])}</strong>
                        </button>
                      ))}
                    </div>
                    <div className="admin-keys-filters">
                      <div className="portal-field admin-keys-search">
                        <label htmlFor={searchId}>{zh ? "搜尋金鑰" : "Search keys"}</label>
                        <input
                          id={searchId}
                          type="search"
                          value={filters.query}
                          maxLength={200}
                          placeholder={zh ? "名稱、金鑰開頭、客戶 email 或姓名" : "Name, key start, customer email or name"}
                          onChange={(event) => update({ query: event.target.value })}
                        />
                      </div>
                      <div className="portal-field">
                        <label htmlFor={customerId}>{zh ? "客戶" : "Customer"}</label>
                        <select id={customerId} value={filters.customer} onChange={(event) => update({ customer: event.target.value })}>
                          <option value="">{zh ? "全部客戶" : "All customers"}</option>
                          {owners.map((owner) => (
                            <option key={owner.id} value={owner.id}>
                              {owner.name ? `${owner.name} (${owner.email})` : owner.email}
                            </option>
                          ))}
                          {hasUnowned && <option value={NO_OWNER}>{zh ? "未歸屬（沒有客戶）" : "Unassigned (no customer)"}</option>}
                          {unknownCustomer && (
                            <option value={filters.customer}>{zh ? "找不到這位客戶的金鑰" : "No keys for this customer"}</option>
                          )}
                        </select>
                      </div>
                    </div>
                    <div className="admin-keys-result">
                      <p role="status" aria-live="polite">
                        {filtered
                          ? zh
                            ? `顯示 ${number(visible.length)} 把，共 ${number(keys.length)} 把金鑰`
                            : `Showing ${number(visible.length)} of ${number(keys.length)} keys`
                          : zh
                            ? `共 ${number(keys.length)} 把金鑰`
                            : `${number(keys.length)} ${keys.length === 1 ? "key" : "keys"}`}
                      </p>
                      {filtered && (
                        <button type="button" className="portal-text-button" onClick={() => setFilters(EMPTY_FILTERS)}>
                          {zh ? "清除篩選" : "Clear filters"}
                        </button>
                      )}
                    </div>
                    {visible.length > 0 ? (
                      <div className="portal-table-wrap">
                        <table className="portal-table admin-keys-table">
                          <caption className="sr-only">{zh ? "客戶的 API 金鑰" : "Customer API keys"}</caption>
                          <thead>
                            <tr>
                              <ColumnHead title={zh ? "客戶" : "Customer"} hint={zh ? "這把金鑰屬於誰" : "Who the key belongs to"} />
                              <ColumnHead title={zh ? "金鑰名稱" : "Key name"} hint={zh ? "簽發時取的名稱" : "Set when it was issued"} />
                              <ColumnHead
                                title={zh ? "金鑰開頭（用來辨認）" : "Key starts with (to recognise it)"}
                                hint={zh ? "完整金鑰只在簽發時顯示一次" : "The full key is shown once, at issue"}
                              />
                              <ColumnHead title={zh ? "剩餘餘額（USD）" : "Balance left (USD)"} hint={zh ? `低於 $${LOW_BALANCE_USD} 會提醒` : `Flagged under $${LOW_BALANCE_USD}`} />
                              <ColumnHead title={zh ? "用量上限" : "Usage limits"} hint={zh ? "超過就暫時擋下" : "Requests over these are refused"} />
                              <ColumnHead title={zh ? "狀態" : "Status"} />
                              <ColumnHead title={zh ? "最後使用" : "Last used"} />
                              <ColumnHead title={zh ? "動作" : "Actions"} />
                            </tr>
                          </thead>
                          <tbody>
                            {visible.map((item) => {
                              const disabled = isDisabled(item);
                              const level = balanceLevel(item.balanceUsd);
                              const busy = pending === item.gatewayKeyId;
                              return (
                                <tr
                                  key={item.gatewayKeyId}
                                  className={[
                                    disabled ? "admin-keys-row-disabled" : "",
                                    level === "low" || level === "empty" ? `admin-keys-row-${level}` : "",
                                  ].filter(Boolean).join(" ") || undefined}
                                >
                                  <td>
                                    {item.owner ? (
                                      <>
                                        {item.owner.name && <strong className="admin-keys-owner-name">{item.owner.name}</strong>}
                                        <span className="admin-keys-owner-email">{item.owner.email}</span>
                                      </>
                                    ) : (
                                      <span className="admin-keys-cell-hint">{ownerLabel(null, zh)}</span>
                                    )}
                                  </td>
                                  <td>{item.label}</td>
                                  <td><code>{item.prefix}</code></td>
                                  <BalanceCell item={item} zh={zh} />
                                  <LimitCells item={item} zh={zh} />
                                  <td>
                                    <span className={disabled ? "portal-badge portal-danger" : "portal-badge admin-keys-badge-active"}>
                                      {disabled ? (zh ? "已停用" : "Disabled") : zh ? "使用中" : "Active"}
                                    </span>
                                    {isExpired(item) && <span className="portal-badge portal-danger">{zh ? "已過期" : "Expired"}</span>}
                                  </td>
                                  <td><LastUsed value={item.lastUsedAt} zh={zh} /></td>
                                  <td>
                                    <div className="admin-keys-row-actions">
                                      {level !== "postpaid" && (
                                        <button
                                          type="button"
                                          className="admin-keys-action admin-keys-action-primary"
                                          aria-label={zh ? `為「${item.label}」加值` : `Top up “${item.label}”`}
                                          onClick={() => setDialog({ kind: "balance", key: item })}
                                        >
                                          {zh ? "加值" : "Top up"}
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="admin-keys-action"
                                        aria-label={zh ? `調整「${item.label}」的用量上限` : `Edit limits of “${item.label}”`}
                                        onClick={() => setDialog({ kind: "limits", key: item })}
                                      >
                                        {zh ? "調整上限" : "Edit limits"}
                                      </button>
                                      {disabled ? (
                                        <button
                                          type="button"
                                          className="admin-keys-action"
                                          disabled={pending !== null}
                                          aria-label={zh ? `啟用「${item.label}」` : `Enable “${item.label}”`}
                                          onClick={() => setDisabled(item, false)}
                                        >
                                          {busy ? (zh ? "處理中…" : "Working…") : zh ? "啟用" : "Enable"}
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          className="admin-keys-action admin-keys-action-danger"
                                          disabled={pending !== null}
                                          aria-label={zh ? `停用「${item.label}」` : `Disable “${item.label}”`}
                                          onClick={() => setDialog({ kind: "disable", key: item })}
                                        >
                                          {zh ? "停用" : "Disable"}
                                        </button>
                                      )}
                                      {item.owner && (
                                        <button
                                          type="button"
                                          className="admin-keys-action"
                                          aria-label={zh ? `為 ${item.owner.email} 再簽一把金鑰` : `Issue a new key for ${item.owner.email}`}
                                          onClick={() =>
                                            setDialog({
                                              kind: "issue",
                                              initial: { userId: item.owner!.id, label: item.label, replaces: item.label },
                                            })
                                          }
                                        >
                                          {zh ? "再簽一把" : "New key"}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="portal-empty">
                        <p>{zh ? "沒有符合條件的金鑰。" : "No keys match these filters."}</p>
                        <button type="button" className="portal-button-secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                          {zh ? "清除篩選" : "Clear filters"}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="portal-empty">
                    {zh
                      ? "閘道上尚無金鑰。按「為客戶簽發金鑰」開始。"
                      : "No keys on the gateway yet. Use “Issue key for a customer” to start."}
                  </p>
                )}
              </section>
              {data.envKeys.length > 0 && (
                <details className="portal-panel admin-keys-env">
                  <summary>
                    <h2>
                      {zh
                        ? `環境金鑰（唯讀，${number(data.envKeys.length)} 把）`
                        : `Environment keys (read-only, ${number(data.envKeys.length)})`}
                    </h2>
                    <span className="admin-keys-cell-hint">
                      {zh ? "伺服器設定檔裡的金鑰，這裡只能看不能改。" : "Keys from the server's settings file. You can view them here but not change them."}
                    </span>
                  </summary>
                  <div className="portal-table-wrap">
                    <table className="portal-table">
                      <caption className="sr-only">{zh ? "由伺服器設定檔設定的金鑰" : "Keys defined in the server settings"}</caption>
                      <thead>
                        <tr>
                          <ColumnHead title={zh ? "金鑰開頭（用來辨認）" : "Key starts with (to recognise it)"} />
                          <ColumnHead title={zh ? "金鑰名稱" : "Key name"} />
                          <ColumnHead title={zh ? "用量上限" : "Usage limits"} />
                          <ColumnHead title={zh ? "最後使用" : "Last used"} />
                        </tr>
                      </thead>
                      <tbody>
                        {data.envKeys.map((item) => (
                          <tr key={item.gatewayKeyId}>
                            <td><code>{item.prefix}</code></td>
                            <td>{item.label}</td>
                            <LimitCells item={item} zh={zh} />
                            <td><LastUsed value={item.lastUsedAt} zh={zh} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </>
          )
        )}
      </ResourceState>
      <ToastList toasts={toasts} zh={zh} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
      {dialog?.kind === "issue" && (
        <IssueKeyDialog
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onIssued={(result) => {
            setDialog(null);
            setIssued(result);
            void reload();
          }}
        />
      )}
      {dialog?.kind === "limits" && (
        <LimitsDialog
          target={dialog.key}
          onClose={() => setDialog(null)}
          onDone={() => {
            const label = dialog.key.label;
            setDialog(null);
            notify("success", zh ? `已更新「${label}」的用量上限。` : `Updated the limits of “${label}”.`);
            void reload();
          }}
        />
      )}
      {dialog?.kind === "balance" && (
        <TopUpDialog
          target={dialog.key}
          onClose={() => setDialog(null)}
          onDone={(balance) => {
            const label = dialog.key.label;
            setDialog(null);
            const now = balance === null ? "" : usdLabel(balance, 2);
            notify(
              "success",
              zh
                ? `已為「${label}」加值${now ? `，現在餘額 ${now}` : ""}。`
                : `Topped up “${label}”${now ? `; the balance is now ${now}` : ""}.`,
            );
            void reload();
          }}
        />
      )}
      {dialog?.kind === "disable" && (
        <DisableKeyDialog
          target={dialog.key}
          inFlight={pending === dialog.key.gatewayKeyId}
          onClose={() => setDialog(null)}
          onConfirm={() => setDisabled(dialog.key, true)}
        />
      )}
      {issued && <SecretDialog issued={issued} onClose={() => setIssued(null)} />}
    </>
  );
}
