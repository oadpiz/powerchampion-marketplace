"use client";

import { useModalIsolation } from "./use-modal-isolation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { portalRequest } from "../lib/portal-client";
import { useLocale } from "./locale-provider";
import {
  ResourceState,
  dateLabel,
  errorMessage,
  usePortalResource,
} from "./admin-resource";

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

export function CreditsSection() {
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

