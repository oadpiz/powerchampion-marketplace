import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

const STORAGE_KEY = "pc-locale";

function setBrowserLanguages(languages: string[]) {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(window.navigator, "language", "get").mockReturnValue(languages[0] ?? "en-US");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LocaleProvider English default and explicit preference persistence", () => {
  it("defaults to English for non-Chinese browsers", () => {
    setBrowserLanguages(["en-US", "en"]);
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Get API access" })).toBeVisible();
  });

  it("keeps English for Chinese browsers on first visit without saving an implicit preference", () => {
    setBrowserLanguages(["zh-TW", "zh", "en-US"]);
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(
      within(screen.getByRole("banner")).getByRole("button", { name: "Get API access" }),
    ).toBeVisible();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(document.documentElement).toHaveAttribute("lang", "en");
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

    window.history.replaceState({}, "", "/models");
    const second = render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );
    expect(
      await within(screen.getByRole("banner")).findByRole("button", { name: "取得 API 存取" }),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
    second.unmount();
    window.history.replaceState({}, "", "/");
  });

  it("defaults to English regardless of unrelated browser preferences", async () => {
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

  it("ignores unsupported saved locale values", () => {
    window.localStorage.setItem(STORAGE_KEY, "zh-CN");
    setBrowserLanguages(["zh-TW"]);
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    expect(within(screen.getByRole("banner")).getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("stays usable when the browser blocks reading local storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage access is blocked", "SecurityError");
    });
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    const header = within(screen.getByRole("banner"));
    expect(header.getByRole("button", { name: "Get API access" })).toBeVisible();
    await user.click(header.getByRole("button", { name: "繁中" }));
    expect(header.getByRole("button", { name: "取得 API 存取" })).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
  });

  it("switches language in memory when saving the choice is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <SiteShell><main>Content</main></SiteShell>
      </LocaleProvider>,
    );

    const header = within(screen.getByRole("banner"));
    await user.click(header.getByRole("button", { name: "繁中" }));
    expect(header.getByRole("button", { name: "取得 API 存取" })).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
    await user.click(header.getByRole("button", { name: "English" }));
    expect(header.getByRole("button", { name: "Get API access" })).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });
});
