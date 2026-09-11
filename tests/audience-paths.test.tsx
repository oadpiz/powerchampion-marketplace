import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomeContent } from "../components/home-content";
import { InternationalSite } from "../components/international-site";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

describe("model and infrastructure journeys", () => {
  it("connects the model CTA to access and preserves a separate enterprise enquiry", async () => {
    const user = userEvent.setup();
    const onAccess = vi.fn();
    window.addEventListener("powerchampion:launch-access", onAccess);
    const english = render(
      <LocaleProvider>
        <SiteShell>
          <HomeContent />
        </SiteShell>
      </LocaleProvider>,
    );
    const closing = screen.getByRole("region", {
      name: "Let’s build what’s next.",
    });
    await user.click(
      within(closing).getByRole("button", { name: "Get API access" }),
    );
    expect(onAccess).toHaveBeenCalledOnce();
    expect(
      within(closing).getByRole("link", { name: "Talk to our team" }),
    ).toHaveAttribute("href", "/contact");
    await user.click(
      within(screen.getByRole("banner")).getByRole("button", { name: "Language: English" }),
    );
    expect(within(screen.getByRole("navigation", { name: "Website language" })).getByRole("link", { name: "繁體中文" })).toHaveAttribute("href", "/zh-Hant");
    english.unmount();
    window.history.replaceState({}, "", "/zh-Hant");
    render(<LocaleProvider><InternationalSite language="zh-Hant" section="" /></LocaleProvider>);
    expect(screen.getByRole("link", { name: "與我們聊聊" })).toHaveAttribute("href", "/contact");
    window.removeEventListener("powerchampion:launch-access", onAccess);
  });
});
