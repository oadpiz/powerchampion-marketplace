import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import PricingPage, { metadata } from "../app/pricing/page";
import { LaunchAccessDialog, openLaunchAccess } from "../components/demo-checkout";
import { LocaleProvider } from "../components/locale-provider";
import { PricingCalculator } from "../components/pricing-calculator";
import { PricingPageContent } from "../components/pricing-page-content";
import { SiteShell } from "../components/site-shell";

const EXPECTED_MODEL_RATES = [
  { name: "Qwen", input: "0.18", output: "0.72" },
  { name: "DeepSeek", input: "0.27", output: "1.10" },
  { name: "Llama", input: "0.16", output: "0.64" },
  { name: "Mistral", input: "0.20", output: "0.80" },
  { name: "GLM", input: "0.22", output: "0.88" },
  { name: "MiniMax", input: "0.24", output: "0.96" },
] as const;

function normalizedText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim();
}

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

  it("rejects empty and whitespace-only token fields with alert semantics", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <PricingCalculator />
      </LocaleProvider>,
    );

    const input = screen.getByLabelText("Input tokens");
    await user.clear(input);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter non-negative token amounts.");
    expect(screen.queryByText("Estimated cost")).not.toBeInTheDocument();

    await user.type(input, "   ");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter non-negative token amounts.");
  });

  it("announces valid estimates politely", () => {
    render(
      <LocaleProvider>
        <PricingCalculator />
      </LocaleProvider>,
    );

    expect(screen.getByText("Estimated cost").parentElement).toHaveAttribute("aria-live", "polite");
  });

  it("names browser-only estimator fields and disables autofill", () => {
    render(
      <LocaleProvider>
        <PricingCalculator />
      </LocaleProvider>,
    );

    expect(screen.getByLabelText("Select a model")).toHaveAttribute("name", "estimator-model");
    expect(screen.getByLabelText("Select a model")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("Input tokens")).toHaveAttribute("name", "input-tokens");
    expect(screen.getByLabelText("Input tokens")).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText("Output tokens")).toHaveAttribute("name", "output-tokens");
    expect(screen.getByLabelText("Output tokens")).toHaveAttribute("autocomplete", "off");
  });

  it("uses non-negative whole-number controls for token quantities", () => {
    render(
      <LocaleProvider>
        <PricingCalculator />
      </LocaleProvider>,
    );

    for (const name of ["Input tokens", "Output tokens"]) {
      const input = screen.getByLabelText(name);
      expect(input).toHaveAttribute("type", "number");
      expect(input).toHaveAttribute("min", "0");
      expect(input).toHaveAttribute("step", "1");
      expect(input).toHaveAttribute("inputmode", "numeric");
    }
  });

  it("rejects fractional token quantities", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <PricingCalculator />
      </LocaleProvider>,
    );

    const input = screen.getByLabelText("Input tokens");
    await user.clear(input);
    await user.type(input, "1.5");

    expect(screen.getByRole("alert")).toHaveTextContent("Enter non-negative token amounts.");
  });
});

describe("LaunchAccessDialog", () => {
  it("keeps every launch-access step free of commercial package claims", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LaunchAccessDialog open />
      </LocaleProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Request launch access" });
    expect(dialog).not.toHaveTextContent(/\$\d|credit|bonus|buy|payment|account|reservation/i);

    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(dialog).not.toHaveTextContent(/\$\d|credit|bonus|buy|payment|account|reservation/i);

    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(dialog).not.toHaveTextContent(/\$\d|credit|bonus|buy|payment|account|reservation/i);
  });

  it("makes launch access non-binding and payment-free", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LaunchAccessDialog open />
      </LocaleProvider>,
    );

    expect(screen.getByText("This local interest creates no order or charge. It is not transmitted or persisted.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Local launch-access interest saved.")).toBeVisible();
    expect(screen.queryByLabelText(/card|billing/i)).not.toBeInTheDocument();
  });

  it("moves focus to the complete-step Close button after advancing", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LaunchAccessDialog initialInterest="product" open />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Local launch-access interest saved.")).toBeInTheDocument();
    const completeClose = within(screen.getByRole("dialog", { name: "Request launch access" }))
      .getAllByRole("button", { name: "Close" })
      .at(-1);
    expect(completeClose).toHaveFocus();
  });

  it("opens the selected access interest", () => {
    render(
      <LocaleProvider>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    act(() => openLaunchAccess("enterprise"));

    expect(screen.getByRole("dialog", { name: "Request launch access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enterprise planning/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("resets to access-interest selection after close", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LaunchAccessDialog open />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Review local interest")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    act(() => openLaunchAccess());

    const steps = within(screen.getByRole("list", { name: "Request launch access" })).getAllByRole("listitem");
    expect(steps[0]).toHaveAttribute("aria-current", "step");
    expect(steps[1]).not.toHaveAttribute("aria-current");
  });

  it("contains Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LaunchAccessDialog open />
      </LocaleProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Request launch access" });
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
        <LaunchAccessDialog open />
      </LocaleProvider>,
    );

    const steps = within(screen.getByRole("dialog", { name: "Request launch access" })).getByRole("list", { name: "Request launch access" });
    expect(steps).not.toHaveAttribute("style");
  });

  it("keeps checkout step labels at least 13px in every stylesheet rule", async () => {
    const css = await readFile(resolve(process.cwd(), "app/globals.css"), "utf8");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    expect(mobileStart).toBeGreaterThan(-1);
    const baseRules = Array.from(css.slice(0, mobileStart).matchAll(/\.checkout-steps\s*\{([^}]*)}/g), ([, declarations]) => declarations);
    const mobileRules = Array.from(css.slice(mobileStart).matchAll(/\.checkout-steps\s*\{([^}]*)}/g), ([, declarations]) => declarations);
    expect(baseRules).toHaveLength(1);
    expect(mobileRules).toHaveLength(1);

    const lengths = [...baseRules, ...mobileRules].map((declarations) => {
      const fontSize = declarations.match(/(?:^|;)\s*font-size\s*:\s*([^;]+);/);
      expect(fontSize, "each checkout step rule declares font-size").not.toBeNull();

      const value = fontSize![1].trim();
      expect(value).toMatch(/^\d*\.?\d+(?:px|rem)$/);
      const [, amount, unit] = value.match(/^(\d*\.?\d+)(px|rem)$/)!;
      return Number(amount) * (unit === "rem" ? 16 : 1);
    });

    expect(lengths.every((length) => Number.isFinite(length) && length >= 13)).toBe(true);
  });
});

