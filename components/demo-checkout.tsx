"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "./locale-provider";
import { useModalIsolation } from "./use-modal-isolation";

export type AccessInterestId = "developer" | "product" | "enterprise";

type LaunchAccessEventDetail = {
  interestId?: AccessInterestId;
  restoreFocusTarget?: HTMLElement | null;
};

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

const ACCESS_EMAIL = "info@powerchampion.org";

export function openLaunchAccess(interestId?: AccessInterestId) {
  window.dispatchEvent(new CustomEvent<LaunchAccessEventDetail>("powerchampion:launch-access", {
    detail: interestId ? { interestId } : undefined,
  }));
}

export function LaunchAccessDialog({ initialInterest, open }: { initialInterest?: AccessInterestId; open?: boolean }) {
  const { locale } = useLocale();
  const [isOpen, setIsOpen] = useState(open ?? false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useModalIsolation(isOpen, dialogRef);

  const text = locale === "en" ? {
    eyebrow: "API access",
    title: "Get your API key",
    lead: "Keys are issued per customer with prepaid balance. Tell us what you plan to build and we will set you up.",
    stepsTitle: "How access works",
    steps: [
      { title: "Request a key", detail: "Email us with your intended use case. We reply with your key and top-up instructions." },
      { title: "Top up balance", detail: "Prepaid balance with nano-USD precision. Add credit with redeem codes." },
      { title: "Start building", detail: "One OpenAI-compatible endpoint — review the quick start while you wait." },
    ],
    mailtoSubject: "API access request — Power Champion",
    mailtoBody: "Hello,\n\nI would like to request an API key.\n\nIntended use case: \nExpected volume (tokens/month): \n\nThank you.",
    cta: "Email info@powerchampion.org",
    docs: "Read the quick start",
    close: "Close",
  } : {
    eyebrow: "API 存取",
    title: "取得你的 API Key",
    lead: "Keys 以客戶為單位發放，採預付儲值制。告訴我們你打算建造什麼，我們會為你設定。",
    stepsTitle: "存取流程",
    steps: [
      { title: "申請 Key", detail: "Email 告知你的使用情境，我們會回覆 Key 與儲值說明。" },
      { title: "儲值", detail: "預付餘額，nano-USD 精度。使用 redeem code 加值。" },
      { title: "開始建造", detail: "單一 OpenAI 相容端點——等待期間可先看快速開始文件。" },
    ],
    mailtoSubject: "API 存取申請 — Power Champion",
    mailtoBody: "你好，\n\n我想申請 API Key。\n\n使用情境：\n預估用量（tokens/月）：\n\n謝謝。",
    cta: "Email info@powerchampion.org",
    docs: "閱讀快速開始",
    close: "關閉",
  };

  const mailtoHref = `mailto:${ACCESS_EMAIL}?subject=${encodeURIComponent(text.mailtoSubject)}&body=${encodeURIComponent(text.mailtoBody)}`;

  const close = () => {
    setIsOpen(false);
    queueMicrotask(() => {
      const target = triggerRef.current;
      if (target?.isConnected) {
        target.focus();
      }
    });
  };

  useEffect(() => {
    const handleCheckout = (event: Event) => {
      const { restoreFocusTarget } = (event as CustomEvent<LaunchAccessEventDetail>).detail ?? {};
      triggerRef.current = restoreFocusTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setIsOpen(true);
    };

    window.addEventListener("powerchampion:launch-access", handleCheckout);
    return () => window.removeEventListener("powerchampion:launch-access", handleCheckout);
  }, []);

  useEffect(() => {
    if (!isOpen || !dialogRef.current) {
      return;
    }

    closeRef.current?.focus();

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) return;
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) {
        return;
      }

      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="checkout-backdrop">
      <div aria-labelledby="checkout-title" aria-modal="true" className="demo-checkout access-dialog" ref={dialogRef} role="dialog">
        <div className="checkout-header">
          <div>
            <p className="eyebrow">{text.eyebrow}</p>
            <h2 id="checkout-title">{text.title}</h2>
          </div>
          <button aria-label={text.close} className="checkout-close" onClick={close} ref={closeRef} type="button">×</button>
        </div>
        <p className="access-lead">{text.lead}</p>
        <div className="access-steps">
          <h3>{text.stepsTitle}</h3>
          <ol>
            {text.steps.map((step, i) => (
              <li key={i}>
                <span aria-hidden="true" className="access-step-number">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="checkout-actions access-actions">
          <a className="token-button access-mailto" href={mailtoHref}>{text.cta}</a>
          <a className="access-docs-link" href="/docs">{text.docs} →</a>
        </div>
      </div>
    </div>
  );
}
