import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import FaqPage from "../app/faq/page";
import PrivacyPage from "../app/privacy/page";
import StatusPage from "../app/status/page";
import TermsPage from "../app/terms/page";
import { LocaleProvider } from "../components/locale-provider";

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
});
