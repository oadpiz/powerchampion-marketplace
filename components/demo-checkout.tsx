"use client";

import { useEffect, useRef, useState } from "react";
import { CREDIT_PACKS, type CreditPack } from "../lib/pricing";
import { useLocale } from "./locale-provider";

type CheckoutStep = "choose" | "review" | "complete";
type CheckoutEventDetail = {
  packId?: CreditPack["id"];
  restoreFocusTarget?: HTMLElement | null;
};

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

export function openCheckout(packId?: CreditPack["id"]) {
  window.dispatchEvent(new CustomEvent<CheckoutEventDetail>("powerchampion:checkout", {
    detail: packId ? { packId } : undefined,
  }));
}

export function DemoCheckout({ initialPack, open }: { initialPack?: CreditPack["id"]; open?: boolean }) {
  const { copy, locale } = useLocale();
  const [isOpen, setIsOpen] = useState(open ?? false);
  const [selectedPackId, setSelectedPackId] = useState<CreditPack["id"]>(initialPack ?? CREDIT_PACKS[0].id);
  const [step, setStep] = useState<CheckoutStep>("choose");
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const selectedPack = CREDIT_PACKS.find((pack) => pack.id === selectedPackId) ?? CREDIT_PACKS[0];
  const packLabels: Record<CreditPack["id"], string> = locale === "en"
    ? { starter: "Starter", builder: "Builder", scale: "Scale" }
    : { starter: "入門", builder: "建置", scale: "規模" };

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
      const { packId, restoreFocusTarget } = (event as CustomEvent<CheckoutEventDetail>).detail ?? {};
      triggerRef.current = restoreFocusTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setSelectedPackId(packId ?? CREDIT_PACKS[0].id);
      setStep("choose");
      setIsOpen(true);
    };

    window.addEventListener("powerchampion:checkout", handleCheckout);
    return () => window.removeEventListener("powerchampion:checkout", handleCheckout);
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
            {CREDIT_PACKS.map((pack) => (
              <button
                aria-pressed={selectedPackId === pack.id}
                className="checkout-pack"
                key={pack.id}
                onClick={() => setSelectedPackId(pack.id)}
                type="button"
              >
                <span>{packLabels[pack.id]}</span>
                <strong>${pack.price}</strong>
                <small>${pack.credit} {locale === "en" ? "account credit" : "帳戶額度"}</small>
              </button>
            ))}
          </div>
        )}
        {step === "review" && (
          <div className="checkout-review">
            <p>{packLabels[selectedPack.id]}</p>
            <dl>
              <div><dt>{locale === "en" ? "Showcase price" : "展示價格"}</dt><dd>${selectedPack.price.toFixed(2)}</dd></div>
              <div><dt>{locale === "en" ? "Account credit" : "帳戶額度"}</dt><dd>${selectedPack.credit.toFixed(2)}</dd></div>
              <div><dt>{locale === "en" ? "Showcase bonus" : "展示加碼"}</dt><dd>{selectedPack.bonusPercent}%</dd></div>
            </dl>
          </div>
        )}
        {step === "complete" && (
          <div className="checkout-complete" role="status">
            <h3>{copy.checkout.complete}</h3>
            <p>{locale === "en" ? "Your selected showcase credit is ready to review again whenever you reopen this demo." : "您選擇的展示額度已準備就緒；重新開啟此展示即可再次查看。"}</p>
          </div>
        )}
        <p className="checkout-disclaimer" id="checkout-disclaimer">{copy.checkout.demoOnly}</p>
        <div className="checkout-actions">
          {step === "review" && <button className="checkout-back" onClick={() => setStep("choose")} type="button">{copy.checkout.back}</button>}
          {step !== "complete" && <button className="token-button" onClick={continueCheckout} type="button">{copy.checkout.next}</button>}
          {step === "complete" && <button className="token-button" onClick={close} type="button">{copy.checkout.close}</button>}
        </div>
      </div>
    </div>
  );
}
