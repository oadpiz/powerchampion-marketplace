"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "./locale-provider";
import { useModalIsolation } from "./use-modal-isolation";

export type AccessInterestId = "developer" | "product" | "enterprise";

type AccessStep = "choose" | "review" | "complete";
type LaunchAccessEventDetail = {
  interestId?: AccessInterestId;
  restoreFocusTarget?: HTMLElement | null;
};

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

export function openLaunchAccess(interestId?: AccessInterestId) {
  window.dispatchEvent(new CustomEvent<LaunchAccessEventDetail>("powerchampion:launch-access", {
    detail: interestId ? { interestId } : undefined,
  }));
}

export function LaunchAccessDialog({ initialInterest, open }: { initialInterest?: AccessInterestId; open?: boolean }) {
  const { copy, locale } = useLocale();
  const [isOpen, setIsOpen] = useState(open ?? false);
  const [selectedInterestId, setSelectedInterestId] = useState<AccessInterestId>(initialInterest ?? "developer");
  const [step, setStep] = useState<AccessStep>("choose");
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const nextActionRef = useRef<HTMLButtonElement>(null);
  const completeCloseRef = useRef<HTMLButtonElement>(null);
  const previousStepRef = useRef<AccessStep>(step);

  useModalIsolation(isOpen, dialogRef);

  const interests: { id: AccessInterestId; label: string; detail: string }[] = locale === "en"
    ? [
      { id: "developer", label: "Developer exploration", detail: "Review the public catalog and integration preview." },
      { id: "product", label: "Product evaluation", detail: "Compare illustrative model and usage decisions." },
      { id: "enterprise", label: "Enterprise planning", detail: "Discuss future deployment review inputs." },
    ]
    : [
      { id: "developer", label: "開發者探索", detail: "檢視公開目錄與整合預覽。" },
      { id: "product", label: "產品評估", detail: "比較展示模型與用量決策。" },
      { id: "enterprise", label: "企業規劃", detail: "討論未來部署審查輸入。" },
    ];
  const selectedInterest = interests.find((interest) => interest.id === selectedInterestId) ?? interests[0];

  const close = () => {
    setIsOpen(false);
    setStep("choose");
    queueMicrotask(() => {
      const target = triggerRef.current;
      if (target?.isConnected) {
        target.focus();
      }
    });
  };

  useEffect(() => {
    const handleCheckout = (event: Event) => {
      const { interestId, restoreFocusTarget } = (event as CustomEvent<LaunchAccessEventDetail>).detail ?? {};
      triggerRef.current = restoreFocusTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setSelectedInterestId(interestId ?? "developer");
      setStep("choose");
      setIsOpen(true);
    };

    window.addEventListener("powerchampion:launch-access", handleCheckout);
    return () => window.removeEventListener("powerchampion:launch-access", handleCheckout);
  }, []);

  useEffect(() => {
    if (!isOpen || !dialogRef.current) {
      return;
    }

    const dialog = dialogRef.current;
    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    focusableElements()[0]?.focus();

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const elements = focusableElements();
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

  useEffect(() => {
    if (!isOpen) {
      previousStepRef.current = step;
      return;
    }

    if (previousStepRef.current !== step) {
      previousStepRef.current = step;
      (step === "complete" ? completeCloseRef : nextActionRef).current?.focus();
    }
  }, [isOpen, step]);

  if (!isOpen) {
    return null;
  }

  const continueCheckout = () => {
    setStep((current) => current === "choose" ? "review" : "complete");
  };

  return (
    <div className="checkout-backdrop">
      <div aria-describedby="checkout-disclaimer" aria-labelledby="checkout-title" aria-modal="true" className="demo-checkout" ref={dialogRef} role="dialog">
        <div className="checkout-header">
          <div>
            <p className="eyebrow">{copy.shared.illustrative}</p>
            <h2 id="checkout-title">{copy.checkout.title}</h2>
          </div>
          <button aria-label={copy.checkout.close} className="checkout-close" onClick={close} type="button">×</button>
        </div>
        <ol aria-label={copy.checkout.title} className="checkout-steps">
          <li aria-current={step === "choose" ? "step" : undefined}>{copy.checkout.choose}</li>
          <li aria-current={step === "review" ? "step" : undefined}>{copy.checkout.review}</li>
          <li aria-current={step === "complete" ? "step" : undefined}>{locale === "en" ? "Complete" : "完成"}</li>
        </ol>
        {step === "choose" && (
          <div className="checkout-pack-list">
            {interests.map((interest) => (
              <button
                aria-pressed={selectedInterestId === interest.id}
                className="checkout-pack"
                key={interest.id}
                onClick={() => setSelectedInterestId(interest.id)}
                type="button"
              >
                <span>{interest.label}</span>
                <small>{interest.detail}</small>
              </button>
            ))}
          </div>
        )}
        {step === "review" && (
          <div className="checkout-review">
            <p>{selectedInterest.label}</p>
            <dl>
              <div><dt>{locale === "en" ? "Interest" : "意向"}</dt><dd>{selectedInterest.label}</dd></div>
              <div><dt>{locale === "en" ? "Local handling" : "本機處理"}</dt><dd>{locale === "en" ? "Browser only" : "僅限瀏覽器"}</dd></div>
            </dl>
          </div>
        )}
        {step === "complete" && (
          <div className="checkout-complete" role="status">
            <h3>{copy.checkout.complete}</h3>
            <p>{copy.checkout.requestComplete}</p>
          </div>
        )}
        <p className="checkout-disclaimer" id="checkout-disclaimer">{copy.checkout.launchNotice}</p>
        <div className="checkout-actions">
          {step === "review" && <button className="checkout-back" onClick={() => setStep("choose")} type="button">{copy.checkout.back}</button>}
          {step !== "complete" && <button className="token-button" onClick={continueCheckout} ref={nextActionRef} type="button">{copy.checkout.next}</button>}
          {step === "complete" && <button className="token-button" onClick={close} ref={completeCloseRef} type="button">{copy.checkout.close}</button>}
        </div>
      </div>
    </div>
  );
}
