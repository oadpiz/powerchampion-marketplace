import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentAccount } from "../components/agent-account";
import { LocaleProvider } from "../components/locale-provider";
import { createAgentDraft } from "../lib/agent-blueprint";

const agent = { id: "a".repeat(32), name: "Research desk", version: 3, tokenPrefix: "pc_agent_prefix", updatedAt: 1 };
const secondAgent = { ...agent, id: "b".repeat(32), name: "Support desk", version: 1 };

function mount() {
  return render(<LocaleProvider><AgentAccount draft={createAgentDraft("research", "en")} valid onLoad={vi.fn()} /></LocaleProvider>);
}

beforeEach(() => act(() => window.history.replaceState({}, "", "/agents/build?template=research")));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("saved agent task handoff", () => {
  it("returns sign-in and registration to the current builder template", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    mount();
    for (const label of ["Sign in", "Create an account"]) {
      const link = await screen.findByRole("link", { name: label });
      const destination = new URL(link.getAttribute("href")!, "http://localhost");
      expect(destination.pathname).toBe(label === "Sign in" ? "/login" : "/register");
      expect(destination.searchParams.get("next")).toBe("/agents/build?template=research");
    }
  });

  it("offers each saved agent as a task choice without executing or putting credentials in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ agents: [agent, secondAgent] }));
    vi.stubGlobal("fetch", fetchMock);
    mount();
    for (const saved of [agent, secondAgent]) {
      const link = await screen.findByRole("link", { name: `Run task — ${saved.name}` });
      expect(link).toHaveAttribute("href", `/tasks?agent=${saved.id}`);
      expect(link.getAttribute("href")).not.toContain(saved.tokenPrefix);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/portal/agents");
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });

  it("offers the newly saved version for review without starting a task", async () => {
    const user = userEvent.setup();
    const saved = { ...agent, version: 1 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ agents: [] }))
      .mockResolvedValueOnce(Response.json({ agent: saved, token: "pc_agent_new_secret" }))
      .mockResolvedValueOnce(Response.json({ agents: [saved] }));
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await user.click(await screen.findByRole("button", { name: "Save as a new agent" }));
    const handoff = await screen.findByRole("region", { name: "Continue with this saved agent" });
    expect(handoff).toHaveTextContent("Research desk · version 1");
    expect(handoff).toHaveTextContent("Unsaved builder changes are not included");
    expect(within(handoff).getByRole("link", { name: "Open in Agent tasks" })).toHaveAttribute("href", `/tasks?agent=${agent.id}`);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    expect(fetchMock.mock.calls.map(([path, options]) => [path, options.method ?? "GET"])).toEqual([
      ["/api/portal/agents", "GET"], ["/api/portal/agents", "POST"], ["/api/portal/agents", "GET"],
    ]);
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).not.toContain("pc_agent_new_secret");
  });

  it("localizes the task links and describes execution availability separately from chat", async () => {
    localStorage.setItem("pc-locale", "zh");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ agents: [agent] })));
    mount();
    expect(await screen.findByRole("link", { name: "執行任務 — Research desk" })).toHaveAttribute("href", `/tasks?agent=${agent.id}`);
    expect(screen.getByText(/任務執行是否開放/)).toBeVisible();
  });
});
