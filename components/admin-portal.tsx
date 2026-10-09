"use client";

import Link from "next/link";
import { useModalIsolation } from "./use-modal-isolation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  portalErrorText,
  portalRequest,
  PortalError,
  type PortalUser,
} from "../lib/portal-client";
import { AdminGatewaySection } from "./admin-gateway-section";
import { AdminKeysSection } from "./admin-keys-section";
import { AdminUsageSection } from "./admin-usage-section";
import { useLocale } from "./locale-provider";
import {
  ResourceState,
  dateLabel,
  errorMessage,
  usePortalResource,
} from "./admin-resource";

export type AdminSection =
  | "overview"
  | "customers"
  | "keys"
  | "usage"
  | "gateway"
  | "credits"
  | "audit";
type Overview = {
  customerCount: number;
  keyCount: number;
  pendingCreditCount: number;
  gatewayConfigured: boolean;
};
type Customer = {
  id: string;
  email: string;
  name: string;
  role: "customer" | "admin";
  status: "active" | "disabled";
  createdAt: string | number;
  keyCount: number;
};
type AccountAction = "disable" | "enable" | "role" | "reset-password";
type AccountActionResult = { keysRevoked?: number; keysFailed?: number };
type AccountSelection = { action: AccountAction; customer: Customer };
type CreditRequest = {
  id: string;
  amountUsd: number;
  status: string;
  reference: string | null;
  createdAt: string | number;
  reviewedAt: string | number | null;
  email: string;
  name: string;
};
type AuditEvent = {
  id: string;
  action: string;
  actorEmail: string | null;
  targetId: string | null;
  createdAt: string | number;
};
type ReviewSelection = {
  request: CreditRequest;
  decision: "approve" | "reject";
};

function moneyLabel(value: number, zh: boolean): string {
  return Number.isFinite(value)
    ? new Intl.NumberFormat(zh ? "zh-TW" : "en-US", {
        style: "currency",
        currency: "USD",
        currencyDisplay: "code",
      }).format(value)
    : zh
      ? "金額未提供"
      : "Amount unavailable";
}

function statusLabel(value: string, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    pending: ["Pending review", "待審核"],
    approved: ["Approval recorded", "已記錄核准"],
    rejected: ["Rejection recorded", "已記錄駁回"],
  };
  return labels[value]?.[zh ? 1 : 0] ?? value;
}

function OverviewSection() {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<Overview>("/admin/overview");
  const stats = [
    {
      label: zh ? "客戶帳號" : "Customer accounts",
      note: zh
        ? "只計算客戶帳號；客戶名單同時列出管理員。"
        : "Counts customer accounts only; the Customers list also shows administrators.",
      value: resource.data?.customerCount,
      href: "/admin/customers",
    },
    {
      label: zh ? "API 金鑰" : "API keys",
      value: resource.data?.keyCount,
      href: "/admin/customers",
    },
    {
      label: zh ? "待審核儲值申請" : "Pending credit requests",
      value: resource.data?.pendingCreditCount,
      href: "/admin/credits",
    },
  ];
  return (
    <ResourceState {...resource}>
      <div className="portal-grid">
        {stats.map((stat) => (
          <Link
            className="portal-panel portal-stat"
            key={stat.label}
            href={stat.href}
          >
            <span>{stat.label}</span>
            <strong>
              {typeof stat.value === "number" && Number.isFinite(stat.value)
                ? stat.value.toLocaleString(zh ? "zh-TW" : "en-US")
                : zh
                  ? "尚未取得"
                  : "Unavailable"}
            </strong>
            {"note" in stat && stat.note ? <small>{stat.note}</small> : null}
          </Link>
        ))}
      </div>
      <section className="portal-panel">
        <h2>{zh ? "Gateway 連線設定" : "Gateway configuration"}</h2>
        <p className="portal-badge">
          {resource.data?.gatewayConfigured === true
            ? zh
              ? "已設定"
              : "Configured"
            : resource.data?.gatewayConfigured === false
              ? zh
                ? "尚未設定"
                : "Not configured"
              : zh
                ? "狀態未取得"
                : "Status unavailable"}
        </p>
        <p className="portal-note">
          {zh
            ? "此狀態代表連線設定是否存在，不代表即時健康檢查。儲值申請的審核紀錄不會變更 Gateway 餘額。"
            : "This indicates whether a connection is configured, not a live health check. Reviewing a credit request does not change a gateway balance."}
        </p>
        <Link href="/status">
          {zh ? "查看即時服務狀態" : "View service status"} →
        </Link>
      </section>
      <section className="portal-panel">
        <h2>{zh ? "管理工作" : "Administration tasks"}</h2>
        <p>
          {zh
            ? "查看客戶與金鑰數量、審核儲值申請，並追蹤操作紀錄。"
            : "Find customers and their key counts, review credit requests, and trace administrative activity."}
        </p>
        <div className="portal-actions">
          <Link className="portal-button" href="/admin/credits">
            {zh ? "前往儲值審核" : "Review credit requests"}
          </Link>
          <Link className="portal-button-secondary" href="/admin/audit">
            {zh ? "查看操作紀錄" : "View audit log"}
          </Link>
        </div>
      </section>
    </ResourceState>
  );
}

