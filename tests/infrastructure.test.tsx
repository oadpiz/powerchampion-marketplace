import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InfrastructureContent } from "../components/infrastructure-content";
import { LocaleProvider } from "../components/locale-provider";

describe("InfrastructureContent", () => {
  it("qualifies infrastructure figures beside the source-backed facts", () => {
    render(<LocaleProvider><InfrastructureContent /></LocaleProvider>);
    const capacity = screen.getByRole("region", { name: /Capacity context/i });

    expect(within(capacity).getByText("Approximately 3.1 MW")).toBeVisible();
    expect(within(capacity).getByText(/not live or completed deployment/i)).toBeVisible();
    expect(within(capacity).getByRole("link", { name: /SEC-filed/i })).toHaveAttribute(
      "href",
      "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986209.htm",
    );
    expect(screen.getByRole("link", { name: "Deployment review" })).toHaveAttribute("href", "/contact");
  });

  it("does not turn expected capacity into an ownership or deployment claim", () => {
    render(<LocaleProvider><InfrastructureContent /></LocaleProvider>);

    expect(document.body).not.toHaveTextContent(/we own|our data centre|deployed 3\.1 MW/i);
  });
});
