"use client";

import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { useModalIsolation } from "./use-modal-isolation";

/**
 * Shared modal shell for administration dialogs: focus trap, Esc to close,
 * focus restore, and a lock while a request is in flight. It mirrors the
 * behaviour of `AccountActionDialog` in admin-portal.tsx.
 */
export function AdminDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  inFlight = false,
  danger = false,
  dismissible = true,
  extraActions,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Omit to render no cancel button (for the show-once secret dialog). */
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  inFlight?: boolean;
  danger?: boolean;
  /** When false, Esc does not close the dialog (the secret must be acknowledged). */
  dismissible?: boolean;
  extraActions?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const inFlightRef = useRef(inFlight);
  const dismissibleRef = useRef(dismissible);
  const titleId = useId();
  useEffect(() => {
    closeRef.current = onClose;
    inFlightRef.current = inFlight;
    dismissibleRef.current = dismissible;
  });
  useModalIsolation(true, dialogRef);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const initial =
      dialog?.querySelector<HTMLElement>(
        "input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
      ) ??
      dialog?.querySelector<HTMLElement>("button[data-dialog-cancel]") ??
      dialog?.querySelector<HTMLElement>("button:not(:disabled)");
    initial?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!inFlightRef.current && dismissibleRef.current) closeRef.current();
      }
      if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
        );
        if (!focusable?.length) {
          event.preventDefault();
          dialogRef.current?.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
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
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    onConfirm();
  }

  return (
    <div className="portal-dialog-backdrop">
      <div
        ref={dialogRef}
        className="portal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        <form onSubmit={submit}>
          {children}
          <div className="portal-actions">
            {cancelLabel !== undefined && (
              <button
                type="button"
                data-dialog-cancel=""
                className="portal-button-secondary"
                disabled={inFlight}
                onClick={onClose}
              >
                {cancelLabel}
              </button>
            )}
            {extraActions}
            <button
              type="submit"
              className={danger ? "portal-button portal-button-danger" : "portal-button"}
              disabled={inFlight}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
