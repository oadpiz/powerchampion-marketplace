import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HomeContent } from "../components/home-content";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

function renderHome() {
  return render(
    <LocaleProvider>
      <SiteShell><HomeContent /></SiteShell>
    </LocaleProvider>,
  );
}

describe("Home audience paths", () => {
  it("shows localized developer and enterprise path context", async () => {
    const user = userEvent.setup();
    renderHome();

    const englishPaths = screen.getByRole("region", { name: "Choose your path" });
    expect(within(englishPaths).getByText("Developer access")).toBeVisible();
    expect(within(englishPaths).getByText("Compare models, review indicative rates, and join launch access.")).toBeVisible();
    expect(within(englishPaths).getByText("Enterprise collaboration")).toBeVisible();
    expect(within(englishPaths).getByText("Review public context and explore a future conversation.")).toBeVisible();

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));

    const chinesePaths = screen.getByRole("region", { name: "選擇你的路徑" });
    expect(within(chinesePaths).getByRole("link", { name: "探索模型存取" })).toHaveAttribute("href", "/models");
    expect(within(chinesePaths).getByRole("link", { name: "洽談基礎設施" })).toHaveAttribute("href", "/contact");
    expect(within(chinesePaths).getByText("比較模型、查看指示性費率，並加入啟動存取。")).toBeVisible();
    expect(within(chinesePaths).getByText("查看公開脈絡，探索未來合作對話。")).toBeVisible();
  });
});
