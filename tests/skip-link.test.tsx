import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ConsolePage from "../app/console/page";
import DocsPage from "../app/docs/page";
import Home from "../app/page";
import ModelsPage from "../app/models/page";
import PricingPage from "../app/pricing/page";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

describe("skip navigation", () => {
  it("is localized and targets the main content landmark", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><main id="main-content">Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    await user.click(screen.getByRole("button", { name: "繁中" }));
    expect(screen.getByRole("link", { name: "跳至主要內容" })).toHaveAttribute("href", "#main-content");
  });

  it.each([
    ["home", Home],
    ["models", ModelsPage],
    ["pricing", PricingPage],
    ["docs", DocsPage],
    ["console", ConsolePage],
  ])("gives the %s route a stable main-content landmark", (_name, Page) => {
    render(<LocaleProvider><Page /></LocaleProvider>);
    expect(document.querySelector("main#main-content")).toBeInTheDocument();
  });
});
