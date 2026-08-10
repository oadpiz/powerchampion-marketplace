import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import PricingPage from "../app/pricing/page";
import { DemoCheckout, openCheckout } from "../components/demo-checkout";
import { LocaleProvider } from "../components/locale-provider";
import { PricingCalculator } from "../components/pricing-calculator";
import { SiteShell } from "../components/site-shell";
import { MODEL_CATALOG } from "../lib/models";

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

  it("rejects non-finite token text with alert semantics", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <PricingCalculator />
      </LocaleProvider>,
    );

    await user.clear(screen.getByLabelText("Input tokens"));
    await user.type(screen.getByLabelText("Input tokens"), "Infinity");

    expect(screen.getByRole("alert")).toHaveTextContent("Enter non-negative token amounts.");
    expect(screen.queryByText("Estimated cost")).not.toBeInTheDocument();
  });

  it("announces valid estimates politely", () => {
    render(
      <LocaleProvider>
        <PricingCalculator />
      </LocaleProvider>,
    );

    expect(screen.getByText("Estimated cost").parentElement).toHaveAttribute("aria-live", "polite");
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

  it("opens the pack selected by the checkout event", () => {
    render(
      <LocaleProvider>
        <DemoCheckout />
      </LocaleProvider>,
    );

    act(() => openCheckout("scale"));

    expect(screen.getByRole("dialog", { name: "Add Power credit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Scale/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("resets to pack selection after close", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <DemoCheckout open />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Review demo order")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    act(() => openCheckout());

    const steps = within(screen.getByRole("list", { name: "Add Power credit" })).getAllByRole("listitem");
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(steps[1]).not.toHaveAttribute("aria-current");
  });

  it("contains Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <DemoCheckout open />
      </LocaleProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Add Power credit" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    const continueButton = within(dialog).getByRole("button", { name: "Continue" });
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(continueButton).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("takes checkout step typography from the stylesheet rather than an inline override", () => {
    render(
      <LocaleProvider>
        <DemoCheckout open />
      </LocaleProvider>,
    );

    const steps = within(screen.getByRole("dialog", { name: "Add Power credit" })).getByRole("list", { name: "Add Power credit" });
    expect(steps).not.toHaveAttribute("style");
  });

  it("keeps checkout step labels at least 13px in every stylesheet rule", async () => {
    const css = await readFile(resolve(process.cwd(), "app/globals.css"), "utf8");
    const rules = Array.from(
      css.matchAll(/\.checkout-steps\s*\{[^}]*font-size:\s*([^;]+);/g),
      ([, value]) => value,
    );
    const floors = rules.map((value) => {
      const lengths = Array.from(
        value.matchAll(/([\d.]+)(rem|px)/g),
        ([, amount, unit]) => Number(amount) * (unit === "rem" ? 16 : 1),
      );
      return Math.min(...lengths);
    });

    expect(floors).toHaveLength(2);
    expect(floors.every((floor) => floor >= 13)).toBe(true);
  });
});

describe("PricingPage", () => {
  it("lists every showcase model input and output rate with units", () => {
    render(
      <LocaleProvider>
        <PricingPage />
      </LocaleProvider>,
    );

    for (const model of MODEL_CATALOG) {
      const row = screen.getAllByRole("row").find((candidate) => within(candidate).queryByRole("cell", { name: model.name }));
      expect(row).toBeDefined();

      const cells = within(row!).getAllByRole("cell");
      expect(cells[1]).toHaveTextContent(`$${model.inputPerMillion.toFixed(2)} per 1M input`);
      expect(cells[2]).toHaveTextContent(`$${model.outputPerMillion.toFixed(2)} per 1M output`);
    }
  });

  it("returns focus to the pricing pack CTA after checkout closes", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <PricingPage />
        <DemoCheckout />
      </LocaleProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Get tokens" })[0];
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(trigger).toHaveFocus();
  });

  it("switches pricing and checkout copy to Traditional Chinese", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <PricingPage />
        </SiteShell>
        <DemoCheckout />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "繁中" }));
    expect(screen.getByRole("heading", { name: "支出可預期，無需訂閱。" })).toBeInTheDocument();
    act(() => openCheckout("builder"));

    expect(screen.getByRole("dialog", { name: "增加 Power 額度" })).toBeInTheDocument();
    expect(screen.getByText("僅供展示，不會收集付款或個人資訊。")).toBeInTheDocument();
  });
});
