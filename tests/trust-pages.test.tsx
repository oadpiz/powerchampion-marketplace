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

  it("renders the published infrastructure destination as a localized preparation shell", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><InfrastructurePage /></SiteShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Infrastructure preparation" })).toBeVisible();
    expect(screen.getByText(/counterparty-reported expected hosting capacity; not live or completed deployment/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Company context" })).toHaveAttribute("href", "/company");
    expect(screen.getByRole("link", { name: "Deployment review" })).toHaveAttribute("href", "/contact");

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    expect(screen.getByRole("heading", { level: 1, name: "基礎設施準備中" })).toBeVisible();
  });

  it("renders the published trust destination with only current review links", () => {
    localized(<TrustPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Trust review preparation" })).toBeVisible();
    expect(screen.getByText(/detailed trust review is in preparation/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
    expect(screen.getByRole("link", { name: "Company" })).toHaveAttribute("href", "/company");
    expect(screen.getByRole("link", { name: "Deployment review" })).toHaveAttribute("href", "/contact");
  });
});
