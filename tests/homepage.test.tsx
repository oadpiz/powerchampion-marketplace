import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { HomeContent } from "../components/home-content";
import { LocaleProvider } from "../components/locale-provider";
import { SiteShell } from "../components/site-shell";

function renderInShell(content: ReactNode) {
  return render(
    <LocaleProvider>
      <SiteShell>{content}</SiteShell>
    </LocaleProvider>,
  );
}

describe("Power Champion homepage", () => {
  it("routes the hero through token-rate comparison and deployment review", () => {
    renderInShell(<HomeContent />);

    const hero = screen.getByRole("region", { name: "Every model.One power core." });
    expect(within(hero).getByRole("link", { name: "Compare token rates" }))
      .toHaveAttribute("href", "/pricing");
    expect(within(hero).getByRole("link", { name: "Deployment review" }))
      .toHaveAttribute("href", "/contact");
    expect(screen.getByText("API is live — one key, pay per use")).toBeVisible();
  });

  it("shows derived catalog facts instead of an availability claim", () => {
    renderInShell(<HomeContent />);

    const proof = screen.getByRole("region", { name: "Marketplace facts" });
    expect(within(proof).queryByText("99.98%")).not.toBeInTheDocument();
    expect(within(proof).getByText("8")).toBeVisible();
    expect(within(proof).getByText("131K")).toBeVisible();
    expect(within(proof).getByText("$0.01")).toBeVisible();
  });

  it("uses each model's live serving role and availability in both locales", async () => {
    const user = userEvent.setup();
    renderInShell(<HomeContent />);

    const expectedModels = [
      ["GLM 5.2 FP8", "$0.93 per 1M input", "$3.00 per 1M output", "131K", "16K", "Primary LLM for chat, reasoning, and coding workloads.", "主力 LLM，用於對話、推理與程式開發。"],
      ["Qwen3-VL 30B", "$0.30 per 1M input", "$1.20 per 1M output", "32K", "4K", "Vision and OCR inference for document and image understanding.", "視覺與 OCR 推理，用於文件與圖片理解。"],
      ["Flux Schnell", "$0.01 per 1M input", "$0.00 per 1M output", "—", "1 image", "Text-to-image generation for marketing and creative use.", "文生圖生成，用於行銷與創意場景。"],
      ["Chroma1 HD", "$0.01 per 1M input", "$0.00 per 1M output", "—", "1 image", "Premium HD image generation for high-quality output.", "高品質 HD 圖像生成。"],
      ["Whisper Large v3", "$0.01 per 1M input", "$0.00 per 1M output", "—", "transcript", "Audio transcription and subtitle generation.", "音訊轉錄與字幕生成。"],
      ["IndexTTS2", "$0.03 per 1M input", "$0.00 per 1M output", "2K", "audio", "Text-to-speech with voice cloning capabilities.", "文字轉語音與語音克隆。"],
      ["BGE-M3", "$0.02 per 1M input", "$0.00 per 1M output", "8K", "vector", "Embedding generation for RAG and semantic search.", "嵌入向量生成，用於 RAG 與語意搜尋。"],
      ["BGE Reranker v2-m3", "$0.02 per 1M input", "$0.00 per 1M output", "8K", "scores", "Document reranking for retrieval-augmented generation.", "文件重排，用於檢索增強生成。"],
    ] as const;

    for (const [name, inputRate, outputRate, context, maxOutput, englishRole] of expectedModels) {
      const row = screen.getByRole("article", { name });
      expect(within(row).getByText(context)).toBeVisible();
      expect(within(row).getByText(maxOutput)).toBeVisible();
      expect(within(row).getByText(inputRate)).toBeVisible();
      expect(within(row).getByText(outputRate)).toBeVisible();
      expect(within(row).getByText("Live")).toBeVisible();
      expect(within(row).getByText(englishRole)).toBeVisible();
      expect(within(row).getByText("Available")).toBeVisible();
      expect(within(row).queryByText("Temporarily unavailable")).not.toBeInTheDocument();
      expect(within(row).queryByText("Review required")).not.toBeInTheDocument();
      expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    }

    expect(document.body).not.toHaveTextContent(/tool-enabled production workloads|Agent-ready intelligence/i);

    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);
    for (const [name, , , , , , chineseRole] of expectedModels) {
      const row = screen.getByRole("article", { name });
      expect(within(row).getByText(chineseRole)).toBeVisible();
      expect(within(row).getByText("已上線")).toBeVisible();
      expect(within(row).getByText("可用")).toBeVisible();
    }
  });

  it("shows the three access steps in their approved order", () => {
    renderInShell(<HomeContent />);

    const access = screen.getByRole("region", { name: "How access works" });
    expect(within(access).getByRole("list").querySelectorAll("h3")).toHaveLength(3);
    expect(Array.from(within(access).getByRole("list").querySelectorAll("h3"), (heading) => heading.textContent))
      .toEqual(["Compare", "Estimate", "Request"]);
  });

  it("bridges enterprise and trust journeys to their public routes", () => {
    renderInShell(<HomeContent />);

    const enterprise = screen.getByRole("region", { name: "Enterprise planning" });
    expect(within(enterprise).getByRole("link", { name: "Review infrastructure context" }))
      .toHaveAttribute("href", "/infrastructure");
    expect(within(enterprise).getByRole("link", { name: "Deployment review" }))
      .toHaveAttribute("href", "/contact");

    const trust = screen.getByRole("region", { name: "Trust and readiness" });
    expect(within(trust).getByRole("link", { name: "Trust boundary" }))
      .toHaveAttribute("href", "/trust");
    expect(within(trust).getByRole("link", { name: "Service status" }))
      .toHaveAttribute("href", "/status");
  });

  it("uses one launch-access action for the editorial rate section with truthful prepaid billing note", () => {
    renderInShell(<HomeContent />);

    const access = screen.getByRole("region", { name: "Prepaid access" });
    expect(within(access).getAllByRole("button", { name: "Get API access" })).toHaveLength(1);
    expect(within(access).getByText(
      "Billing is pay-per-use from your prepaid balance. Top up with redeem codes.",
    )).toBeVisible();
  });

  it("repeats the primary catalog facts after switching to Traditional Chinese", async () => {
    const user = userEvent.setup();
    renderInShell(<HomeContent />);

    await user.click(screen.getAllByRole("button", { name: "繁中" })[0]);

    const proof = screen.getByRole("region", { name: "市集事實" });
    expect(within(proof).getByText("8")).toBeVisible();
    expect(within(proof).getByText("131K")).toBeVisible();
    expect(within(proof).getByText("$0.01")).toBeVisible();
    expect(screen.getByText("API 已上線 — 一把金鑰，按量計費")).toBeVisible();
  });
});
