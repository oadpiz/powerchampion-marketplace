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
  it("keeps the split closing choices aligned with the two approved journeys", async () => {
    const user = userEvent.setup();
    renderHome();

    const englishPaths = screen.getByRole("region", { name: "Choose your path" });
    expect(within(englishPaths).getByRole("link", { name: "Compare token rates" }))
      .toHaveAttribute("href", "/pricing");
    expect(within(englishPaths).getByRole("link", { name: "Deployment review" }))
      .toHaveAttribute("href", "/contact");

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }));

    const chinesePaths = screen.getByRole("region", { name: "選擇你的路徑" });
    expect(within(chinesePaths).getByRole("link", { name: "比較 Token 費率" }))
      .toHaveAttribute("href", "/pricing");
    expect(within(chinesePaths).getByRole("link", { name: "部署審查" }))
      .toHaveAttribute("href", "/contact");
  });
});
