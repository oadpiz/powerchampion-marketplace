import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomeContent } from "../components/home-content";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

function renderHome() {
  return render(
    <LocaleProvider>
      <SiteShell>
        <HomeContent />
      </SiteShell>
    </LocaleProvider>,
  );
}

describe("model-first Power Champion homepage", () => {
  it("prioritizes model discovery and documentation, retaining enterprise infrastructure", () => {
    renderHome();
    const hero = screen.getByRole("region", {
      name: "One API.Every possibility.",
    });
    expect(
      within(hero).getByRole("link", { name: "Explore models" }),
    ).toHaveAttribute("href", "#models");
    expect(
      within(hero).getByRole("link", { name: "Read the docs" }),
    ).toHaveAttribute("href", "/docs");
    expect(
      screen.getByRole("link", { name: "Explore GPU infrastructure" }),
    ).toHaveAttribute("href", "/infrastructure");
    expect(
      screen.getByRole("link", { name: "Check service availability" }),
    ).toHaveAttribute("href", "/status");
    expect(document.body).not.toHaveTextContent(
      /8 live models|99\.99%|Token access launching soon/,
    );
  });

  it("filters model capabilities and keeps each billing unit explicit", async () => {
    const user = userEvent.setup();
    renderHome();
    expect(
      within(screen.getByRole("article", { name: "GLM 5.2 FP8" })).getByText(
        "/ 1M input tokens",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("article", { name: "Flux Schnell" })).getByText(
        "/ image",
      ),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole("article", { name: "Whisper Large v3" }),
      ).getByText("/ audio min"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Vision$/ }));
    expect(screen.getByRole("article", { name: "Qwen3-VL 30B" })).toBeVisible();
    expect(
      screen.queryByRole("article", { name: "GLM 5.2 FP8" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Search & retrieval" }),
    );
    expect(
      screen
        .getAllByRole("article")
        .filter((article) => article.classList.contains("pc-model-card")),
    ).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: "Explore BGE-M3" }),
    ).toHaveAttribute("href", "/models#bge-m3");
  });

  it("switches and copies useful API examples without line numbers", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    renderHome();
    await user.click(screen.getByRole("button", { name: "cURL" }));
    expect(
      screen.getByRole("region", { name: "cURL integration example" }),
    ).toHaveTextContent("POWERCHAMPION_API_KEY");
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(
        "curl https://b300.powerchampion.ai/v1/chat/completions",
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Code copied to clipboard",
    );
    writeText.mockRestore();
  });

  it("offers a manual fallback when clipboard access is denied", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("denied"));
    renderHome();
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(
      screen.getByText("Copy unavailable. Select and copy the code above."),
    ).toBeVisible();
    writeText.mockRestore();
  });

  it("localizes model discovery and both services into Traditional Chinese", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(
      within(screen.getByRole("banner")).getByRole("button", { name: "繁中" }),
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "一組 API。無限可能。",
    );
    expect(screen.getByRole("button", { name: "圖像與音訊" })).toBeVisible();
    expect(screen.getByRole("link", { name: "探索算力服務" })).toHaveAttribute(
      "href",
      "/infrastructure",
    );
    expect(screen.getByText("配置、容量與交付條件依專案確認。")).toBeVisible();
  });
});
