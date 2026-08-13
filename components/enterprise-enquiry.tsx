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

export function EnterpriseEnquiry() {
  const { copy } = useLocale();
  const [enquiry, setEnquiry] = useState<EnquiryState>(initialEnquiry);
  const [validationError, setValidationError] = useState(false);
  const interestRef = useRef<HTMLSelectElement>(null);

  const submitEnquiry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!enquiry.interest) {
      setValidationError(true);
      interestRef.current?.focus();
      return;
    }

    setValidationError(false);
    setEnquiry((current) => ({ ...current, submitted: true }));
  };

  return (
    <section aria-labelledby="deployment-review-title" className="enterprise-enquiry">
      <div className="enquiry-intro">
        <p className="eyebrow">{copy.enquiry.kicker}</p>
        <h1 id="deployment-review-title">{copy.enquiry.title}</h1>
        <p>{copy.enquiry.lead}</p>
      </div>

      <form className="enquiry-form" noValidate onSubmit={submitEnquiry}>
        <label htmlFor="interest">{copy.enquiry.interestLabel}</label>
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
          <option value="">{copy.enquiry.interestPlaceholder}</option>
          <option value="launch-access">{copy.enquiry.launchAccess}</option>
          <option value="infrastructure">{copy.enquiry.infrastructure}</option>
          <option value="partnership">{copy.enquiry.partnership}</option>
        </select>
        {validationError && <p id="interest-error" role="alert">{copy.enquiry.interestRequired}</p>}

        <label htmlFor="message">{copy.enquiry.messageLabel}</label>
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
        <p id="message-hint">{copy.enquiry.messageHint}</p>

        <p className="enquiry-notice">{copy.enquiry.localNotice}</p>
        <button type="submit">{copy.enquiry.submit}</button>
        {enquiry.submitted && (
          <>
            <p role="status">{copy.enquiry.confirmation}</p>
            <p className="enquiry-notice">{copy.enquiry.localNotice}</p>
          </>
        )}
      </form>

      <a className="enquiry-company-link" href="/company">{copy.enquiry.companyLink}</a>
    </section>
  );
}
