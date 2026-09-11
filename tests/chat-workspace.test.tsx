import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWorkspace, ChatAnswer } from "../components/chat-workspace";
import { SiteShell } from "../components/site-shell";
import { LocaleProvider } from "../components/locale-provider";
import { isAiWorkspacePath } from "../components/ai-workspace-shell";
import { AGENT_TEST_STORAGE_KEY, AGENT_TEST_TTL_MS, createAgentDraft } from "../lib/agent-blueprint";

beforeEach(() => {
  window.history.replaceState({}, "", "/chat");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({ trialAvailable: false, maxOutputTokens: 512 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });
function mount() { return render(<LocaleProvider><SiteShell><ChatWorkspace/></SiteShell></LocaleProvider>); }
async function connect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Connect model" }));
  await user.type(screen.getByLabelText("API key"), "sk-test-chat-memory-only");
  await user.click(screen.getByRole("button", { name: "Connect API key" }));
}
const result = { content: "A real test response from the controlled gateway.", mode: "live", finishReason: "stop", usage: { input: 10, output: 12, total: 22 } };

describe("Model chat tools", () => {
  it("keeps the brand homepage outside the optional model tools", () => {
    expect(isAiWorkspacePath("/")).toBe(false);
    for (const path of ["/chat", "/agents", "/agents/build"]) expect(isAiWorkspacePath(path)).toBe(true);
  });
  it("opens at the composer with working agent and company destinations", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What will youmake possible?");
    expect(screen.getByLabelText("Your message")).toBeVisible();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Explore agents" })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: "Back to main website" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("navigation", { name: "Model tools" })).toBeVisible();
    expect(screen.getByText("Model chat")).toBeVisible();
    expect(screen.queryByText("AI WORKSPACE")).not.toBeInTheDocument();
  });
  it("labels example conversations and makes no generation request", async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole("button", { name: /Find the right words/ }));
    expect(screen.getByText("Pre-written example · not a live response")).toBeVisible();
    expect(screen.getByText("For a busy team")).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => url === "/api/chat/config")).toBe(true);
    await user.type(screen.getByLabelText("Your message"), "Continue this idea");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText(/Key-free public trial is not open yet/)).toBeVisible();
  });
  it("keeps API credentials out of browser storage and sends real multi-turn history", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url) => Promise.resolve(Response.json(url === "/api/chat/config" ? { trialAvailable: false, maxOutputTokens: 512 } : result)));
    vi.stubGlobal("fetch", fetchMock); mount(); await connect(user);
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    await user.type(screen.getByLabelText("Your message"), "First question");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText(result.content);
    await user.type(screen.getByLabelText("Your message"), "Follow-up question");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/chat")).toHaveLength(2));
    const body = JSON.parse(fetchMock.mock.calls.filter(([url]) => url === "/api/chat")[1][1].body);
    expect(body.messages.map((item: { role: string }) => item.role)).toEqual(["user", "assistant", "user"]);
    expect(body.key).toBe("sk-test-chat-memory-only");
    expect(body.messages[0].content).toBe("First question");
  });
  it("keeps each model reply attributed to the model that answered", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url) => Promise.resolve(Response.json(url === "/api/chat/config" ? { trialAvailable: false, maxOutputTokens: 512 } : result))));
    mount(); await connect(user);
    await user.type(screen.getByLabelText("Your message"), "Which model is answering?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText(result.content);
    await user.selectOptions(screen.getByRole("combobox", { name: "Choose model" }), "qwen3-vl-30b");
    expect(screen.getByText("glm-5.2-fp8")).toBeVisible();
    expect(screen.queryByText("qwen3-vl-30b")).not.toBeInTheDocument();
  });
  it("uses trial when enabled without requesting a customer's key", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url) => Promise.resolve(Response.json(url === "/api/chat/config" ? { trialAvailable: true, maxOutputTokens: 512, remaining: 5 } : { ...result, mode: "trial" })));
    vi.stubGlobal("fetch", fetchMock); mount();
    await screen.findByRole("button", { name: "Public trial" });
    await user.type(screen.getByLabelText("Your message"), "Hello trial");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText("Trial model response");
    const body = JSON.parse(fetchMock.mock.calls.find(([url]) => url === "/api/chat")![1].body);
    expect(body.key).toBeUndefined(); expect(body.maxTokens).toBe(512);
  });
  it("restores an unsent message when the gateway cannot respond", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url) => Promise.resolve(url === "/api/chat/config" ? Response.json({ trialAvailable: true, maxOutputTokens: 512 }) : Response.json({ error: "gateway" }, { status: 502 }))));
    mount(); await screen.findByRole("button", { name: "Public trial" });
    await user.type(screen.getByLabelText("Your message"), "Preserve this question");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not complete");
    expect(screen.getByLabelText("Your message")).toHaveValue("Preserve this question");
  });
  it("cancels an active request and does not invent a reply", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url, init) => url === "/api/chat/config" ? Promise.resolve(Response.json({ trialAvailable: true, maxOutputTokens: 512 })) : new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("Aborted"))))));
    mount(); await screen.findByRole("button", { name: "Public trial" });
    await user.type(screen.getByLabelText("Your message"), "Cancel this");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await user.click(screen.getByRole("button", { name: "Stop response" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stopped waiting");
    expect(screen.queryByText(result.content)).not.toBeInTheDocument();
  });
  it("loads a bounded builder draft and includes its knowledge only on send", async () => {
    window.history.replaceState({}, "", "/chat?agent=custom");
    const draft = { ...createAgentDraft(), name: "Acme assistant", knowledge: "Office hours: 09:00–17:00" };
    sessionStorage.setItem(AGENT_TEST_STORAGE_KEY, JSON.stringify({ version: 1, draft, createdAt: Date.now(), expiresAt: Date.now() + AGENT_TEST_TTL_MS }));
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url) => Promise.resolve(Response.json(url === "/api/chat/config" ? { trialAvailable: true, maxOutputTokens: 512 } : { ...result, mode: "trial" })));
    vi.stubGlobal("fetch", fetchMock); mount();
    await screen.findByRole("heading", { level: 1, name: /Acme assistant/ });
    expect(screen.getByRole("link", { name: "Edit agent" })).toHaveAttribute("href", "/agents/build?draft=session");
    await screen.findByRole("button", { name: "Public trial" });
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByText(result.content);
    expect(JSON.parse(fetchMock.mock.calls.find(([url]) => url === "/api/chat")![1].body).system).toContain("Office hours: 09:00–17:00");
  });
  it("keeps a new chat clear even if an older request completes later", async () => {
    const user = userEvent.setup(); let resolveRequest: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url) => url === "/api/chat/config" ? Promise.resolve(Response.json({ trialAvailable: true, maxOutputTokens: 512 })) : new Promise((resolve) => { resolveRequest = resolve; })));
    mount(); await screen.findByRole("button", { name: "Public trial" });
    await user.type(screen.getByLabelText("Your message"), "Old question"); await user.click(screen.getByRole("button", { name: "Send message" }));
    await user.click(screen.getByRole("link", { name: "New conversation" }));
    resolveRequest!(Response.json(result));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What will you"));
    expect(screen.queryByText(result.content)).not.toBeInTheDocument();
  });
  it("supports Traditional Chinese and a keyboard-dismissable connection dialog", async () => {
    const user = userEvent.setup(); mount();
    await user.click(screen.getByRole("button", { name: "繁中" }));
    expect(screen.getByLabelText("你的訊息")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "連接模型" }));
    expect(within(screen.getByRole("dialog")).getByRole("heading")).toHaveTextContent("開始真正的對話");
    await user.keyboard("{Escape}"); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("renders model text as text, never executable HTML", () => {
    const { container } = render(<ChatAnswer content={'<img src=x onerror=alert(1)>\n\n```html\n<script>unsafe()</script>\n```'}/>);
    expect(container.querySelector("img,script")).toBeNull();
    expect(container.textContent).toContain("onerror=alert(1)");
  });
});
