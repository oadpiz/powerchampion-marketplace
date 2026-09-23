import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentShowcase } from "../components/agent-showcase";
import { agentShowcaseCopy } from "../lib/agent-showcase-copy";
import type { HomeLanguage } from "../lib/home-copy";

const policy = vi.hoisted(() => ({ canAnimate: false, visible: false }));
vi.mock("../components/promo-motion", () => ({ usePromoMotion: () => ({ canAnimate: policy.canAnimate }) }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useInView: () => policy.visible };
});

beforeEach(() => { policy.canAnimate = false; policy.visible = false; });
afterEach(() => vi.useRealTimers());

function expectStage(name: string) {
  expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
}

describe("Agent capability walkthrough", () => {
  it("server-renders a meaningful first scene and honest entry points", () => {
    const html = renderToString(<AgentShowcase language="en" />);
    expect(html).toContain("From intent");
    expect(html).toContain("Compare a model API shortlist for our next product.");
    expect(html).toContain("Model selection brief");
    expect(html).not.toContain('opacity:0;');
    render(<AgentShowcase language="en" />);
    expect(screen.getByRole("link", { name: "Design your agent" })).toHaveAttribute("href", "/agents/build");
    expect(screen.getByRole("link", { name: "Discuss a project" })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: "Open Tasks" })).toHaveAttribute("href", "/tasks");
    expect(screen.getByText("A configured runtime connection is required to run tasks.")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("supports keyboard scenario selection and manual stages with motion disabled", async () => {
    const user = userEvent.setup();
    render(<AgentShowcase language="en" />);
    const tabs = screen.getByRole("tablist", { name: "Explore an agent use case" });
    await user.click(within(tabs).getByRole("tab", { name: "Research" }));
    await user.keyboard("{ArrowRight}");
    expect(within(tabs).getByRole("tab", { name: "Operations" })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Turn a handover into a plan." })).toBeVisible();
    await user.keyboard("{End}");
    expect(within(tabs).getByRole("tab", { name: "Documents" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Project proposal" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Brief" }));
    await user.keyboard("{End}");
    expectStage("Deliver");
    expect(screen.getByRole("button", { name: "Deliver" })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Create something to work with." })).toBeVisible();
    expect(screen.getByRole("button", { name: "Manual exploration" })).toBeDisabled();
  });

  it("advances only in view and stops when global motion becomes unavailable", () => {
    vi.useFakeTimers();
    policy.canAnimate = true;
    const { rerender } = render(<AgentShowcase language="en" />);
    act(() => vi.advanceTimersByTime(5800));
    expectStage("Brief");
    policy.visible = true;
    rerender(<AgentShowcase language="en" />);
    act(() => vi.advanceTimersByTime(5800));
    expectStage("Sources");
    policy.canAnimate = false;
    rerender(<AgentShowcase language="en" />);
    act(() => vi.advanceTimersByTime(11600));
    expectStage("Sources");
    policy.canAnimate = true;
    policy.visible = false;
    rerender(<AgentShowcase language="en" />);
    act(() => vi.advanceTimersByTime(5800));
    expectStage("Sources");
    policy.visible = true;
    rerender(<AgentShowcase language="en" />);
    act(() => vi.advanceTimersByTime(5800));
    expectStage("Review");
  });

  it("lets visitors pause, resume, and take control without autoplay overriding their selection", () => {
    vi.useFakeTimers();
    policy.canAnimate = true;
    policy.visible = true;
    render(<AgentShowcase language="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Pause walkthrough" }));
    act(() => vi.advanceTimersByTime(11600));
    expectStage("Brief");
    fireEvent.click(screen.getByRole("button", { name: "Play walkthrough" }));
    act(() => vi.advanceTimersByTime(5800));
    expectStage("Sources");
    fireEvent.click(screen.getByRole("button", { name: "Deliver" }));
    act(() => vi.advanceTimersByTime(11600));
    expectStage("Deliver");
    fireEvent.click(screen.getByRole("tab", { name: "Operations" }));
    expectStage("Brief");
    act(() => vi.advanceTimersByTime(11600));
    expectStage("Brief");
    expect(screen.getByRole("button", { name: "Play walkthrough" })).toBeVisible();
  });

  it.each<HomeLanguage>(["en", "zh-Hant", "zh-Hans", "ja", "ko"])("keeps each scenario and stage translated in %s", (language) => {
    const copy = agentShowcaseCopy[language];
    render(<AgentShowcase language={language} />);
    expect(screen.getByText(copy.example)).toBeVisible();
    expect(screen.getByText(copy.footnote)).toBeVisible();
    for (const scenario of copy.scenarios) {
      fireEvent.click(screen.getByRole("tab", { name: scenario.label }));
      expect(screen.getByText(scenario.brief)).toBeVisible();
      expect(screen.getByRole("heading", { name: scenario.document })).toBeVisible();
      for (const [index, name] of copy.stageNames.entries()) {
        fireEvent.click(screen.getByRole("button", { name }));
        expect(screen.getByText(scenario.stages[index][1])).toBeVisible();
      }
    }
  });
});
