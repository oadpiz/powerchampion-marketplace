import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LaunchAccessDialog } from "../components/demo-checkout";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

describe("SiteShell", () => {
  it("keeps the header launch-access action on non-pricing routes", () => {
    window.history.replaceState({}, "", "/docs");
    const { unmount } = render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Get API access" })).toBeVisible();
    unmount();
    window.history.replaceState({}, "", "/");
  });

  it("renders the approved primary and mobile destinations exactly in both locales", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
      </LocaleProvider>,
    );

    const englishPrimary = within(screen.getByRole("navigation", { name: "Primary navigation" }))
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    expect(englishPrimary).toEqual([
      ["Models", "/models"],
      ["Pricing", "/pricing"],
      ["Infrastructure", "/infrastructure"],
      ["Docs", "/docs"],
      ["Trust", "/trust"],
      ["Company", "/company"],
      ["Status", "/status"],
    ]);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const englishMobile = within(screen.getByRole("navigation", { name: "Mobile navigation" }))
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    expect(englishMobile).toEqual([
      ...englishPrimary,
      ["Deployment review", "/contact"],
    ]);
    await user.click(screen.getByRole("button", { name: "Close menu" }));

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));

    const chinesePrimary = within(screen.getByRole("navigation", { name: "主要導覽" }))
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    expect(chinesePrimary).toEqual([
      ["模型", "/models"],
      ["價格", "/pricing"],
      ["基礎設施", "/infrastructure"],
      ["文件", "/docs"],
      ["信任", "/trust"],
      ["公司", "/company"],
      ["狀態", "/status"],
    ]);

    await user.click(screen.getByRole("button", { name: "開啟選單" }));
    expect(within(screen.getByRole("navigation", { name: "行動版導覽" }))
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]))
      .toEqual([
        ...chinesePrimary,
        ["部署審查", "/contact"],
      ]);
  });

  it("synchronizes document language transiently", async () => {
    const user = userEvent.setup();
    document.documentElement.lang = "test-host-language";
    const { unmount } = render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(document.documentElement).toHaveAttribute("lang", "en");
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");

    unmount();
    expect(document.documentElement).toHaveAttribute("lang", "test-host-language");
  });

  it("localizes shell landmarks and footer content including its language switch", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    const footer = screen.getByRole("contentinfo", { name: "Footer" });
    expect(within(footer).getByRole("link", { name: "About" })).toHaveAttribute("href", "/company");
    expect(within(footer).getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
    expect(within(footer).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faq");
    expect(within(footer).getByRole("link", { name: "Status" })).not.toHaveAttribute("aria-disabled");
    expect(within(footer).getByRole("button", { name: "繁中" })).toBeInTheDocument();

    await user.click(within(footer).getByRole("button", { name: "繁中" }));

    expect(screen.getByRole("navigation", { name: "主要導覽" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "頁尾" })).toBeInTheDocument();
    expect(within(screen.getByRole("contentinfo", { name: "頁尾" })).getByRole("link", { name: "關於" }))
      .toHaveAttribute("href", "/company");
    expect(within(screen.getByRole("contentinfo", { name: "頁尾" })).getByRole("link", { name: "服務狀態" }))
      .toHaveAttribute("href", "/status");
  });

  it("localizes the mobile navigation landmark", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    await user.click(screen.getByRole("button", { name: "開啟選單" }));

    const dialog = screen.getByRole("dialog", { name: "開啟選單" });
    expect(within(dialog).getByRole("navigation", { name: "行動版導覽" })).toBeInTheDocument();
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
    let launchAccessEvents = 0;
    const onLaunchAccess = () => {
      launchAccessEvents += 1;
    };
    window.addEventListener("powerchampion:launch-access", onLaunchAccess);

    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
      </LocaleProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Open menu" });
    await user.click(within(menu).getByRole("button", { name: "Get API access" }));
    expect(launchAccessEvents).toBe(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    await user.click(screen.getByRole("button", { name: "開啟選單" }));
    expect(
      within(screen.getByRole("dialog", { name: "開啟選單" })).getByRole(
        "button",
        { name: "取得 API 存取" },
      ),
    ).toBeInTheDocument();

    window.removeEventListener("powerchampion:launch-access", onLaunchAccess);
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
    const checkoutButton = within(menu).getByRole("button", { name: "Get API access" });
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(checkoutButton).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.click(closeButton);
    expect(trigger).toHaveFocus();
  });

  it("isolates and restores the page while the mobile menu is open", async () => {
    const user = userEvent.setup();
    document.body.style.overflow = "clip";
    render(
      <LocaleProvider>
        <SiteShell>
          <main aria-hidden="false" data-testid="background-content">Content</main>
        </SiteShell>
      </LocaleProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Open menu" });
    const background = screen.getByTestId("background-content");
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Open menu" });
    expect(background).toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog).not.toHaveAttribute("inert");
    expect(dialog).not.toHaveAttribute("aria-hidden", "true");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Open menu" })).not.toBeInTheDocument();
    expect(background).not.toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "false");
    expect(document.body.style.overflow).toBe("clip");
    expect(trigger).toHaveFocus();
    document.body.style.removeProperty("overflow");
  });

  it("returns checkout focus to the launch-access trigger after Escape", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Get API access" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Get your API key" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Get your API key" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("isolates and restores the shell while checkout is open", async () => {
    const user = userEvent.setup();
    document.body.style.overflow = "auto";
    const { container } = render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    const shell = container.querySelector(".site-shell");
    expect(shell).not.toBeNull();
    shell!.setAttribute("aria-hidden", "false");
    const trigger = within(screen.getByRole("banner")).getByRole("button", { name: "Get API access" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Get your API key" });
    expect(shell).toHaveAttribute("inert");
    expect(shell).toHaveAttribute("aria-hidden", "true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog).not.toHaveAttribute("inert");
    expect(dialog).not.toHaveAttribute("aria-hidden", "true");

    await user.keyboard("{Escape}");

    expect(shell).not.toHaveAttribute("inert");
    expect(shell).toHaveAttribute("aria-hidden", "false");
    expect(document.body.style.overflow).toBe("auto");
    expect(trigger).toHaveFocus();
    document.body.style.removeProperty("overflow");
  });

  it("restores checkout focus to the still-mounted mobile menu trigger", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell>
          <main>Content</main>
        </SiteShell>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    const menuTrigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(menuTrigger);
    await user.click(within(screen.getByRole("dialog", { name: "Open menu" })).getByRole("button", { name: "Get API access" }));
    expect(screen.getByRole("dialog", { name: "Get your API key" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(document.body.contains(menuTrigger)).toBe(true);
    expect(menuTrigger).toHaveFocus();
  });

  it("hands off mobile isolation to checkout without unlocking the page", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    const menuTrigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(menuTrigger);
    await user.click(within(screen.getByRole("dialog", { name: "Open menu" })).getByRole("button", { name: "Get API access" }));

    expect(screen.queryByRole("dialog", { name: "Open menu" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Get your API key" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
    expect(menuTrigger).toHaveFocus();
  });

  it("offers the real email-based access request in both locales without fake completion", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Get API access" }));
    const dialog = screen.getByRole("dialog", { name: "Get your API key" });
    expect(within(dialog).getByText("How access works")).toBeVisible();
    expect(within(dialog).getByRole("link", { name: /Email info@powerchampion.org/ })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:info@powerchampion.org"),
    );
    expect(dialog).not.toHaveTextContent(/completed locally/i);
    unmount();

    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
        <LaunchAccessDialog />
      </LocaleProvider>,
    );
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "取得 API 存取" }));
    const zhDialog = screen.getByRole("dialog", { name: "取得你的 API Key" });
    expect(within(zhDialog).getByText(/存取流程/)).toBeVisible();
    expect(within(zhDialog).getByRole("link", { name: /Email info@powerchampion.org/ })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:info@powerchampion.org"),
    );
    expect(zhDialog).not.toHaveTextContent("已在本機完成");
  });
});
