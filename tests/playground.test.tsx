import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { LanguagePicker } from "../components/language-picker";
import { PlaygroundContent } from "../components/playground-content";

function mount() { return render(<LocaleProvider><LanguagePicker /><PlaygroundContent /></LocaleProvider>); }
beforeEach(() => act(() => window.history.replaceState({}, "", "/playground")));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); act(() => window.history.replaceState({}, "", "/")); });

describe("API playground", () => {
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
