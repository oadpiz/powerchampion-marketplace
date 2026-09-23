import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPlatformContent } from "../components/agent-platform-content";
import { agentPlatformCopy } from "../lib/agent-platform-copy";
import type { HomeLanguage } from "../lib/home-copy";

afterEach(() => vi.unstubAllGlobals());

describe("Agent platform product page", () => {
  it("offers real task, builder, gallery and enterprise destinations with the access requirement", () => {
    render(<AgentPlatformContent />);
    const copy = agentPlatformCopy.en;
    const destinations = [
      [copy.taskCta, "/tasks"],
      [copy.buildCta, "/agents/build"],
      [copy.galleryCta, "/agents"],
      [copy.contactCta, "/contact"],
    ];
    for (const [name, destination] of destinations) {
      for (const link of screen.getAllByRole("link", { name })) {
        expect(link).toHaveAttribute("href", destination);
      }
    }
    expect(screen.getAllByText(copy.requirement)).toHaveLength(2);
    expect(screen.getByText(copy.heroVisual.label)).toBeVisible();
    const formats = screen.getByRole("list", { name: copy.fileLabel });
    expect(within(formats).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["TXT", "MD", "CSV", "JSON", "DOCX"]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("lets a visitor explore the page without starting a task or making API requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<AgentPlatformContent />);
    const copy = agentPlatformCopy.en;
    await user.click(screen.getByRole("button", { name: copy.pause }));
    expect(screen.getByRole("button", { name: copy.resume })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".ap-hero-figure")).toHaveAttribute("data-illustration-playing", "false");
    await user.click(screen.getByRole("tab", { name: "Operations" }));
    await user.click(screen.getByText(copy.faqs[0].question));
    expect(screen.getByText(copy.faqs[0].answer)).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<HomeLanguage>(["en", "zh-Hant", "zh-Hans", "ja", "ko"])("ships readable, localized server content in %s", (language) => {
    const copy = agentPlatformCopy[language];
    const html = renderToString(<AgentPlatformContent language={language} />);
    expect(html).toContain(copy.title[0]);
    expect(html).toContain(copy.title[1]);
    expect(html).toContain(copy.requirement);
    expect(html).toContain(copy.faqs[0].answer);
    expect(html).toContain('data-illustration-playing="false"');
    expect(html).not.toContain('opacity:0;');
    render(<AgentPlatformContent language={language} />);
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("main")).toHaveAttribute("lang", language);
    const headline = screen.getByRole("heading", { level: 1 });
    expect(headline).toHaveTextContent(copy.title[0]);
    expect(headline).toHaveTextContent(copy.title[1]);
    expect(screen.getByRole("heading", { name: copy.serviceTitle })).toBeVisible();
    expect(screen.getByRole("button", { name: copy.pause })).toBeVisible();
    for (const faq of copy.faqs) expect(screen.getByText(faq.question)).toBeVisible();
  });
});
