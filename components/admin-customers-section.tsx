"use client";

import { useEffect, useRef, useState } from "react";
import {
  AccountActionDialog,
  type AccountAction,
  type AccountActionResult,
  type Customer,
} from "./admin-account-dialog";
import {
  ResourceState,
  dateLabel,
  usePortalResource,
} from "./admin-resource";
import { useLocale } from "./locale-provider";

type AccountSelection = { action: AccountAction; customer: Customer };

export function CustomersSection({ currentUserId }: { currentUserId?: string }) {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<{ customers: Customer[] }>(
    "/admin/customers",
  );
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<AccountSelection | null>(null);
  const [done, setDone] = useState<AccountAction | null>(null);
  const [doneResult, setDoneResult] = useState<AccountActionResult>({});
  const keysRevoked = doneResult.keysRevoked ?? 0;
  const keysFailed = doneResult.keysFailed ?? 0;
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef(false);
  useEffect(() => {
    if (restoreFocusRef.current && !resource.loading && resource.data) {
      restoreFocusRef.current = false;
      searchRef.current?.focus();
    }
  }, [resource.loading, resource.data]);
  const customers =
    resource.data?.customers.filter((customer) =>
      `${customer.email} ${customer.name} ${customer.id}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    ) ?? [];
  return (
    <>
      {done && (
        <p role="status" className="portal-note">
          {done === "reset-password"
            ? zh
              ? "密碼已重設，該使用者的所有登入已登出。"
              : "The password was reset and every session for that user was signed out."
            : done === "role"
              ? zh
                ? "角色已更新。"
                : "The role was updated."
              : zh
                ? "帳號狀態已更新。"
                : "The account status was updated."}
          {done === "disable" &&
            (zh
              ? ` ${keysRevoked} 把閘道金鑰已撤銷。`
              : ` ${keysRevoked} gateway ${keysRevoked === 1 ? "key" : "keys"} revoked.`)}
        </p>
      )}
      {done === "disable" && keysFailed > 0 && (
        <p role="alert" className="portal-error">
          {zh
            ? `${keysFailed} 把金鑰無法撤銷，請到「金鑰」頁對帳處理。`
            : `${keysFailed} ${keysFailed === 1 ? "key" : "keys"} could not be revoked. Reconcile ${keysFailed === 1 ? "it" : "them"} on the API keys page.`}
        </p>
      )}
      <ResourceState {...resource}>
        <section className="portal-panel">
          <div className="portal-actions">
            <h2>{zh ? "客戶名單" : "Customer directory"}</h2>
            <button
              type="button"
              className="portal-button-secondary"
              onClick={resource.refresh}
            >
              {zh ? "重新整理" : "Refresh"}
            </button>
          </div>
          <label className="portal-field">
            {zh
              ? "搜尋姓名、電子郵件或客戶 ID"
              : "Search by name, email, or customer ID"}
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={zh ? "搜尋客戶" : "Find a customer"}
            />
          </label>
          {customers.length > 0 ? (
            <div className="portal-table-wrap">
              <table className="portal-table">
                <caption className="sr-only">
                  {zh
                    ? "客戶帳號、角色、狀態與 API 金鑰數量"
                    : "Customer accounts with role, status, and API key counts"}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{zh ? "客戶" : "Customer"}</th>
                    <th scope="col">{zh ? "客戶 ID" : "Customer ID"}</th>
                    <th scope="col">{zh ? "API 金鑰" : "API keys"}</th>
                    <th scope="col">{zh ? "角色" : "Role"}</th>
                    <th scope="col">{zh ? "狀態" : "Status"}</th>
                    <th scope="col">{zh ? "建立時間" : "Created"}</th>
                    <th scope="col">{zh ? "動作" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td>
                        <strong>{customer.name || customer.email}</strong>
                        <br />
                        {customer.name && customer.email}
                      </td>
                      <td>{customer.id}</td>
                      <td>{customer.keyCount}</td>
                      <td>
                        <span className="portal-badge">
                          {customer.role === "admin"
                            ? zh
                              ? "管理員"
                              : "Admin"
                            : zh
                              ? "客戶"
                              : "Customer"}
                        </span>
                      </td>
                      <td>
                        <span className="portal-badge">
                          {customer.status === "disabled"
                            ? zh
                              ? "已停用"
                              : "Disabled"
                            : zh
                              ? "啟用中"
                              : "Active"}
                        </span>
                      </td>
                      <td>{dateLabel(customer.createdAt, zh)}</td>
                      <td>
                        {customer.id === currentUserId ? (
                          <span className="portal-badge">
                            {zh ? "本人" : "You"}
                          </span>
                        ) : (
                          <div className="portal-actions">
                            {(
                              [
                                customer.status === "active"
                                  ? "disable"
                                  : "enable",
                                "role",
                                "reset-password",
                              ] as const
                            ).map((action) => {
                              const label =
                                action === "disable"
                                  ? zh
                                    ? "停用"
                                    : "Disable"
                                  : action === "enable"
                                    ? zh
                                      ? "啟用"
                                      : "Enable"
                                    : action === "role"
                                      ? zh
                                        ? "改角色"
                                        : "Change role"
                                      : zh
                                        ? "重設密碼"
                                        : "Reset password";
                              return (
                                <button
                                  key={action}
                                  type="button"
                                  className="portal-button-secondary"
                                  aria-label={`${label} ${customer.email}`}
                                  onClick={() => {
                                    setDone(null);
                                    setSelection({ action, customer });
                                  }}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="portal-empty">
              {query
                ? zh
                  ? "找不到符合搜尋的客戶。"
                  : "No customers match your search."
                : zh
                  ? "尚無客戶帳號。"
                  : "No customer accounts yet."}
            </p>
          )}
        </section>
      </ResourceState>
      {selection && (
        <AccountActionDialog
          action={selection.action}
          customer={selection.customer}
          onClose={() => setSelection(null)}
          onDone={(result) => {
            setDone(selection.action);
            setDoneResult(result);
            setSelection(null);
            restoreFocusRef.current = true;
            resource.refresh();
          }}
        />
      )}
    </>
  );
}

