import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { LanguagePicker } from "../components/language-picker";
import { LocaleProvider } from "../components/locale-provider";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
const mount = (picker = <LanguagePicker />) =>
  render(
    <LocaleProvider>
      {picker}
      <input aria-label="Unsent request" defaultValue="Keep my work" />
      <button>Outside</button>
    </LocaleProvider>,
  );

describe("LanguagePicker", () => {
  it("shows the current language text and all five dedicated homepage links", async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole("button", { name: "Language: English" });
    expect(trigger).toHaveTextContent("English");
    expect(
      screen.queryByRole("navigation", { name: "Website language" }),
    ).not.toBeInTheDocument();
    await user.click(trigger);
    const choices = within(
      screen.getByRole("navigation", { name: "Website language" }),
    );
    expect(
      choices
        .getAllByRole("link")
        .map((link) => [
          link.textContent?.replace("✓", "").trim(),
          link.getAttribute("href"),
        ]),
    ).toEqual([
      ["English", "/"],
      ["繁體中文", "/zh-Hant"],
      ["简体中文", "/zh-Hans"],
      ["日本語", "/ja"],
      ["한국어", "/ko"],
    ]);
    expect(choices.getByRole("link", { name: "English" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("preserves the current public section when choosing another language", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/pricing");
    mount();
    await user.click(screen.getByRole("button", { name: "Language: English" }));
    expect(screen.getByRole("link", { name: "日本語" })).toHaveAttribute(
      "href",
      "/ja/pricing",
    );
    expect(screen.getByRole("link", { name: "繁體中文" })).toHaveAttribute(
      "href",
      "/zh-Hant/pricing",
    );
  });

  it("supports explicit translated-page props and clears stale Traditional preference on English selection", async () => {
    const user = userEvent.setup();
    localStorage.setItem("pc-locale", "zh");
    mount(<LanguagePicker language="ja" section="company" />);
    await user.click(screen.getByRole("button", { name: "言語: 日本語" }));
    const english = screen.getByRole("link", { name: "English" });
    expect(english).toHaveAttribute("href", "/company");
    english.addEventListener("click", (event) => event.preventDefault());
    await user.click(english);
    expect(localStorage.getItem("pc-locale")).toBe("en");
  });

  it("switches developer pages in place and keeps unsent input", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/docs");
    mount();
    await user.click(screen.getByRole("button", { name: "Language: English" }));
    expect(
      screen.getByText(/Other languages open the regional homepage/),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "繁體中文" }));
    expect(
      screen.getByRole("button", { name: "語言：繁體中文" }),
    ).toHaveTextContent("繁體中文");
    expect(screen.getByLabelText("Unsent request")).toHaveValue("Keep my work");
    expect(window.location.pathname).toBe("/docs");
    expect(localStorage.getItem("pc-locale")).toBe("zh");
  });

  it("supports keyboard selection, Escape focus restoration and outside dismissal", async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole("button", { name: "Language: English" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: "English" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: "繁體中文" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
