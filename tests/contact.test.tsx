import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContactPage, { metadata } from "../app/contact/page";
import { EnterpriseEnquiry } from "../components/enterprise-enquiry";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location")!;
beforeEach(() => act(() => window.history.replaceState({}, "", "/contact")));
afterEach(() => {
  Object.defineProperty(window, "location", locationDescriptor);
  act(() => window.history.replaceState({}, "", "/"));
});

function captureEmailDraftNavigation() {
  const locationSpy = vi.fn();
  const originalHref = window.location.href;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, set href(value: string) { locationSpy(value); }, get href() { return originalHref; } },
  });
  return locationSpy;
}

describe("EnterpriseEnquiry", () => {
  it("builds a real mailto enquiry with the chosen topic and context", async () => {
    const user = userEvent.setup();
    const locationSpy = captureEmailDraftNavigation();
    render(<LocaleProvider><EnterpriseEnquiry /></LocaleProvider>);

    expect(screen.getByRole("option", { name: "API access" })).toHaveValue("launch-access");
    expect(screen.getByRole("option", { name: "Infrastructure planning" })).toHaveValue("infrastructure");
    expect(screen.getByRole("option", { name: "Model partnership" })).toHaveValue("partnership");
    expect(screen.queryByLabelText(/card|password/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open email draft" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a topic first.");
    expect(screen.getByLabelText("I am interested in")).toHaveFocus();

    await user.selectOptions(screen.getByLabelText("I am interested in"), "partnership");
    await user.type(screen.getByLabelText(/Context/), "We need vision models.");
    await user.click(screen.getByRole("button", { name: "Open email draft" }));

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(locationSpy).toHaveBeenCalledTimes(1);
    const href = locationSpy.mock.calls[0][0] as string;
    expect(href).toMatch(/^mailto:info@powerchampion\.org\?/);
    expect(decodeURIComponent(href)).toContain("Model partnership");
    expect(decodeURIComponent(href)).toContain("We need vision models.");
  });

  it("localizes validation and completion in Traditional Chinese", async () => {
    const user = userEvent.setup();
    const locationSpy = captureEmailDraftNavigation();
    render(
      <LocaleProvider>
        <SiteShell><EnterpriseEnquiry /></SiteShell>
      </LocaleProvider>,
    );

    const header = within(screen.getByRole("banner"));
    await user.click(header.getByRole("button", { name: "Language: English" }));
    await user.click(header.getByRole("button", { name: "繁體中文" }));
    await user.click(screen.getByRole("button", { name: "開啟 email 草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("請先選擇主題。");

    expect(screen.getByRole("option", { name: "智能體客製開發" })).toHaveValue("agent-development");
    await user.selectOptions(screen.getByLabelText("我想洽詢"), "agent-development");
    await user.click(screen.getByRole("button", { name: "開啟 email 草稿" }));
    expect(screen.getByRole("status")).toHaveTextContent("email 草稿正在開啟");
    expect(locationSpy).toHaveBeenCalledWith(expect.stringMatching(/^mailto:info@powerchampion\.org\?/));
    expect(decodeURIComponent(locationSpy.mock.calls[0][0] as string)).toContain("智能體客製開發");
  });

  it("prepares a custom agent enquiry only when the visitor opens the email draft", async () => {
    const user = userEvent.setup();
    const locationSpy = captureEmailDraftNavigation();
    render(<LocaleProvider><EnterpriseEnquiry /></LocaleProvider>);

    expect(screen.getByRole("option", { name: "Custom agent development" })).toHaveValue("agent-development");
    await user.selectOptions(screen.getByLabelText("I am interested in"), "agent-development");
    await user.type(screen.getByLabelText(/Context/), "Help our team prepare research briefs.");
    expect(locationSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open email draft" }));
    expect(locationSpy).toHaveBeenCalledTimes(1);
    const draft = new URL(locationSpy.mock.calls[0][0] as string);
    expect(draft.protocol).toBe("mailto:");
    expect(draft.pathname).toBe("info@powerchampion.org");
    expect(draft.searchParams.get("body")).toBe("Custom agent development\n\nHelp our team prepare research briefs.");
  });

  it("offers an optional context field", () => {
    render(<LocaleProvider><EnterpriseEnquiry /></LocaleProvider>);

    expect(screen.getByLabelText(/Context/)).not.toHaveAttribute("required");
    expect(screen.getByLabelText(/Context/)).toHaveAttribute("name", "deployment-context");
  });
});

describe("ContactPage", () => {
  it("has contact metadata and a stable main landmark", () => {
    render(<LocaleProvider><ContactPage /></LocaleProvider>);

    expect(metadata).toMatchObject({
      title: expect.stringContaining("Power Champion"),
    });
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
