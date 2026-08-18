import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

const STORAGE_KEY = "pc-locale";

function setBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, "languages", {
    value: languages,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "language", {
    value: languages[0] ?? "en-US",
    configurable: true,
  });
}

const realLanguages = Object.getOwnPropertyDescriptor(Navigator.prototype, "languages");
const realLanguage = Object.getOwnPropertyDescriptor(Navigator.prototype, "language");

afterEach(() => {
  if (realLanguages) Object.defineProperty(Navigator.prototype, "languages", realLanguages);
  if (realLanguage) Object.defineProperty(Navigator.prototype, "language", realLanguage);
});

describe("LocaleProvider auto-detection and persistence", () => {
  it("defaults to English for non-Chinese browsers", () => {
    setBrowserLanguages(["en-US", "en"]);
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Get API access" })).toBeVisible();
  });

  it("auto-switches to zh-Hant for Chinese browsers on first visit", async () => {
    setBrowserLanguages(["zh-TW", "zh", "en-US"]);
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    // Header CTA rendered in Chinese once the mount-time detection settles
    expect(
      await within(screen.getByRole("banner")).findByRole("button", { name: "取得 API 存取" }),
    ).toBeVisible();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("zh");
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
  });

  it("honors the user's persisted choice over the browser language", async () => {
    window.localStorage.setItem(STORAGE_KEY, "en");
    setBrowserLanguages(["zh-TW", "zh"]);
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(
      await within(screen.getByRole("banner")).findByRole("button", { name: "Get API access" }),
    ).toBeVisible();
  });

  it("persists a manual switch so a remount keeps the chosen language", async () => {
    setBrowserLanguages(["en-US"]);
    const user = userEvent.setup();
    const { unmount } = render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    await user.click(within(screen.getByRole("banner")).getAllByRole("button", { name: "繁中" })[0]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("zh");
    unmount();

    const second = render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );
    expect(
      await within(screen.getByRole("banner")).findByRole("button", { name: "取得 API 存取" }),
    ).toBeVisible();
    second.unmount();
  });

  it("falls back through the preference list to English", async () => {
    setBrowserLanguages(["ja-JP", "fr-FR", "en-GB"]);
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(
      await within(screen.getByRole("banner")).findByRole("button", { name: "Get API access" }),
    ).toBeVisible();
  });
});
