import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ContactPage, { metadata } from "../app/contact/page";
import { EnterpriseEnquiry } from "../components/enterprise-enquiry";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

describe("EnterpriseEnquiry", () => {
  it("keeps deployment review local, action-free, and free of personal or payment fields", async () => {
    const user = userEvent.setup();
    render(<LocaleProvider><EnterpriseEnquiry /></LocaleProvider>);

    expect(screen.getByRole("option", { name: "Launch access" })).toHaveValue("launch-access");
    expect(screen.getByRole("option", { name: "Infrastructure planning" })).toHaveValue("infrastructure");
    expect(screen.getByRole("option", { name: "Model partnership" })).toHaveValue("partnership");
    expect(screen.getByText(/No information is transmitted or persisted/i)).toBeVisible();
    expect(document.querySelector("form")).not.toHaveAttribute("action");
    expect(screen.getByLabelText("I am interested in")).toHaveAttribute("name", "deployment-interest");
    expect(screen.getByLabelText("I am interested in")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("Optional context")).toHaveAttribute("name", "deployment-context");
    expect(screen.getByLabelText("Optional context")).toHaveAttribute("autocomplete", "off");
    expect(screen.queryByLabelText(/email|phone|address|card|password|API key|company.registration/i))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit deployment review" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose an interest area.");
    expect(screen.getByLabelText("I am interested in")).toHaveFocus();

    await user.selectOptions(screen.getByLabelText("I am interested in"), "launch-access");
    await user.click(screen.getByRole("button", { name: "Submit deployment review" }));

    expect(screen.getByRole("status")).toHaveTextContent("Nothing was sent or reserved.");
    expect(screen.getAllByText(/No information is transmitted or persisted/i)).toHaveLength(2);
  });

  it("localizes validation and the local-only completion in Traditional Chinese", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><EnterpriseEnquiry /></SiteShell>
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    await user.click(screen.getByRole("button", { name: "送出部署審查" }));
    expect(screen.getByRole("alert")).toHaveTextContent("請選擇洽詢類型。");

    await user.selectOptions(screen.getByLabelText("我想洽詢"), "partnership");
    await user.click(screen.getByRole("button", { name: "送出部署審查" }));
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
  it("has deployment-review metadata and a stable main landmark", () => {
    render(<LocaleProvider><ContactPage /></LocaleProvider>);

    expect(metadata).toMatchObject({
      title: "Deployment review | Power Champion",
      description: expect.stringMatching(/deployment/i),
    });
    expect(metadata.description).not.toMatch(/\$|\d+(?:\.\d+)?\s*(?:M|MW|USD|US\$)/i);
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 }))
      .toHaveTextContent("Deployment review");
  });
});
