import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { LanguagePicker } from "../components/language-picker";
import { PlaygroundContent } from "../components/playground-content";

function mount() { return render(<LocaleProvider><LanguagePicker /><PlaygroundContent /></LocaleProvider>); }
beforeEach(() => act(() => window.history.replaceState({}, "", "/playground")));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); act(() => window.history.replaceState({}, "", "/")); });

describe("API playground", () => {
  it("redacts escaped credentials before generating a runnable snippet", async () => {
    const user = userEvent.setup();
    mount();
    const secret = "sk-quote\"and\\slash'key";
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: secret } });
    fireEvent.change(screen.getByLabelText("Your prompt"), { target: { value: `Do not include ${secret}` } });
    for (const language of ["cURL", "Python", "JavaScript"]) {
      await user.click(screen.getByRole("tab", { name: language }));
      expect(screen.getByRole("tabpanel").textContent).toContain("Do not include [redacted]");
    }
  });

  it("preserves an open reasoning section and its focus when the page becomes hidden", async () => {
    const user = userEvent.setup();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ content: "Answer", reasoning: "Supporting reasoning", finishReason: "stop", usage: null })));
    mount();
    await user.type(screen.getByLabelText("API key"), "sk-reasoning-focus");
    await user.type(screen.getByLabelText("Your prompt"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send API request" }));
    const summary = await screen.findByText("Model reasoning");
    await user.click(summary);
    summary.focus();
    expect(summary.closest("details")).toHaveAttribute("open");
    act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByText("Model reasoning").closest("details")).toHaveAttribute("open");
    expect(summary).toHaveFocus();
  });

  it("ignores a late code-copy confirmation after switching languages", async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise<void>((resolve) => { finish = resolve; }) } });
    mount();
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    await user.click(screen.getByRole("tab", { name: "Python" }));
    await act(async () => { finish?.(); });
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("does not mark a new answer copied when an older clipboard operation settles", async () => {
    const user = userEvent.setup();
    let finish: (() => void) | undefined;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => new Promise<void>((resolve) => { finish = resolve; }) } });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ content: "Answer A", reasoning: null, finishReason: "stop", usage: null }))
      .mockResolvedValueOnce(Response.json({ content: "Answer B", reasoning: null, finishReason: "stop", usage: null })));
    mount();
    await user.type(screen.getByLabelText("API key"), "sk-late-copy");
    await user.type(screen.getByLabelText("Your prompt"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send API request" }));
    await user.click(await screen.findByRole("button", { name: "Copy response" }));
    await user.click(screen.getByRole("button", { name: "Send API request" }));
    expect(await screen.findByText("Answer B")).toBeVisible();
    await act(async () => { finish?.(); });
    expect(screen.queryByText("Response copied")).not.toBeInTheDocument();
  });

  it("keeps a completed answer attributed to the model that actually answered", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ content: "Original model answer", usage: null })));
    mount();
    await user.type(screen.getByLabelText("API key"), "sk-model-attribution");
    await user.type(screen.getByLabelText("Your prompt"), "Summarize queues");
    await user.click(screen.getByRole("button", { name: "Send API request" }));
    expect(await screen.findByText("Original model answer")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Model"), "qwen3-vl-30b");
    const response = within(screen.getByRole("region", { name: "Response" }));
    expect(response.getByText("glm-5.2-fp8")).toBeVisible();
    expect(response.queryByText("qwen3-vl-30b")).not.toBeInTheDocument();
  });

  it("loads a useful example without sending it or replacing custom settings", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    mount();
    await user.click(screen.getByText("Advanced settings"));
    await user.type(screen.getByLabelText("System instructions"), "My custom instructions");
    await user.click(screen.getByRole("button", { name: /Extract structured data/ }));
    expect((screen.getByLabelText("Your prompt") as HTMLTextAreaElement).value).toContain("JSON");
    expect(screen.getByLabelText("System instructions")).toHaveValue("My custom instructions");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switches code with the keyboard and keeps the API key out of every language", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText("API key"), "sk-private-snippet");
    await user.type(screen.getByLabelText("Your prompt"), "Hello sk-private-snippet");
    await user.click(screen.getByRole("tab", { name: "cURL" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Python" })).toHaveFocus();
    expect(screen.getByRole("tabpanel").textContent).toContain("import urllib.request");
    expect(screen.getByRole("tabpanel").textContent).not.toContain("sk-private-snippet");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "JavaScript" })).toHaveFocus();
    expect(screen.getByRole("tabpanel").textContent).toContain("process.env.POWERCHAMPION_API_KEY");
    expect(screen.getByRole("tabpanel").textContent).not.toContain("sk-private-snippet");
  });

  it("copies only the final answer and handles a blocked response clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ content: "Final answer", reasoning: "Reasoning notes", usage: null })));
    mount();
    await user.type(screen.getByLabelText("API key"), "sk-copy-response");
    await user.type(screen.getByLabelText("Your prompt"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send API request" }));
    await user.click(await screen.findByRole("button", { name: "Copy response" }));
    expect(writeText).toHaveBeenCalledWith("Final answer");
    expect(screen.getByText("Response copied")).toBeVisible();
    writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
    await user.click(screen.getByRole("button", { name: "Copy response" }));
    expect(screen.getByText("Select the response to copy it manually.")).toBeVisible();
  });

  it("uses a valid catalog link without requesting generation and rejects unsupported model query values", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    act(() => window.history.replaceState({}, "", "/playground?model=qwen3-vl-30b"));
    const first = mount();
    expect(screen.getByLabelText("Model")).toHaveValue("qwen3-vl-30b");
    expect(screen.getByText(/Requests use your API credits/)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    first.unmount();
    act(() => window.history.replaceState({}, "", "/playground?model=flux-schnell"));
    mount();
    expect(screen.getByLabelText("Model")).toHaveValue("glm-5.2-fp8");
  });

  it("sends only on explicit submission, displays actual output and usage, and never persists or copies the key", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ content: "A concise answer.", reasoning: null, finishReason: "stop", usage: { input: 17, output: 8, total: 25 } }));
    vi.stubGlobal("fetch", fetchMock);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    mount();
    await user.type(screen.getByLabelText("API key"), "sk-secret-component-test");
    await user.type(screen.getByLabelText("Your prompt"), "Explain queues");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Send API request" }));
    expect(await screen.findByText("A concise answer.")).toBeVisible();
    expect(screen.getByText("25")).toBeVisible();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/playground");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ key: "sk-secret-component-test", prompt: "Explain queues", maxTokens: 512 });
    expect(storage).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Request code" }).textContent).not.toContain("sk-secret-component-test");
    await user.click(screen.getByRole("button", { name: "Clear key" }));
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });

  it("cancels an in-flight request and ignores late results", async () => {
    const user = userEvent.setup();
    let resolveRequest: ((value: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveRequest = resolve; })));
    mount();
    await user.type(screen.getByLabelText("API key"), "sk-test-cancellation");
    await user.type(screen.getByLabelText("Your prompt"), "Hello");
    await user.click(screen.getByRole("button", { name: "Send API request" }));
    const requestSignal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    expect(requestSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Request cancelled/)).toBeVisible();
    resolveRequest?.(Response.json({ content: "Late answer", usage: null }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send API request" })).toBeEnabled());
    expect(screen.queryByText("Late answer")).not.toBeInTheDocument();
  });

  it("shows a localized safe gateway failure without upstream details", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "authentication", detail: "sk-do-not-display" }, { status: 401 })));
    mount();
    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.click(screen.getByRole("button", { name: "繁體中文" }));
    await user.type(screen.getByLabelText("API 金鑰"), "sk-invalid-key");
    await user.type(screen.getByLabelText("你的提示詞"), "你好");
    await user.click(screen.getByRole("button", { name: "傳送 API 請求" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("請確認 API 金鑰有效");
    expect(screen.queryByText("sk-do-not-display")).not.toBeInTheDocument();
  });

  it("blocks invalid settings and safely handles unavailable clipboard access", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    mount();
    fireEvent.change(screen.getByLabelText("Maximum output tokens"), { target: { value: "99999" } });
    expect(screen.getByRole("button", { name: "Send API request" })).toBeDisabled();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText("Copy is unavailable. Select the code to copy it manually.")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
