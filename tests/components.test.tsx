import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DemoCheckout } from "../components/demo-checkout";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

describe("SiteShell", () => {
  it("renders all five destinations and changes locale", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("link", { name: "Models" })).toHaveAttribute(
      "href",
      "/models",
    );
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "/docs",
    );
    expect(screen.getByRole("link", { name: "Console" })).toHaveAttribute(
      "href",
      "/console",
    );

    await user.click(screen.getByRole("button", { name: "繁中" }));

    expect(screen.getByRole("link", { name: "模型" })).toBeInTheDocument();
  });

  it("opens and closes the mobile menu accessibly", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
      </LocaleProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "Close menu" }));

    expect(
      screen.queryByRole("button", { name: "Close menu" }),
    ).not.toBeInTheDocument();
  });

  it("offers localized checkout in the mobile menu and dispatches its event", async () => {
    const user = userEvent.setup();
    let checkoutEvents = 0;
    const onCheckout = () => {
      checkoutEvents += 1;
    };
    window.addEventListener("powerchampion:checkout", onCheckout);

    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Open menu" });
    await user.click(within(menu).getByRole("button", { name: "Get tokens" }));
    expect(checkoutEvents).toBe(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "繁中" }));
    await user.click(screen.getByRole("button", { name: "開啟選單" }));
    expect(
      within(screen.getByRole("dialog", { name: "開啟選單" })).getByRole(
        "button",
        { name: "購買額度" },
      ),
    ).toBeInTheDocument();

    window.removeEventListener("powerchampion:checkout", onCheckout);
  });

  it("contains focus in the mobile menu and returns it to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
      </LocaleProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);

    const menu = screen.getByRole("dialog", { name: "Open menu" });
    const closeButton = within(menu).getByRole("button", { name: "Close menu" });
    const checkoutButton = within(menu).getByRole("button", { name: "Get tokens" });
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(checkoutButton).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.click(closeButton);
    expect(trigger).toHaveFocus();
  });

  it("returns checkout focus to the Get tokens trigger after Escape", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
        <DemoCheckout />
      </LocaleProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Get tokens" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Add Power credit" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Add Power credit" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("restores checkout focus to the still-mounted mobile menu trigger", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
        <DemoCheckout />
      </LocaleProvider>,
    );

    const menuTrigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(menuTrigger);
    await user.click(within(screen.getByRole("dialog", { name: "Open menu" })).getByRole("button", { name: "Get tokens" }));
    expect(screen.getByRole("dialog", { name: "Add Power credit" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(document.body.contains(menuTrigger)).toBe(true);
    expect(menuTrigger).toHaveFocus();
  });
});
