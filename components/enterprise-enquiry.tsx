"use client";

import { useRef, useState, type FormEvent } from "react";
import { useLocale } from "./locale-provider";

type Interest = "" | "launch-access" | "infrastructure" | "partnership";

type EnquiryState = {
  interest: Interest;
  message: string;
  submitted: boolean;
};

const initialEnquiry: EnquiryState = {
  interest: "",
  message: "",
  submitted: false,
};

const ENQUIRY_EMAIL = "info@powerchampion.org";

export function EnterpriseEnquiry() {
  const { locale } = useLocale();
  const [enquiry, setEnquiry] = useState<EnquiryState>(initialEnquiry);
  const [validationError, setValidationError] = useState(false);
  const interestRef = useRef<HTMLSelectElement>(null);

  const text = locale === "en" ? {
    interestLabel: "I am interested in",
    interestPlaceholder: "Choose a topic",
    launchAccess: "API access",
    infrastructure: "Infrastructure planning",
    partnership: "Model partnership",
    messageLabel: "Context (optional)",
    submit: "Open email draft",
    interestRequired: "Choose a topic first.",
    confirmation: "Your email draft is opening. If nothing happened, write to " + ENQUIRY_EMAIL + " directly.",
    mailtoSubject: "Enquiry — Power Champion",
  } : {
    interestLabel: "我想洽詢",
    interestPlaceholder: "選擇主題",
    launchAccess: "API 存取",
    infrastructure: "基礎設施規劃",
    partnership: "模型合作",
    messageLabel: "補充說明（選填）",
    submit: "開啟 email 草稿",
    interestRequired: "請先選擇主題。",
    confirmation: "email 草稿正在開啟。若沒有反應，請直接寄信到 " + ENQUIRY_EMAIL + "。",
    mailtoSubject: "洽詢 — Power Champion",
  };

  const submitEnquiry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!enquiry.interest) {
      setValidationError(true);
      interestRef.current?.focus();
      return;
    }

    setValidationError(false);
    setEnquiry((current) => ({ ...current, submitted: true }));

    const interestCopy: Record<Exclude<Interest, "">, string> = locale === "en"
      ? { "launch-access": text.launchAccess, "infrastructure": text.infrastructure, "partnership": text.partnership }
      : { "launch-access": text.launchAccess, "infrastructure": text.infrastructure, "partnership": text.partnership };
    const body = `${interestCopy[enquiry.interest]}\n\n${enquiry.message}`.trim();
    const href = `mailto:${ENQUIRY_EMAIL}?subject=${encodeURIComponent(text.mailtoSubject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  };

  return (
    <section aria-labelledby="deployment-review-title" className="enterprise-enquiry">
      <div className="enquiry-intro">
        <p className="eyebrow">{locale === "en" ? "Contact" : "聯絡"}</p>
        <h1 id="deployment-review-title">{locale === "en" ? "Talk to us" : "與我們聯絡"}</h1>
        <p>{locale === "en"
          ? "Pick a topic and add context — we reply by email. For API keys, use “Get API access” for a prefilled request."
          : "選擇主題並補充背景 — 我們會以 email 回覆。若要申請 API 金鑰，可用「取得 API 存取」的預填申請。"}</p>
        <p className="enquiry-privacy">{locale === "en"
          ? "No information is transmitted or persisted until you send the email yourself."
          : "在你自行寄出 email 之前，不會有任何資訊被傳輸或儲存。"}</p>
      </div>

      <form className="enquiry-form" noValidate onSubmit={submitEnquiry}>
        <label htmlFor="interest">{text.interestLabel}</label>
        <select
          aria-describedby={validationError ? "interest-error" : undefined}
          aria-invalid={validationError}
          autoComplete="off"
          id="interest"
          name="deployment-interest"
          onChange={(event) => {
            setValidationError(false);
            setEnquiry((current) => ({
              ...current,
              interest: event.target.value as Interest,
              submitted: false,
            }));
          }}
          ref={interestRef}
          value={enquiry.interest}
        >
          <option value="">{text.interestPlaceholder}</option>
          <option value="launch-access">{text.launchAccess}</option>
          <option value="infrastructure">{text.infrastructure}</option>
          <option value="partnership">{text.partnership}</option>
        </select>
        {validationError && <p id="interest-error" role="alert">{text.interestRequired}</p>}

        <label htmlFor="message">{text.messageLabel}</label>
        <textarea
          aria-describedby="message-hint"
          autoComplete="off"
          id="message"
          name="deployment-context"
          onChange={(event) => {
            setEnquiry((current) => ({ ...current, message: event.target.value, submitted: false }));
          }}
          value={enquiry.message}
        />
        <p id="message-hint">{locale === "en" ? "Optional — included in the email draft." : "選填 — 會帶入 email 草稿。"}</p>

        <button type="submit">{text.submit}</button>
        {enquiry.submitted && (
          <p role="status">{text.confirmation}</p>
        )}
      </form>
    </section>
  );
}
