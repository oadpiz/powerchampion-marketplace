"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "./locale-provider";

type Interest = "" | "infrastructure" | "partnership";

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

  const submitEnquiry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!enquiry.interest) {
      setValidationError(true);
      return;
    }

    setValidationError(false);
    setEnquiry((current) => ({ ...current, submitted: true }));
  };

  return (
    <section aria-labelledby="enterprise-enquiry-title" className="enterprise-enquiry">
      <div className="enquiry-intro">
        <p className="eyebrow">{copy.enquiry.kicker}</p>
        <h1 id="enterprise-enquiry-title">{copy.enquiry.title}</h1>
        <p>{copy.enquiry.lead}</p>
      </div>

      <form className="enquiry-form" noValidate onSubmit={submitEnquiry}>
        <label htmlFor="interest">{copy.enquiry.interestLabel}</label>
        <select
          id="interest"
          onChange={(event) => {
            setValidationError(false);
            setEnquiry((current) => ({
              ...current,
              interest: event.target.value as Interest,
              submitted: false,
            }));
          }}
          value={enquiry.interest}
        >
          <option value="">{copy.enquiry.interestPlaceholder}</option>
          <option value="infrastructure">{copy.enquiry.infrastructure}</option>
          <option value="partnership">{copy.enquiry.partnership}</option>
        </select>
        {validationError && <p role="alert">{copy.enquiry.interestRequired}</p>}

        <label htmlFor="message">{copy.enquiry.messageLabel}</label>
        <textarea
          aria-describedby="message-hint"
          id="message"
          onChange={(event) => {
            setEnquiry((current) => ({ ...current, message: event.target.value, submitted: false }));
          }}
          value={enquiry.message}
        />
        <p id="message-hint">{copy.enquiry.messageHint}</p>

        <button type="submit">{copy.enquiry.submit}</button>
        {enquiry.submitted && <p role="status">{copy.enquiry.confirmation}</p>}
      </form>

      <p className="enquiry-notice">{copy.enquiry.localNotice}</p>
      <a className="enquiry-company-link" href="/company">{copy.enquiry.companyLink}</a>
    </section>
  );
}
