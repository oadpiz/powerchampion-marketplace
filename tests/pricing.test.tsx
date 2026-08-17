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
  { name: "GLM 5.2 FP8", input: "0.93", output: "3.00" },
  { name: "Qwen3-VL 30B", input: "0.30", output: "1.20" },
  { name: "Flux Schnell", input: "0.01", output: "0.00" },
  { name: "Chroma1 HD", input: "0.01", output: "0.00" },
  { name: "Whisper Large v3", input: "0.01", output: "0.00" },
  { name: "IndexTTS2", input: "0.03", output: "0.00" },
  { name: "BGE-M3", input: "0.02", output: "0.00" },
  { name: "BGE Reranker v2-m3", input: "0.02", output: "0.00" },
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

    await user.selectOptions(screen.getByLabelText("Select a model"), "qwen3-vl-30b");
    await user.clear(screen.getByLabelText("Input tokens"));
    await user.type(screen.getByLabelText("Input tokens"), "1000000");
    await user.clear(screen.getByLabelText("Output tokens"));
    await user.type(screen.getByLabelText("Output tokens"), "500000");

    expect(screen.getByText("$0.90")).toBeInTheDocument();
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
  it("shows the real access flow: request by email, no fake completion", async () => {
    render(
      <LocaleProvider>
        <LaunchAccessDialog open />
      </LocaleProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Get your API key" });
    expect(within(dialog).getByText("How access works")).toBeVisible();
    expect(within(dialog).getByRole("link", { name: /Email info@powerchampion.org/ })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:info@powerchampion.org"),
    );
    expect(within(dialog).getByRole("link", { name: /Read the quick start/ })).toHaveAttribute("href", "/docs");
  });

  it("describes prepaid keys without claiming a self-serve signup", () => {
    render(
      <LocaleProvider>
        <LaunchAccessDialog open />
      </LocaleProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/Keys are issued per customer with prepaid balance/i);
    expect(dialog).toHaveTextContent(/redeem codes/i);
    expect(dialog).not.toHaveTextContent(/\$\d+\.\d+|buy now|subscribe/i);
  });

  it("focuses the close button on open and traps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LaunchAccessDialog open />
      </LocaleProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Get your API key" });
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(within(dialog).getByRole("link", { name: /Read the quick start/ })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus(); // focus wrapped to first element, still inside dialog
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("opens via the global event and closes on Escape returning focus", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    act(() => openLaunchAccess());
    expect(screen.getByRole("dialog", { name: "Get your API key" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("localizes the access flow to Traditional Chinese", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);
    act(() => openLaunchAccess());
    const dialog = screen.getByRole("dialog", { name: "取得你的 API Key" });
    expect(within(dialog).getByText(/存取流程/)).toBeVisible();
    expect(within(dialog).getByRole("link", { name: /閱讀快速開始/ })).toHaveAttribute("href", "/docs");
  });

  it("pre-fills the mailto with a structured request template", () => {
    render(
      <LocaleProvider>
        <LaunchAccessDialog open />
      </LocaleProvider>,
    );

    const mailto = screen.getByRole("link", { name: /Email info@powerchampion.org/ });
    const href = mailto.getAttribute("href") ?? "";
    expect(href).toContain("subject=API%20access%20request");
    expect(href).toContain("Intended%20use%20case");
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
  it("keeps the mobile menu navigable and shows the header CTA on pricing", async () => {
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
    expect(within(screen.getByRole("main", { hidden: true })).getByRole("button", { name: "Get API access", hidden: true })).toBeVisible();
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
    expect(screen.getAllByRole("button", { name: "Get API access" })).toHaveLength(1);
    expect(document.body).not.toHaveTextContent(/buy now|checkout|funded balance/i);
  });

  it("has truthful pricing metadata", () => {
    expect(metadata).toMatchObject({
      title: "Pricing | Power Champion",
      description: "Live token rates for every model — pay per use from prepaid balance. No subscription required.",
    });
  });

  it("lists every model rate with honest units (per-token vs per-image/minute)", () => {
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
      const name = model.name;
      const isPerUse = /Flux|Chroma|Whisper|IndexTTS/i.test(name);
      if (isPerUse) {
        expect(cells).toHaveLength(2);
        expect(normalizedText(cells[1])).toBe(`$${model.input} per ${/Whisper|IndexTTS/i.test(name) ? "minute of audio" : "image"}`);
      } else {
        expect(cells).toHaveLength(3);
        expect(normalizedText(cells[1])).toBe(`$${model.input} per 1M input`);
        expect(normalizedText(cells[2])).toBe(`$${model.output} per 1M output`);
      }
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
    const perUseCount = EXPECTED_MODEL_RATES.filter((m) => /Flux|Chroma|Whisper|IndexTTS/i.test(m.name)).length;
    expect(table.querySelectorAll("tbody td")).toHaveLength(EXPECTED_MODEL_RATES.length * 3 - perUseCount);
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

    const trigger = screen.getAllByRole("button", { name: "Get API access" })[0];
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

    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);
    expect(screen.getByRole("heading", { name: "按量計費，無需訂閱。" })).toBeInTheDocument();
    expect(screen.getByText("水平捲動以比較所有費率欄位。")).toBeVisible();
    expect(screen.getByRole("region", { name: "模型費率比較" })).toHaveAttribute("tabindex", "0");
    act(() => openLaunchAccess("product"));

    expect(screen.getByRole("dialog", { name: "取得你的 API Key" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText(/存取流程/)).toBeInTheDocument();
  });
});
