"use client";

import { useModalIsolation } from "./use-modal-isolation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import { useLocale } from "./locale-provider";

export type Customer = {
  id: string;
  email: string;
  name: string;
  role: "customer" | "admin";
  status: "active" | "disabled";
  createdAt: string | number;
  keyCount: number;
};
export type AccountAction = "disable" | "enable" | "role" | "reset-password";
export type AccountActionResult = { keysRevoked?: number; keysFailed?: number };

export function AccountActionDialog({
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

