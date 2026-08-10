import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
});
