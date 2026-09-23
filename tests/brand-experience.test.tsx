import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BrandHero } from "../components/brand-hero";
import { BrandCapabilities } from "../components/brand-capabilities";

describe("interactive brand presentation", () => {
  it("lets keyboard users explore models and follow the selected model destination", async () => {
    const user = userEvent.setup();
    render(<BrandHero language="en" motionPaused={false} onToggleMotion={vi.fn()} />);
    const list = screen.getByRole("tablist", { name: "Explore the intelligence" });
    await user.click(within(list).getByRole("tab", { name: /Reasoning$/ }));
    await user.keyboard("{ArrowRight}");
    expect(within(list).getByRole("tab", { name: /Vision$/ })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Explore this model — Qwen3 VL" })).toHaveAttribute("href", "/models/qwen3-vl-30b");
    await user.keyboard("{End}");
    expect(screen.getByRole("link", { name: "Explore this model — Flux Schnell" })).toHaveAttribute("href", "/models/flux-schnell");
  });

  it("keeps regional service destinations and custom integration scope clear when switching chapters", async () => {
    const user = userEvent.setup();
    render(<BrandCapabilities language="zh-Hant" />);
    const list = screen.getByRole("tablist", { name: "探索服務" });
    await user.click(within(list).getByRole("tab", { name: /模型 API/ }));
    await user.keyboard("{End}");
    expect(screen.getByRole("link", { name: "探索基礎設施" })).toHaveAttribute("href", "/zh-Hant/infrastructure");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("link", { name: "了解智能體服務" })).toHaveAttribute("href", "/zh-Hant/agent-platform");
    expect(screen.getByText("外部工具與企業系統的連接，需要另行確認專案範圍與實作。")).toBeVisible();
  });
});
