"use client";

import { useState } from "react";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import {
  ErrorLine,
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
  | { kind: "issue" }
  | { kind: "limits"; key: GatewayKey }
  | { kind: "balance"; key: GatewayKey };

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
