import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { TaskConsole } from "../components/task-console";
import type { TaskDetail } from "../lib/runtime-client";

const taskId = "a".repeat(32);
const approvalId = "b".repeat(32);
const artifactId = "c".repeat(32);
const config = {
  enabled: true, available: true, models: ["test-model"],
  tools: ["read_reference", "analyze_csv", "write_artifact", "read_url", "update_plan"],
  limits: { maxSteps: 20, maxOutputTokens: 4096, maxReferences: 8, referenceCharacters: 32000 },
};
function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: taskId, goal: "Analyze the monthly sales", status: "running", model: "test-model",
    agentId: null, agentVersion: null, createdAt: "2026-09-22T01:00:00Z", updatedAt: "2026-09-22T01:01:00Z",
    stepCount: 2, maxSteps: 12, maxOutputTokens: 1024, requestedControl: null,
    usage: { inputTokens: 320, outputTokens: 120 }, summary: "", error: null,
    plan: [{ id: "step1", title: "Review source data", status: "completed" }],
    events: [{ id: "event1", kind: "tool", title: "Read reference", content: "Read sales.csv", createdAt: "2026-09-22T01:00:00Z" }],
    references: [{ id: "ref1", name: "sales.csv", content: "month,total\nAugust,12" }],
    artifacts: [], approval: null, ...overrides,
  };
}
function api(initialTasks: ReturnType<typeof task>[] = [], configuration = config) {
  let tasks = initialTasks;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/runtime/config")) return Response.json(configuration);
    if (path.endsWith("/agents")) return Response.json({ agents: [{ id: "d".repeat(32), name: "Research assistant", version: 3 }] });
    if (path.endsWith("/runtime/tasks") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      tasks = [task({ goal: body.goal, model: body.model, maxSteps: body.maxSteps, maxOutputTokens: body.maxOutputTokens, references: body.references.map((reference: { name: string; content: string }, index: number) => ({ ...reference, id: `ref${index}` })), status: "queued", stepCount: 0 }), ...tasks];
      return Response.json({ task: tasks[0] }, { status: 201 });
    }
    if (path.endsWith("/runtime/tasks")) return Response.json({ tasks });
    if (path.endsWith("/control")) {
      const { action } = JSON.parse(String(init?.body));
      tasks = [task({ ...tasks[0], requestedControl: action })];
      return Response.json({ task: tasks[0] });
    }
    if (path.endsWith("/instructions")) return Response.json({ task: tasks[0] });
    if (path.endsWith("/approval")) {
      tasks = [task({ ...tasks[0], status: "queued", approval: tasks[0].approval ? { ...tasks[0].approval, status: "approved" } : null })];
      return Response.json({ task: tasks[0] });
    }
    if (path.endsWith(`/artifacts/${artifactId}`)) return Response.json({ artifact: { id: artifactId, name: "../report.html", mimeType: "text/html", size: 21, contentBase64: btoa("<script>bad()</script>") } });
    if (path.endsWith(`/tasks/${taskId}`)) return Response.json({ task: tasks[0] });
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const mount = () => render(<LocaleProvider><TaskConsole /></LocaleProvider>);
beforeEach(() => window.history.replaceState({}, "", "/tasks"));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("persistent task console", () => {
  it("requires sign-in and offers a return to tasks without starting work", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "auth_required" }, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    mount();
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Ftasks");
    expect(screen.queryByLabelText("Your API key")).not.toBeInTheDocument();
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it("explains unavailable runtime configuration and prevents submissions", async () => {
    api([], { ...config, available: false, enabled: false });
    mount();
    expect(await screen.findByText(/Task execution is not available/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Start task" })).not.toBeInTheDocument();
  });

  it("submits the explicit goal, references and bounds once and clears the API key", async () => {
    const user = userEvent.setup();
    const fetcher = api();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    mount();
    const goal = await screen.findByLabelText("What should the agent accomplish?");
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await user.type(goal, "Compare these sales and create a report");
    await user.type(screen.getByLabelText("Your API key"), "sk-user-key-123");
    await user.click(screen.getByText("References (optional)"));
    await user.type(screen.getByLabelText("Reference name"), "sales.csv");
    fireEvent.change(screen.getByLabelText("Reference text"), { target: { value: "month,total\nAugust,12" } });
    await user.click(screen.getByRole("button", { name: "Add reference" }));
    await user.click(screen.getByRole("button", { name: "Start task" }));
    await screen.findByRole("heading", { name: "Compare these sales and create a report" });
    const posts = fetcher.mock.calls.filter(([url, init]) => url.endsWith("/runtime/tasks") && init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
      goal: "Compare these sales and create a report", model: "test-model", apiKey: "sk-user-key-123",
      maxSteps: 12, maxOutputTokens: 1024, references: [{ name: "sales.csv", content: "month,total\nAugust,12" }],
    });
    await user.click(screen.getByRole("button", { name: "New task" }));
    expect(screen.getByLabelText("Your API key")).toHaveValue("");
    expect(storage).not.toHaveBeenCalled();
  });

  it("shows the exact pending URL and binds approval to the displayed request", async () => {
    const user = userEvent.setup();
    const fetcher = api([task({ status: "awaiting_approval", approval: {
      id: approvalId, tool: "read_url", args: { url: "https://example.com/report?q=2026" }, reason: "Read the published source", status: "pending",
    } })]);
    mount();
    expect(await screen.findByText("https://example.com/report?q=2026")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume task" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve this read" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve this read" })).not.toBeInTheDocument());
    const post = fetcher.mock.calls.find(([url]) => url.endsWith("/approval"));
    expect(post?.[0]).toBe(`/api/portal/runtime/tasks/${taskId}/approval`);
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ approvalId, decision: "approve" });
  });

  it("requires a pending approval decision even when a task is paused", async () => {
    api([task({ status: "paused", approval: {
      id: approvalId, tool: "read_url", args: { url: "https://example.com/report" }, reason: "Read the published source", status: "pending",
    } })]);
    mount();
    expect(await screen.findByRole("button", { name: "Approve this read" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume task" })).not.toBeInTheDocument();
  });

  it("requires pasted references to be added before submitting, and rejects oversized files", async () => {
    const user = userEvent.setup();
    const fetcher = api();
    mount();
    await user.type(await screen.findByLabelText("What should the agent accomplish?"), "Review the source");
    await user.type(screen.getByLabelText("Your API key"), "sk-user-key-123");
    await user.click(screen.getByText("References (optional)"));
    await user.type(screen.getByLabelText("Reference text"), "Pending reference");
    expect(screen.getByRole("button", { name: "Start task" })).toBeDisabled();
    await user.upload(screen.getByLabelText("Choose text files"), new File(["a".repeat(32001)], "large.txt", { type: "text/plain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("32,000 characters in total");
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("imports text files and includes their contents in the requested task", async () => {
    const user = userEvent.setup();
    const fetcher = api();
    mount();
    await user.type(await screen.findByLabelText("What should the agent accomplish?"), "Summarize the brief");
    await user.type(screen.getByLabelText("Your API key"), "sk-user-key-123");
    await user.click(screen.getByText("References (optional)"));
    await user.upload(screen.getByLabelText("Choose text files"), new File(["# Brief\nKeep this precise."], "brief.md", { type: "text/markdown" }));
    expect(await screen.findByRole("button", { name: "Remove brief.md" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start task" }));
    await screen.findByRole("heading", { name: "Summarize the brief" });
    const post = fetcher.mock.calls.find(([url, init]) => url.endsWith("/runtime/tasks") && init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body)).references).toEqual([{ name: "brief.md", content: "# Brief\nKeep this precise." }]);
  });

  it("keeps a failed submission editable while clearing its key and showing an honest error", async () => {
    const user = userEvent.setup();
    const fetcher = api();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => String(url).endsWith("/runtime/tasks") && init?.method === "POST"
      ? Promise.resolve(Response.json({ error: "unavailable" }, { status: 503 })) : original(url, init));
    mount();
    await user.type(await screen.findByLabelText("What should the agent accomplish?"), "Keep my draft");
    await user.type(screen.getByLabelText("Your API key"), "sk-user-key-123");
    await user.click(screen.getByRole("button", { name: "Start task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This service is unavailable");
    expect(screen.getByLabelText("Your API key")).toHaveValue("");
    expect(screen.getByLabelText("What should the agent accomplish?")).toHaveValue("Keep my draft");
    expect(screen.queryByRole("button", { name: "Pause task" })).not.toBeInTheDocument();
  });

  it("explains how to resolve the active-task limit", async () => {
    const user = userEvent.setup();
    const fetcher = api();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => String(url).endsWith("/runtime/tasks") && init?.method === "POST"
      ? Promise.resolve(Response.json({ error: "active_limit" }, { status: 409 })) : original(url, init));
    mount();
    await user.type(await screen.findByLabelText("What should the agent accomplish?"), "Another task");
    await user.type(screen.getByLabelText("Your API key"), "sk-user-key-123");
    await user.click(screen.getByRole("button", { name: "Start task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Finish or cancel an existing task");
  });

  it("reports pause as requested until the server reaches a boundary and durably sends steering", async () => {
    const user = userEvent.setup();
    const fetcher = api([task()]);
    mount();
    await user.click(await screen.findByRole("button", { name: "Pause task" }));
    expect(await screen.findByText(/Pause requested/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume task" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Add an instruction"), "Use the revised forecast");
    await user.click(screen.getByRole("button", { name: "Send instruction" }));
    expect(await screen.findByText(/Instruction saved/)).toBeVisible();
    const post = fetcher.mock.calls.find(([url]) => url.endsWith("/instructions"));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ message: "Use the revised forecast" });
    expect(screen.getByLabelText("Add an instruction")).toHaveValue("");
  });

  it("downloads owner-scoped artifacts as attachments without rendering generated HTML", async () => {
    const user = userEvent.setup();
    const fetcher = api([task({ status: "completed", artifacts: [{ id: artifactId, name: "report.html", mimeType: "text/html", size: 21, createdAt: "2026-09-22T01:00:00Z" }] })]);
    const create = vi.fn().mockReturnValue("blob:task-report");
    const revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const clicked: { href: string; name: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ href: this.href, name: this.download }); });
    mount();
    await user.click(await screen.findByRole("button", { name: "Download report.html" }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(fetcher.mock.calls.some(([url]) => url === `/api/portal/runtime/tasks/${taskId}/artifacts/${artifactId}`)).toBe(true);
    expect(clicked[0].href).toBe("blob:task-report");
    expect(clicked[0].name).not.toMatch(/[\\/]/);
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(revoke).toHaveBeenCalledWith("blob:task-report");
    expect(document.querySelector("script, iframe")).toBeNull();
  });

  it("polls saved progress without duplicate task creation and aborts when unmounted", async () => {
    vi.useFakeTimers();
    const fetcher = api([task()]);
    const view = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Read sales.csv")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith(`/tasks/${taskId}`)).length).toBeGreaterThan(1);
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    view.unmount();
    const count = fetcher.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(fetcher.mock.calls).toHaveLength(count);
    expect(fetcher.mock.calls.filter(([, init]) => init?.signal).every(([, init]) => init?.signal?.aborted)).toBe(true);
  });

  it("uses Traditional Chinese for creation and saved task status", async () => {
    window.localStorage.setItem("pc-locale", "zh");
    api([task({ status: "paused" })]);
    mount();
    expect(await screen.findByRole("button", { name: "繼續任務" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "智能體任務" })).toBeVisible();
    expect(within(screen.getByRole("region", { name: "執行計畫" })).getByText("已完成")).toBeVisible();
  });
});
