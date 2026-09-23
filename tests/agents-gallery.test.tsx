import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsGallery } from "../components/agents-gallery";
import { LocaleProvider } from "../components/locale-provider";
import { LanguagePicker } from "../components/language-picker";
import { AGENT_TEMPLATES, getAgentTemplate } from "../lib/agents";

beforeEach(() => act(() => window.history.replaceState({}, "", "/agents")));
afterEach(() => {
  vi.restoreAllMocks();
  act(() => window.history.replaceState({}, "", "/"));
});

function renderGallery() {
  return render(
    <LocaleProvider>
      <LanguagePicker />
      <AgentsGallery />
    </LocaleProvider>,
  );
}

describe("AI assistant gallery", () => {
  it("provides task execution discovery separately from chat without starting a request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderGallery();
    const tasks = screen.getByRole("region", { name: "From a prompt to a deliverable." });
    expect(within(tasks).getByRole("link", { name: "Open task console" })).toHaveAttribute("href", "/tasks");
    expect(within(tasks).getByRole("link", { name: "Create an agent" })).toHaveAttribute("href", "/agents/build");
    expect(tasks).toHaveTextContent(/shows whether task execution is enabled/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("connects each template to chat and the builder, with honest capability boundaries", () => {
    renderGallery();
    for (const template of AGENT_TEMPLATES) {
      const card = screen.getByRole("article", { name: template.name.en });
      expect(
        within(card).getByRole("link", {
          name: `Try assistant — ${template.name.en}`,
        }),
      ).toHaveAttribute("href", `/chat?agent=${template.id}`);
      expect(
        within(card).getByRole("link", {
          name: `Customize — ${template.name.en}`,
        }),
      ).toHaveAttribute("href", `/agents/build?template=${template.id}`);
      expect(card).toHaveTextContent(template.starter.en);
    }
    expect(
      screen.getByText(
        /Company knowledge, web search, and actions in other systems require a separate integration/,
      ),
    ).toBeVisible();
    expect(getAgentTemplate("missing")).toBeUndefined();
    expect(getAgentTemplate(null)).toBeUndefined();
    expect(getAgentTemplate("coding")?.instructions.en).toContain(
      "Never claim a command was run or tests passed",
    );
  });

  it("publishes the roadmap with an honest state on every item and no delivery promise", () => {
    renderGallery();
    const roadmap = screen.getByRole("region", { name: "Where this is going." });
    const items = within(roadmap).getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.dataset.state).toMatch(/^(shipped|building|planned)$/);
      expect(item).toHaveTextContent(/SHIPPED|IN DEVELOPMENT|PLANNED/);
    }
    // Only what a customer can use today may be marked shipped.
    const shipped = items.filter((item) => item.dataset.state === "shipped");
    expect(shipped).toHaveLength(1);
    expect(shipped[0]).toHaveTextContent(/own endpoint/i);
    expect(roadmap).toHaveTextContent(/Nothing on this page is a delivery commitment/);
    // No date or quarter may be promised here.
    expect(roadmap.textContent ?? "").not.toMatch(/\bQ[1-4]\b|\b20\d\d\b|\b(week|month)s?\b/i);
    expect(
      within(roadmap).getByRole("link", { name: /Discuss a requirement/ }),
    ).toHaveAttribute("href", "/contact");
  });

  it("filters assistants by category and search, and recovers from no results", async () => {
    const user = userEvent.setup();
    renderGallery();
    await user.click(screen.getByRole("button", { name: "Engineering" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(
      screen.getByRole("article", { name: "Coding companion" }),
    ).toBeVisible();
    await user.type(
      screen.getByRole("searchbox", { name: "Search assistants" }),
      "unknown task",
    );
    expect(screen.getByText("No assistants match this search.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("article")).toHaveLength(4);
    await user.type(screen.getByRole("searchbox"), "policy");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(
      screen.getByRole("article", { name: "Customer support" }),
    ).toBeVisible();
  });

  it("prepares an editable email draft without transmitting the project brief", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderGallery();
    expect(
      screen.queryByRole("link", { name: "Open email draft" }),
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Your name" }),
      "Taylor",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Work email" }),
      "taylor@example.com",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Company (optional)" }),
      "Example & Co",
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "What should the agent help your team do?",
      }),
      "Help support staff draft replies from product policies.",
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Knowledge and systems to connect (optional)",
      }),
      "Product guide and a help desk API.",
    );
    await user.click(
      screen.getByRole("button", { name: "Review project brief" }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    const draft = screen.getByRole("textbox", { name: "Editable email draft" });
    expect((draft as HTMLTextAreaElement).value).toContain("Example & Co");
    expect((draft as HTMLTextAreaElement).value).toContain(
      "Help support staff draft replies",
    );
    await user.clear(draft);
    await user.type(
      draft,
      "Reviewed brief: limit the initial project to internal reply drafts.",
    );
    const href = screen
      .getByRole("link", { name: "Open email draft" })
      .getAttribute("href")!;
    expect(href).toMatch(/^mailto:info@powerchampion\.org\?/);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("subject")).toBe(
      "AI agent project inquiry — Example & Co",
    );
    expect(params.get("body")).toBe(
      "Reviewed brief: limit the initial project to internal reply drafts.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("offers a manual copy fallback and localizes the gallery and service brief", async () => {
    const user = userEvent.setup();
    renderGallery();
    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.click(screen.getByRole("button", { name: "繁體中文" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "找到適合你工作方式的 AI 助手。",
    );
    expect(screen.getByRole("article", { name: "客服回覆助手" })).toBeVisible();
    expect(screen.getByRole("link", { name: "開啟任務控制台" })).toHaveAttribute("href", "/tasks");
    await user.type(
      screen.getByRole("textbox", { name: "你的姓名" }),
      "測試使用者",
    );
    await user.type(
      screen.getByRole("textbox", { name: "工作信箱" }),
      "test@example.com",
    );
    await user.type(
      screen.getByRole("textbox", { name: "希望代理協助團隊完成什麼？" }),
      "協助整理公司提供的產品資訊。",
    );
    await user.click(screen.getByRole("button", { name: "預覽專案需求" }));
    const clipboard = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("Unavailable"));
    await user.click(screen.getByRole("button", { name: "複製需求" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "目前無法自動複製，請選取草稿文字並手動複製。",
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "可編輯的郵件草稿",
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("協助整理公司提供的產品資訊。");
    clipboard.mockRestore();
  });
});