function CustomersSection({ currentUserId }: { currentUserId?: string }) {
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

function AccountActionDialog({
  action,
  customer,
  onClose,
  onDone,
}: {
  action: AccountAction;
  customer: Customer;
  onClose: () => void;
  onDone: (result: AccountActionResult) => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const inFlightRef = useRef(false);
  const reset = action === "reset-password";
  const nextRole = customer.role === "admin" ? "customer" : "admin";
  const roleLabel = (role: Customer["role"]) =>
    role === "admin" ? "管理員" : "客戶";
  const who = customer.name
    ? `${customer.name} (${customer.email})`
    : customer.email;
  useModalIsolation(true, dialogRef);

  useEffect(() => {
    const previousFocus = document.activeElement;
    (passwordRef.current ?? cancelRef.current)?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!inFlightRef.current) onClose();
      }
      if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), a[href]",
        );
        if (!focusable?.length) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialogRef.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    setError(null);
    setValidation(null);
    if (reset) {
      if (password !== confirmation) {
        setValidation(
          zh ? "兩次輸入的密碼不一致。" : "The passwords do not match.",
        );
        return;
      }
      if (password.length < 12) {
        setValidation(
          zh ? "密碼至少 12 個字元。" : "Use at least 12 characters.",
        );
        return;
      }
    }
    inFlightRef.current = true;
    setSubmitting(true);
    const base = `/admin/customers/${encodeURIComponent(customer.id)}`;
    const request =
      action === "role"
        ? { path: `${base}/role`, body: { role: nextRole } }
        : reset
          ? { path: `${base}/reset-password`, body: { newPassword: password } }
          : { path: `${base}/status`, body: { action } };
    try {
      const result = await portalRequest<AccountActionResult>(request.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      onDone({
        keysRevoked: typeof result?.keysRevoked === "number" ? result.keysRevoked : undefined,
        keysFailed: typeof result?.keysFailed === "number" ? result.keysFailed : undefined,
      });
    } catch (reason: unknown) {
      setError(reason);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  const title =
    action === "disable"
      ? zh
        ? "停用這個帳號？"
        : "Disable this account?"
      : action === "enable"
        ? zh
          ? "重新啟用這個帳號？"
          : "Enable this account again?"
        : action === "role"
          ? zh
            ? "變更這個帳號的角色？"
            : "Change this account's role?"
          : zh
            ? "重設這個帳號的密碼？"
            : "Reset this account's password?";
  const impact =
    action === "disable"
      ? zh
        ? `${who}：登入、既有工作階段與 agent token 會立即失效，該帳號所有啟用中的閘道 API 金鑰也會被撤銷。重新啟用帳號不會恢復這些金鑰。`
        : `${who}: Sign-in, active sessions and agent tokens stop working immediately, and every active gateway API key of this account is revoked. Enabling the account later does not restore those keys.`
      : action === "enable"
        ? zh
          ? `${who} 將可以重新登入。`
          : `${who} will be able to sign in again.`
        : action === "role"
          ? zh
            ? `將 ${who} 的角色從${roleLabel(customer.role)}改為${roleLabel(nextRole)}。`
            : `Change the role of ${who} from ${customer.role} to ${nextRole}.`
          : zh
            ? `為 ${who} 設定新密碼。該使用者所有裝置上的登入都會被登出。`
            : `Set a new password for ${who}. Every session for that user is signed out.`;

  return (
    <div className="portal-dialog-backdrop">
      <div
        ref={dialogRef}
        className="portal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-action-title"
        aria-describedby="account-action-impact"
        tabIndex={-1}
      >
        <p className="portal-kicker">
          {zh ? "帳號管理" : "Account management"}
        </p>
        <h2 id="account-action-title">{title}</h2>
        <p className="portal-note" id="account-action-impact">
          {impact}
        </p>
        <form onSubmit={submit}>
          {reset && (
            <>
              <label className="portal-field">
                {zh ? "新密碼" : "New password"}
                <input
                  ref={passwordRef}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  disabled={submitting}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="portal-field">
                {zh ? "確認密碼" : "Confirm password"}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  disabled={submitting}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
            </>
          )}
          {validation !== null && (
            <p className="portal-error" role="alert">
              {validation}
            </p>
          )}
          {error !== null && (
            <p className="portal-error" role="alert">
              {portalErrorText(error, locale)}
            </p>
          )}
          <div className="portal-actions">
            <button
              ref={cancelRef}
              type="button"
              className="portal-button-secondary"
              disabled={submitting}
              onClick={onClose}
            >
              {zh ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              className="portal-button"
              disabled={submitting}
            >
              {zh ? "確認" : "Confirm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReviewDialog({
  selection,
  onClose,
  onReviewed,
}: {
  selection: ReviewSelection;
  onClose: () => void;
  onReviewed: (decision: "approve" | "reject") => void;
}) {
  const zh = useLocale().locale === "zh";
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inFlightRef = useRef(false);
  const approve = selection.decision === "approve";
  useModalIsolation(true, dialogRef);

  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!inFlightRef.current) onClose();
      }
      if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), a[href]",
        );
        if (!focusable?.length) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialogRef.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [onClose]);

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await portalRequest(
        `/admin/credits/${encodeURIComponent(selection.request.id)}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: selection.decision,
            note: note.trim(),
          }),
        },
      );
      onReviewed(selection.decision);
    } catch (reason: unknown) {
      setError(reason);
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="portal-dialog-backdrop">
      <div
        ref={dialogRef}
        className="portal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        aria-describedby="review-impact"
        tabIndex={-1}
      >
        <p className="portal-kicker">
          {zh ? "儲值申請審核" : "Credit request review"}
        </p>
        <h2 id="review-title">
          {approve
            ? zh
              ? "記錄核准這筆申請？"
              : "Record approval for this request?"
            : zh
              ? "記錄駁回這筆申請？"
              : "Record rejection for this request?"}
        </h2>
        <p>
          <strong>{moneyLabel(selection.request.amountUsd, zh)}</strong> ·{" "}
          {selection.request.email}
        </p>
        <p>
          {zh ? "申請 ID：" : "Request ID: "}
          {selection.request.id}
        </p>
        <p className="portal-note" id="review-impact">
          {zh
            ? "此操作只記錄內部審核結果，不會付款、退款或增加 Gateway 儲值餘額。實際儲值仍需另外確認與處理。"
            : "This records an internal review only. It does not charge, refund, or add credit to a gateway balance. Actual funding must be verified and processed separately."}
        </p>
        <form onSubmit={review}>
          <label className="portal-field">
            {zh ? "審核備註（選填）" : "Review note (optional)"}
            <textarea
              value={note}
              maxLength={500}
              rows={4}
              disabled={submitting}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                zh
                  ? "記錄核對結果或駁回原因"
                  : "Record verification details or a reason for rejection"
              }
            />
          </label>
          {error !== null && (
            <p className="portal-error" role="alert">
              {errorMessage(error, zh)}
            </p>
          )}
          <div className="portal-actions">
            <button
              ref={cancelRef}
              type="button"
              className="portal-button-secondary"
              disabled={submitting}
              onClick={onClose}
            >
              {zh ? "取消" : "Cancel"}
            </button>
            <button
              type="submit"
              className="portal-button"
              disabled={submitting}
            >
              {submitting
                ? zh
                  ? "正在記錄…"
                  : "Recording…"
                : approve
                  ? zh
                    ? "確認記錄核准"
                    : "Confirm and record approval"
                  : zh
                    ? "確認記錄駁回"
                    : "Confirm and record rejection"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreditsSection() {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<{ requests: CreditRequest[] }>(
    "/admin/credits",
  );
  const [status, setStatus] = useState("pending");
  const [selection, setSelection] = useState<ReviewSelection | null>(null);
  const [recorded, setRecorded] = useState<"approve" | "reject" | null>(null);
  const requests =
    resource.data?.requests.filter(
      (request) => status === "all" || request.status === status,
    ) ?? [];
  return (
    <>
      {recorded && (
        <p role="status" className="portal-note">
          {recorded === "approve"
            ? zh
              ? "已記錄核准。Gateway 餘額未變更。"
              : "Approval recorded. No gateway balance was changed."
            : zh
              ? "已記錄駁回。Gateway 餘額未變更。"
              : "Rejection recorded. No gateway balance was changed."}
        </p>
      )}
      <ResourceState {...resource}>
        <section className="portal-panel">
          <div className="portal-actions">
            <h2>{zh ? "儲值申請" : "Credit requests"}</h2>
            <button
              type="button"
              className="portal-button-secondary"
              onClick={resource.refresh}
            >
              {zh ? "重新整理" : "Refresh"}
            </button>
          </div>
          <p className="portal-note">
            {zh
              ? "審核會留下管理紀錄，不會自動儲值。請依實際付款核對結果記錄核准或駁回。"
              : "Reviews create an administrative record and do not automatically fund an account. Record your decision after checking payment details."}
          </p>
          <label className="portal-field">
            {zh ? "篩選狀態" : "Filter by status"}
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="pending">{statusLabel("pending", zh)}</option>
              <option value="approved">{statusLabel("approved", zh)}</option>
              <option value="rejected">{statusLabel("rejected", zh)}</option>
              <option value="all">{zh ? "全部申請" : "All requests"}</option>
            </select>
          </label>
          {requests.length > 0 ? (
            <div className="portal-table-wrap">
              <table className="portal-table">
                <caption className="sr-only">
                  {zh
                    ? "儲值申請與審核狀態"
                    : "Credit requests and review status"}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      {zh ? "客戶／申請" : "Customer / request"}
                    </th>
                    <th scope="col">{zh ? "申請金額" : "Requested amount"}</th>
                    <th scope="col">{zh ? "付款參考" : "Payment reference"}</th>
                    <th scope="col">{zh ? "狀態" : "Status"}</th>
                    <th scope="col">{zh ? "時間" : "Dates"}</th>
                    <th scope="col">{zh ? "審核" : "Review"}</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <strong>{request.name || request.email}</strong>
                        {request.name && (
                          <>
                            <br />
                            {request.email}
                          </>
                        )}
                        <br />
                        <small>{request.id}</small>
                      </td>
                      <td>{moneyLabel(request.amountUsd, zh)}</td>
                      <td>{request.reference || "—"}</td>
                      <td>
                        <span className="portal-badge">
                          {statusLabel(request.status, zh)}
                        </span>
                      </td>
                      <td>
                        {dateLabel(request.createdAt, zh)}
                        {request.reviewedAt && (
                          <>
                            <br />
                            <small>
                              {zh ? "審核：" : "Reviewed: "}
                              {dateLabel(request.reviewedAt, zh)}
                            </small>
                          </>
                        )}
                      </td>
                      <td>
                        {request.status === "pending" ? (
                          <div className="portal-actions">
                            <button
                              type="button"
                              className="portal-button-secondary"
                              aria-label={`${zh ? "核准" : "Approve"} ${request.email} · ${request.id}`}
                              onClick={() => {
                                setRecorded(null);
                                setSelection({ request, decision: "approve" });
                              }}
                            >
                              {zh ? "核准" : "Approve"}
                            </button>
                            <button
                              type="button"
                              className="portal-button-secondary"
                              aria-label={`${zh ? "駁回" : "Reject"} ${request.email} · ${request.id}`}
                              onClick={() => {
                                setRecorded(null);
                                setSelection({ request, decision: "reject" });
                              }}
                            >
                              {zh ? "駁回" : "Reject"}
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="portal-empty">
              {zh
                ? "此狀態下沒有儲值申請。"
                : "No credit requests with this status."}
            </p>
          )}
        </section>
      </ResourceState>
      {selection && (
        <ReviewDialog
          selection={selection}
          onClose={() => setSelection(null)}
          onReviewed={(decision) => {
            setRecorded(decision);
            setSelection(null);
            resource.refresh();
          }}
        />
      )}
    </>
  );
}

function AuditSection() {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<{ events: AuditEvent[] }>("/admin/audit");
  return (
    <ResourceState {...resource}>
      <section className="portal-panel">
        <div className="portal-actions">
          <h2>{zh ? "操作紀錄" : "Audit log"}</h2>
          <button
            type="button"
            className="portal-button-secondary"
            onClick={resource.refresh}
          >
            {zh ? "重新整理" : "Refresh"}
          </button>
        </div>
        <p className="portal-note">
          {zh
            ? "下列紀錄由伺服器提供，可核對操作人員、動作與目標。"
            : "Server-provided records identify the actor, action, and target of platform activity."}
        </p>
        {resource.data && resource.data.events.length > 0 ? (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <caption className="sr-only">
                {zh ? "平台操作紀錄" : "Platform activity records"}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{zh ? "時間" : "Time"}</th>
                  <th scope="col">{zh ? "操作人員" : "Actor"}</th>
                  <th scope="col">{zh ? "動作" : "Action"}</th>
                  <th scope="col">{zh ? "目標 ID" : "Target ID"}</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.events.map((event) => (
                  <tr key={event.id}>
                    <td>{dateLabel(event.createdAt, zh)}</td>
                    <td>
                      {event.actorEmail || (zh ? "未提供" : "Not provided")}
                    </td>
                    <td>{event.action}</td>
                    <td>{event.targetId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="portal-empty">
            {zh ? "尚無操作紀錄。" : "No audit events yet."}
          </p>
        )}
      </section>
    </ResourceState>
  );
}

export function AdminPortal({
  section = "overview",
}: {
  section?: AdminSection;
}) {
  const zh = useLocale().locale === "zh";
  const session = usePortalResource<{ user: PortalUser }>("/session");
  const navigation: {
    section: AdminSection;
    href: string;
    en: string;
    zh: string;
  }[] = [
    { section: "overview", href: "/admin", en: "Overview", zh: "總覽" },
    {
      section: "customers",
      href: "/admin/customers",
      en: "Customers",
      zh: "客戶",
    },
    { section: "keys", href: "/admin/keys", en: "API keys", zh: "金鑰" },
    { section: "usage", href: "/admin/usage", en: "Usage", zh: "用量" },
    { section: "gateway", href: "/admin/gateway", en: "Gateway", zh: "閘道" },
    {
      section: "credits",
      href: "/admin/credits",
      en: "Credit requests",
      zh: "儲值申請",
    },
    { section: "audit", href: "/admin/audit", en: "Audit log", zh: "操作紀錄" },
  ];
  const signedOut =
    session.error instanceof PortalError && session.error.status === 401;
  const forbidden =
    (session.error instanceof PortalError && session.error.status === 403) ||
    (session.data !== null && session.data.user.role !== "admin");
  const authorized = session.data?.user.role === "admin";
  return (
    <div className="admin-content">
      <h1 className="admin-content-title">
        {
          navigation.find((item) => item.section === section)?.[
            zh ? "zh" : "en"
          ]
        }
      </h1>
      {session.loading ? (
        <div className="portal-panel" role="status">
          <p>{zh ? "正在確認管理員權限…" : "Checking administrator access…"}</p>
        </div>
      ) : signedOut ? (
        <section className="portal-panel">
          <h2>
            {zh
              ? "請以管理員帳號登入"
              : "Sign in with an administrator account"}
          </h2>
          <p>
            {zh
              ? "登入後才可存取客戶資料與管理工具。"
              : "Sign in to access customer records and administration tools."}
          </p>
          <Link
            className="portal-button"
            href={`/login?next=${encodeURIComponent(navigation.find((item) => item.section === section)?.href ?? "/admin")}`}
          >
            {zh ? "登入" : "Sign in"}
          </Link>
        </section>
      ) : forbidden ? (
        <section className="portal-panel">
          <h2>
            {zh ? "此頁面僅供管理員使用" : "Administrator access required"}
          </h2>
          <p>
            {zh
              ? "目前帳號沒有管理後台權限。你仍可前往自己的帳戶。"
              : "This account does not have administration permissions. You can still access your own account."}
          </p>
          <Link className="portal-button" href="/account">
            {zh ? "前往我的帳戶" : "Go to your account"}
          </Link>
        </section>
      ) : session.error ? (
        <ResourceState {...session}>{null}</ResourceState>
      ) : authorized ? (
        <>
          {section === "overview" && <OverviewSection />}
          {section === "customers" && (
            <CustomersSection currentUserId={session.data?.user.id} />
          )}
          {section === "keys" && <AdminKeysSection />}
          {section === "usage" && <AdminUsageSection />}
          {section === "gateway" && <AdminGatewaySection />}
          {section === "credits" && <CreditsSection />}
          {section === "audit" && <AuditSection />}
        </>
      ) : null}
    </div>
  );
}
