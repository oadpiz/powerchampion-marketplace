import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import FaqPage from "../app/faq/page";
import PrivacyPage from "../app/privacy/page";
import TermsPage from "../app/terms/page";
import { InfrastructureContent } from "../components/infrastructure-content";
import { LiveStatusContent } from "../components/live-status-content";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";
import { TrustContent } from "../components/trust-content";
import type { GatewayStatus } from "../lib/gateway-status";

function gatewayWith(status: GatewayStatus["status"]): GatewayStatus {
  return {
    status,
    summary: status,
    updated: 0,
    uptime_window_days: 1,
    models: [{ id: "m", name: "m", ready: status === "ok", context_length: null, uptime: null }],
  };
}

function localized(ui: ReactNode) {
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}

describe("public trust pages", () => {
  it("renders launch-safe policy and status routes", () => {
    // Simulate the server component's offline fallback: gateway unreachable,
    // backend readiness rows must show "Not verified" — not "Ready".
    localized(<LiveStatusContent gateway={null} fetchedAt={0} />);
    expect(screen.getByRole("heading", { level: 1, name: "Service status" })).toBeVisible();
    expect(screen.getByText("Inference API").closest("li")).toHaveTextContent("Not verified");
    expect(screen.getByText("Payments").closest("li")).toHaveTextContent("Not verified");
    expect(screen.queryByText(/all systems operational/i)).not.toBeInTheDocument();
    expect(screen.getByText(/unreachable/i)).toBeVisible();
  });

  it("reports a gateway outage as not-ready, never a surviving ready claim", () => {
    localized(<LiveStatusContent gateway={gatewayWith("down")} fetchedAt={0} />);
    expect(screen.getByText("Inference API").closest("li")).toHaveTextContent("Not ready");
  });

  it("reports gateway ok as ready while payments stay unverified", () => {
    localized(<LiveStatusContent gateway={gatewayWith("ok")} fetchedAt={0} />);
    expect(screen.getByText("Inference API").closest("li")).toHaveTextContent("Ready");
    expect(screen.getByText("Payments").closest("li")).toHaveTextContent("Not verified");
    expect(screen.getByText("Usage accounting").closest("li")).toHaveTextContent("Not verified");
  });

  it("offers accessible bilingual FAQ disclosures", async () => {
    const user = userEvent.setup();
    localized(<FaqPage />);
    const question = screen.getByRole("button", { name: /Can I buy tokens now/i });
    expect(question).toHaveAttribute("aria-expanded", "false");
    await user.click(question);
    expect(question).toHaveAttribute("aria-expanded", "true");
  });

  it.each([[<TermsPage key="terms" />, /commercial terms for API usage are formed when a key is issued/i], [<PrivacyPage key="terms" />, /forwarded through this site.*fixed Power Champion gateway/i]])(
    "preserves the live-service boundary",
    (page, boundary) => {
      localized(page);
      expect(screen.getByText(boundary)).toBeVisible();
    },
  );

  it("renders the published infrastructure stages without unverified live claims", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><InfrastructureContent gateway={null} /></SiteShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /Compute, shaped around your workload/i })).toBeVisible();
    expect(screen.getAllByText(/counterparty-reported expected hosting capacity; not live or completed deployment/i)).not.toHaveLength(0);
    // Serving availability is reported as measured/unverified, not claimed live.
    expect(screen.getByText(/measured live by the b300 gateway/i)).toBeVisible();
    expect(screen.getByText(/deployed at b300\.powerchampion\.ai/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Deployment review" })).toHaveAttribute("href", "/contact");

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    expect(screen.getByRole("heading", { level: 1, name: /從工作負載出發，規劃合適算力/i })).toBeVisible();
  });

  it("renders the trust evidence sections with policy and source links", () => {
    localized(<TrustContent gateway={null} />);

    expect(screen.getByRole("heading", { level: 1, name: "Evidence before promises." })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Current data behavior" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Model provenance" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Release controls" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Policies and sources" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
    expect(screen.getByRole("link", { name: "Company" })).toHaveAttribute("href", "/company");
    expect(document.body).not.toHaveTextContent(/\b(?:SOC 2|ISO|GDPR|uptime|availability)\b/i);
  });

  it("renders distinguishable localized service-name and state pairs without duplicate React keys", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      render(<LocaleProvider><SiteShell><TrustContent gateway={gatewayWith("ok")} /></SiteShell></LocaleProvider>);

      for (const [name, state] of [
        ["Provider manifest", "Not verified"],
        ["Inference API", "Ready"],
        ["Payments", "Not verified"],
      ]) {
        const row = screen.getByRole("listitem", { name: `${name}: ${state}` });
        expect(row).toHaveTextContent(`${name} — ${state}`);
      }

      await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);
      for (const [name, state] of [
        ["供應商 Manifest", "未驗證"],
        ["推論 API", "已就緒"],
        ["付款", "未驗證"],
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
