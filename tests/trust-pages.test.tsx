import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import FaqPage from "../app/faq/page";
import InfrastructurePage from "../app/infrastructure/page";
import PrivacyPage from "../app/privacy/page";
import TermsPage from "../app/terms/page";
import TrustPage from "../app/trust/page";
import { LiveStatusContent } from "../components/live-status-content";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

function localized(ui: ReactNode) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe("public trust pages", () => {
  it("renders launch-safe policy and status routes", () => {
    // Simulate the server component's offline fallback: gateway unreachable,
    // static readiness rows still render.
    localized(<LiveStatusContent gateway={null} fetchedAt={0} />);
    expect(screen.getByRole("heading", { level: 1, name: "Service status" })).toBeVisible();
    expect(screen.getByText("Inference API").closest("li")).toHaveTextContent("Ready");
    expect(screen.queryByText(/all systems operational/i)).not.toBeInTheDocument();
    expect(screen.getByText(/unreachable/i)).toBeVisible();
  });

  it("offers accessible bilingual FAQ disclosures", async () => {
    const user = userEvent.setup();
    localized(<FaqPage />);
    const question = screen.getByRole("button", { name: /Can I buy tokens now/i });
    expect(question).toHaveAttribute("aria-expanded", "false");
    await user.click(question);
    expect(question).toHaveAttribute("aria-expanded", "true");
  });

  it.each([[<TermsPage key="terms" />, /commercial terms for API usage are formed when a key is issued/i], [<PrivacyPage key="privacy" />, /never stored or logged by this site/i]])(
    "preserves the live-service boundary",
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

  it("renders distinguishable localized service-name and state pairs without duplicate React keys", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(<LocaleProvider><SiteShell><TrustPage /></SiteShell></LocaleProvider>);

      for (const [name, state] of [
        ["Provider manifest", "Ready"],
        ["Inference API", "Ready"],
        ["Payments", "Ready"],
      ]) {
        const row = screen.getByRole("listitem", { name: `${name}: ${state}` });
        expect(row).toHaveTextContent(`${name} — ${state}`);
      }

      await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);
      for (const [name, state] of [
        ["供應商 Manifest", "已就緒"],
        ["推論 API", "已就緒"],
        ["付款", "已就緒"],
      ]) {
        const row = screen.getByRole("listitem", { name: `${name}：${state}` });
        expect(row).toHaveTextContent(`${name} — ${state}`);
      }
      expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
    } finally {
      consoleError.mockRestore();
    }
  });
});
