import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ContactPage, { metadata } from "../app/contact/page";
import { EnterpriseEnquiry } from "../components/enterprise-enquiry";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

describe("EnterpriseEnquiry", () => {
  it("keeps enterprise enquiries local and payment-free", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><EnterpriseEnquiry /></LocaleProvider>);

    await user.click(screen.getByRole("button", { name: "Send enquiry" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose an interest area.");

    await user.selectOptions(screen.getByLabelText("I am interested in"), "infrastructure");
    await user.click(screen.getByRole("button", { name: "Send enquiry" }));

    expect(screen.getByRole("status")).toHaveTextContent("Nothing was sent or reserved.");
    expect(screen.queryByLabelText(/card|bank|email|password/i)).not.toBeInTheDocument();
  });

  it("localizes validation and the local-only completion in Traditional Chinese", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><EnterpriseEnquiry /></SiteShell>
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    await user.click(screen.getByRole("button", { name: "送出洽詢" }));
    expect(screen.getByRole("alert")).toHaveTextContent("請選擇洽詢類型。");

    await user.selectOptions(screen.getByLabelText("我想洽詢"), "partnership");
    await user.click(screen.getByRole("button", { name: "送出洽詢" }));
    expect(screen.getByRole("status")).toHaveTextContent("未傳送或保留任何資訊。");
  });

  it("offers an optional message and one descriptive Company link", () => {
    render(<LocaleProvider><EnterpriseEnquiry /></LocaleProvider>);

    expect(screen.getByLabelText("Optional context")).not.toHaveAttribute("required");
    expect(screen.getByRole("link", { name: "Read our public company context" }))
      .toHaveAttribute("href", "/company");
  });
});

describe("ContactPage", () => {
  it("has launch-only metadata and a stable main landmark", () => {
    render(<LocaleProvider><ContactPage /></LocaleProvider>);

    expect(metadata).toMatchObject({
      title: "Contact | Power Champion",
      description: expect.stringMatching(/launch/i),
    });
    expect(metadata.description).not.toMatch(/\$|\d+(?:\.\d+)?\s*(?:M|MW|USD|US\$)/i);
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 }))
      .toHaveTextContent("Enterprise enquiry");
  });
});
