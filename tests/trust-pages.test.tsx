import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import FaqPage from "../app/faq/page";
import InfrastructurePage from "../app/infrastructure/page";
import PrivacyPage from "../app/privacy/page";
import StatusPage from "../app/status/page";
import TermsPage from "../app/terms/page";
import TrustPage from "../app/trust/page";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

function localized(ui: ReactNode) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe("public trust pages", () => {
  it("renders launch-safe policy and status routes", () => {
    localized(<StatusPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Launch preparation" })).toBeVisible();
    expect(screen.getByText("Inference API").closest("li")).toHaveTextContent("Not ready");
    expect(screen.queryByText(/all systems operational/i)).not.toBeInTheDocument();
  });

  it("offers accessible bilingual FAQ disclosures", async () => {
    const user = userEvent.setup();
    localized(<FaqPage />);
    const question = screen.getByRole("button", { name: /Can I buy tokens now/i });
    expect(question).toHaveAttribute("aria-expanded", "false");
    await user.click(question);
    expect(question).toHaveAttribute("aria-expanded", "true");
  });

  it.each([[<TermsPage key="terms" />, /does not create a purchase/i], [<PrivacyPage key="privacy" />, /does not transmit or persist/i]])(
    "preserves the launch boundary",
    (page, boundary) => {
      localized(page);
      expect(screen.getByText(boundary)).toBeVisible();
    },
  );

  it("renders the published infrastructure destination with release-gated stages", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><InfrastructurePage /></SiteShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /future delivery/i })).toBeVisible();
    expect(screen.getAllByText(/counterparty-reported expected hosting capacity; not live or completed deployment/i)).not.toHaveLength(0);
    expect(screen.getByText(/model serving remains release-gated/i)).toBeVisible();
    expect(screen.getByText(/public integration preview/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Deployment review" })).toHaveAttribute("href", "/contact");

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    expect(screen.getByRole("heading", { level: 1, name: /未來交付/i })).toBeVisible();
  });

  it("renders the trust evidence sections with policy and source links", () => {
    localized(<TrustPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Evidence before promises." })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Current data behavior" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Model provenance" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Release controls" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Policies and sources" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
    expect(screen.getByRole("link", { name: "Company" })).toHaveAttribute("href", "/company");
    expect(document.body).not.toHaveTextContent(/SOC 2|ISO|GDPR|uptime|availability/i);
  });
});