describe("PricingPage", () => {
  it("keeps the page CTA as the only launch action when pricing mobile navigation opens", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/pricing");
    const { unmount } = render(
      <LocaleProvider>
        <SiteShell><PricingPageContent /></SiteShell>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Open menu" });
    expect(within(menu).getByRole("link", { name: "Deployment review" })).toHaveAttribute("href", "/contact");
    expect(within(menu).getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(within(menu).queryByRole("button", { name: "Join launch access" })).not.toBeInTheDocument();
    const launchActions = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.textContent === "Join launch access");
    expect(launchActions).toHaveLength(1);
    expect(within(screen.getByRole("main", { hidden: true })).getByRole("button", { name: "Join launch access", hidden: true })).toBeVisible();
    unmount();
    window.history.replaceState({}, "", "/");
  });

  it("explains separate token billing and offers one non-binding launch action", () => {
    render(
      <LocaleProvider>
        <PricingPage />
      </LocaleProvider>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "How token billing works" })).toBeVisible();
    expect(screen.getByText(/input and output tokens are priced separately/i)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Join launch access" })).toHaveLength(1);
    expect(document.body).not.toHaveTextContent(/buy now|checkout|funded balance/i);
  });

  it("has truthful pricing metadata", () => {
    expect(metadata).toMatchObject({
      title: "Illustrative pricing | Power Champion",
      description: "Illustrative token rates and local launch-access planning; no payment or funded balance is available.",
    });
  });

  it("lists every showcase model input and output rate with units", () => {
    render(
      <LocaleProvider>
        <PricingPage />
      </LocaleProvider>,
    );

    const rows = screen.getAllByRole("row").filter((candidate) => within(candidate).queryAllByRole("cell").length > 0);
    expect(rows).toHaveLength(EXPECTED_MODEL_RATES.length);

    for (const model of EXPECTED_MODEL_RATES) {
      const row = rows.find((candidate) => within(candidate).queryByRole("cell", { name: model.name }));
      expect(row).toBeDefined();

      const cells = within(row!).getAllByRole("cell");
      expect(cells).toHaveLength(3);
      expect(normalizedText(cells[1])).toBe(`$${model.input} per 1M input`);
      expect(normalizedText(cells[2])).toBe(`$${model.output} per 1M output`);
    }
  });

  it("labels the keyboard-scrollable rate comparison with a visible cue", () => {
    render(
      <LocaleProvider>
        <PricingPage />
      </LocaleProvider>,
    );

    const cue = screen.getByText("Scroll horizontally to compare every rate column.");
    const region = screen.getByRole("region", { name: "Model rate comparison" });

    expect(cue).toHaveAttribute("id", "rate-table-scroll-cue");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("aria-describedby", "rate-table-scroll-cue");
    const table = within(region).getByRole("table", { name: "Model rate comparison" });
    expect(table).toBeVisible();
    expect(table.tagName).toBe("TABLE");
    expect(table.querySelector("thead")).not.toBeNull();
    expect(table.querySelector("tbody")).not.toBeNull();
    expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(EXPECTED_MODEL_RATES.length);
    expect(table.querySelectorAll("tbody td")).toHaveLength(EXPECTED_MODEL_RATES.length * 3);
  });

  it("scrolls the focused rate comparison with horizontal arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <PricingPage />
      </LocaleProvider>,
    );

    const region = screen.getByRole("region", { name: "Model rate comparison" });
    Object.defineProperty(region, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(region, "scrollWidth", { configurable: true, value: 640 });
    region.scrollLeft = 0;
    region.focus();

    await user.keyboard("{ArrowRight}");
    expect(region.scrollLeft).toBe(256);

    await user.keyboard("{ArrowLeft}");
    expect(region.scrollLeft).toBe(0);
  });

  it("returns focus to the pricing pack CTA after checkout closes", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <PricingPage />
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    const trigger = screen.getAllByRole("button", { name: "Join launch access" })[0];
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
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    expect(screen.getByRole("heading", { name: "指示性方案，無需承諾。" })).toBeInTheDocument();
    expect(screen.getByText("水平捲動以比較所有費率欄位。")).toBeVisible();
    expect(screen.getByRole("region", { name: "模型費率比較" })).toHaveAttribute("tabindex", "0");
    act(() => openLaunchAccess("product"));

    expect(screen.getByRole("dialog", { name: "申請啟動存取" })).toBeInTheDocument();
    expect(screen.getByText("此本機意向不會建立訂單或收費，也不會傳送或保存。")).toBeInTheDocument();
  });
});
