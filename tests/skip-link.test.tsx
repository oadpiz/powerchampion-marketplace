import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ConsolePage from "../app/console/page";
import { DocsPageContent } from "../components/docs-page-content";
import { HomeContent } from "../components/home-content";
import { LocaleProvider } from "../components/locale-provider";
import { ModelsPageContent } from "../components/models-page-content";
import { PricingPageContent } from "../components/pricing-page-content";
import { SiteShell } from "../components/site-shell";
import { SNAPSHOT_CATALOG } from "../lib/models";

describe("skip navigation", () => {
  it("is localized and targets the main content landmark", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><main id="main-content">Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("link", { name: "Skip to main content" })).toHaveAttribute("href", "#main-content");
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    expect(screen.getByRole("link", { name: "跳至主要內容" })).toHaveAttribute("href", "#main-content");
  });

  it.each([
    ["home", () => <HomeContent models={SNAPSHOT_CATALOG} snapshotDate={null} />],
    ["models", () => <ModelsPageContent models={SNAPSHOT_CATALOG} snapshotDate={null} />],
    ["pricing", () => <PricingPageContent models={SNAPSHOT_CATALOG} snapshotDate={null} />],
    ["docs", () => <DocsPageContent gateway={null} models={SNAPSHOT_CATALOG} />],
    ["console", ConsolePage],
  ])("gives the %s route a stable main-content landmark", (_name, Page) => {
    render(<LocaleProvider><Page /></LocaleProvider>);
    expect(document.querySelector("main#main-content")).toBeInTheDocument();
  });
});
