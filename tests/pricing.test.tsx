import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DemoCheckout } from "../components/demo-checkout";
import { LocaleProvider } from "../components/locale-provider";
import { PricingCalculator } from "../components/pricing-calculator";

describe("PricingCalculator", () => {
  it("calculates the selected model estimate", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <PricingCalculator />
      </LocaleProvider>,
    );

    await user.selectOptions(screen.getByLabelText("Select a model"), "qwen");
    await user.clear(screen.getByLabelText("Input tokens"));
    await user.type(screen.getByLabelText("Input tokens"), "1000000");
    await user.clear(screen.getByLabelText("Output tokens"));
    await user.type(screen.getByLabelText("Output tokens"), "500000");

    expect(screen.getByText("$0.54")).toBeInTheDocument();
  });

  it("shows inline validation for a negative amount", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <PricingCalculator />
      </LocaleProvider>,
    );

    await user.clear(screen.getByLabelText("Input tokens"));
    await user.type(screen.getByLabelText("Input tokens"), "-1");

    expect(screen.getByText("Enter non-negative token amounts.")).toBeInTheDocument();
  });
});

describe("DemoCheckout", () => {
  it("finishes only in a clearly labelled demo state", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <DemoCheckout initialPack="builder" open />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Demo checkout complete")).toBeInTheDocument();
    expect(screen.getByText(/No payment or personal information/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
  });
});
