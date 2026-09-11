import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

const STORAGE_KEY = "pc-locale";
beforeEach(() => window.history.replaceState({}, "", "/"));
afterEach(() => vi.restoreAllMocks());
function mount() {
  return render(
    <LocaleProvider>
      <SiteShell>
        <main>Content</main>
      </SiteShell>
    </LocaleProvider>,
  );
}
function setBrowserLanguages(languages: string[]) {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages);
  vi.spyOn(window.navigator, "language", "get").mockReturnValue(
    languages[0] ?? "en-US",
  );
}
async function switchLanguage(
  user: ReturnType<typeof userEvent.setup>,
  language: "zh" | "en",
) {
  const header = within(screen.getByRole("banner"));
  await user.click(
    header.getByRole("button", {
      name: language === "zh" ? "Language: English" : "語言：繁體中文",
    }),
  );
  await user.click(
    header.getByRole("button", {
      name: language === "zh" ? "繁體中文" : "English",
    }),
  );
}

describe("English canonical pages and explicit language preferences", () => {
  it.each([
    ["en-US", "en"],
    ["zh-TW", "zh"],
    ["ja-JP", "fr-FR"],
  ])(
    "defaults to English without redirecting for browser preferences %s",
    (first, second) => {
      setBrowserLanguages([first, second]);
      mount();
      expect(
        within(screen.getByRole("banner")).getByRole("button", {
          name: "Language: English",
        }),
      ).toBeVisible();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      expect(document.documentElement).toHaveAttribute("lang", "en");
      expect(window.location.pathname).toBe("/");
    },
  );

  it.each([
    "/",
    "/solutions",
    "/models",
    "/pricing",
    "/infrastructure",
    "/company",
  ])(
    "keeps the explicit English URL %s English even with a stale Traditional preference",
    (path) => {
      localStorage.setItem(STORAGE_KEY, "zh");
      window.history.replaceState({}, "", path);
      mount();
      expect(
        within(screen.getByRole("banner")).getByRole("button", {
          name: "Language: English",
        }),
      ).toBeVisible();
      expect(document.documentElement).toHaveAttribute("lang", "en");
      expect(window.location.pathname).toBe(path);
    },
  );

  it("persists an explicit developer-page switch and restores it on another tool page", async () => {
    window.history.replaceState({}, "", "/docs");
    const user = userEvent.setup();
    const first = mount();
    await switchLanguage(user, "zh");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("zh");
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
    expect(window.location.pathname).toBe("/docs");
    first.unmount();
    window.history.replaceState({}, "", "/account");
    mount();
    expect(
      await within(screen.getByRole("banner")).findByRole("button", {
        name: "語言：繁體中文",
      }),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
  });

  it("exposes all five same-section language links in the public footer", () => {
    window.history.replaceState({}, "", "/company");
    mount();
    const footer = within(screen.getByRole("contentinfo"));
    const links = within(
      footer.getByRole("navigation", { name: "Website languages" }),
    ).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/company",
      "/zh-Hant/company",
      "/zh-Hans/company",
      "/ja/company",
      "/ko/company",
    ]);
    expect(
      footer.queryByRole("button", { name: "繁中" }),
    ).not.toBeInTheDocument();
  });

  it.each(["/ja/company", "/ko", "/zh-Hans/pricing", "/zh-Hant/models"])(
    "keeps explicit regional document language for %s",
    (path) => {
      window.history.replaceState({}, "", path);
      render(
        <LocaleProvider>
          <main>Regional content</main>
        </LocaleProvider>,
      );
      expect(document.documentElement).toHaveAttribute(
        "lang",
        path.split("/")[1],
      );
    },
  );

  it("ignores unsupported saved values on developer pages", () => {
    window.history.replaceState({}, "", "/docs");
    localStorage.setItem(STORAGE_KEY, "zh-CN");
    mount();
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Language: English",
      }),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("remains usable when browser storage cannot be read", async () => {
    window.history.replaceState({}, "", "/docs");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const user = userEvent.setup();
    mount();
    await switchLanguage(user, "zh");
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
  });

  it("switches developer-page content in memory when saving is unavailable", async () => {
    window.history.replaceState({}, "", "/docs");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota", "QuotaExceededError");
    });
    const user = userEvent.setup();
    mount();
    await switchLanguage(user, "zh");
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hant");
    await switchLanguage(user, "en");
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });
});
