import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPortal } from "../components/admin-portal";
import { adminFetch, wrap } from "./support/admin-fetch";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const overview = {
  gatewayConfigured: true,
  state: { models: [{ id: "glm-5.2-fp8", enabled: true }, { id: "bge-m3", enabled: true }, { id: "zai-org/GLM-5.3", enabled: true }] },
  nodes: { nodes: [], actions: [] },
  metrics: null,
  errors: { state: null, nodes: null, metrics: null },
};
const status = (extra: Record<string, unknown> = {}) => ({
  model_id: "glm-5.2-fp8", enabled: true, draining: false, frozen: false,
  capacity: { model_id: "glm-5.2-fp8", mode: "observe", sellable_cap: 6, physical_cap: 8, reason: "policy", observed_at: 1_760_000_000 },
  workflow: null,
  ...extra,
});
const timeline = {
  model_id: "glm-5.2-fp8",
  events: [{ created_at: 1_760_000_000, event_type: "workflow_started", old_state: "queued", new_state: "running", actor: "admin", reason: "", result: "ok" }],
};
const fleetRoutes = (extra: Record<string, unknown> = {}) => ({
  "GET /admin/gateway": overview,
  "GET /admin/gateway/fleet/glm-5.2-fp8/status": status(),
  "GET /admin/gateway/fleet/glm-5.2-fp8/timeline": timeline,
  ...extra,
});

async function openFleet(user: ReturnType<typeof userEvent.setup>, model = "glm-5.2-fp8") {
  await user.click(await screen.findByRole("button", { name: `Fleet controls for ${model}` }));
  return screen.findByRole("region", { name: `Fleet controls for ${model}` });
}

describe("fleet panel on the gateway page", () => {
  it("loads status and timeline for a managed model", async () => {
    const user = userEvent.setup();
    const calls = adminFetch(fleetRoutes());
    wrap(<AdminPortal section="gateway" />);
    const panel = await openFleet(user);
    expect(await within(panel).findByText(/observe · 6 \/ 8/)).toBeVisible();
    expect(within(panel).getByText("workflow_started")).toBeVisible();
    expect(calls.map((call) => call.path)).toEqual(expect.arrayContaining(["/admin/gateway/fleet/glm-5.2-fp8/status", "/admin/gateway/fleet/glm-5.2-fp8/timeline"]));
  });

  it("explains an unmanaged model and offers no actions", async () => {
    const user = userEvent.setup();
    adminFetch({
      "GET /admin/gateway": overview,
      "GET /admin/gateway/fleet/bge-m3/status": Response.json({ error: "fleet_not_managed", detail: "x" }, { status: 404 }),
      "GET /admin/gateway/fleet/bge-m3/timeline": Response.json({ error: "fleet_not_managed", detail: "x" }, { status: 404 }),
    });
    wrap(<AdminPortal section="gateway" />);
    const panel = await openFleet(user, "bge-m3");
    expect(await within(panel).findByText("This model is not managed by the fleet controller (control_managed is off).")).toBeVisible();
    for (const name of ["Freeze", "Resume", "Start candidate", "Approve", "Drain", "Roll back"]) {
      expect(within(panel).queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("opens the panel for a model id with a colon", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/gateway": { ...overview, state: { models: [{ id: "glm:fp8", enabled: true }] } },
      "GET /admin/gateway/fleet/glm%3Afp8/status": status({ model_id: "glm:fp8" }),
      "GET /admin/gateway/fleet/glm%3Afp8/timeline": { model_id: "glm:fp8", events: [] },
    });
    wrap(<AdminPortal section="gateway" />);
    const panel = await openFleet(user, "glm:fp8");
    expect(await within(panel).findByText(/observe · 6 \/ 8/)).toBeVisible();
    expect(calls.map((call) => call.path)).toContain("/admin/gateway/fleet/glm%3Afp8/status");
  });

  it("disables fleet controls for model ids with a slash", async () => {
    adminFetch(fleetRoutes());
    wrap(<AdminPortal section="gateway" />);
    expect(await screen.findByRole("button", { name: "Fleet controls for zai-org/GLM-5.3" })).toBeDisabled();
  });

  it("confirms every action before sending, and sends no body", async () => {
    const user = userEvent.setup();
    const calls = adminFetch(fleetRoutes({ "POST /admin/gateway/fleet/glm-5.2-fp8/candidate": { job_id: "wf-1", state: "queued", phase: "queued" } }));
    wrap(<AdminPortal section="gateway" />);
    const panel = await openFleet(user);
    await user.click(await within(panel).findByRole("button", { name: "Start candidate" }));
    let dialog = await screen.findByRole("dialog", { name: "Start candidate glm-5.2-fp8?" });
    expect(within(dialog).getByText("Downloads, validates and warms up the candidate version, then waits for approval.")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await user.click(within(panel).getByRole("button", { name: "Start candidate" }));
    dialog = await screen.findByRole("dialog", { name: "Start candidate glm-5.2-fp8?" });
    await user.click(within(dialog).getByRole("button", { name: "Start candidate" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toEqual([
      { method: "POST", path: "/admin/gateway/fleet/glm-5.2-fp8/candidate", body: undefined },
    ]));
  });

  it("enables approve only when the workflow awaits approval, and freeze/resume by frozen state", async () => {
    const user = userEvent.setup();
    adminFetch(fleetRoutes());
    const view = wrap(<AdminPortal section="gateway" />);
    let panel = await openFleet(user);
    await within(panel).findByText(/observe/);
    expect(within(panel).getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Freeze" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "Resume" })).toBeDisabled();
    view.unmount();
    adminFetch(fleetRoutes({
      "GET /admin/gateway/fleet/glm-5.2-fp8/status": status({ frozen: true, workflow: { id: "wf-1", kind: "candidate", state: "awaiting_approval", phase: "ready" } }),
    }));
    wrap(<AdminPortal section="gateway" />);
    panel = await openFleet(user);
    await within(panel).findByText(/awaiting_approval/);
    expect(within(panel).getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "Freeze" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "Resume" })).toBeEnabled();
  });

  it("polls the job without overlap until it settles, then reloads, and stops on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const states = ["running", "awaiting_approval"];
    const calls = adminFetch(fleetRoutes({
      "POST /admin/gateway/fleet/glm-5.2-fp8/candidate": { job_id: "wf-1", state: "queued", phase: "queued" },
      "GET /admin/gateway/control/jobs/wf-1": () => ({ id: "wf-1", state: states.shift() ?? "awaiting_approval", phase: "ready" }),
    }));
    const view = wrap(<AdminPortal section="gateway" />);
    const panel = await openFleet(user);
    await user.click(await within(panel).findByRole("button", { name: "Start candidate" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Start candidate" }));
    const jobCalls = () => calls.filter((call) => call.path === "/admin/gateway/control/jobs/wf-1").length;
    const statusCalls = () => calls.filter((call) => call.path === "/admin/gateway/fleet/glm-5.2-fp8/status").length;
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(jobCalls()).toBe(0);
    const before = statusCalls();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(jobCalls()).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await waitFor(() => expect(jobCalls()).toBe(2));
    await waitFor(() => expect(statusCalls()).toBeGreaterThan(before));
    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(jobCalls()).toBe(2);
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(jobCalls()).toBe(2);
  });

  it("shows the gateway's reason for a conflict", async () => {
    const user = userEvent.setup();
    adminFetch(fleetRoutes({
      "POST /admin/gateway/fleet/glm-5.2-fp8/drain": Response.json({ error: "gateway_rejected", detail: "workflow already active" }, { status: 409 }),
    }));
    wrap(<AdminPortal section="gateway" />);
    const panel = await openFleet(user);
    await user.click(await within(panel).findByRole("button", { name: "Drain" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Drain" }));
    expect(await within(panel).findByText("workflow already active")).toBeVisible();
  });

  it("loads fleet events only when expanded", async () => {
    const user = userEvent.setup();
    const calls = adminFetch(fleetRoutes({
      "GET /admin/gateway/fleet/events?limit=100": {
        events: [{ observed_at: 1_760_000_000, model_id: "glm-5.2-fp8", mode: "frozen", previous_cap: 8, sellable_cap: 6, physical_cap: 8, reason: "operator", policy_version: "v1", event_id: 7 }],
      },
    }));
    wrap(<AdminPortal section="gateway" />);
    const toggle = await screen.findByRole("button", { name: "Show fleet events" });
    expect(calls.some((call) => call.path.startsWith("/admin/gateway/fleet/events"))).toBe(false);
    await user.click(toggle);
    expect(await screen.findByText("8 → 6 / 8")).toBeVisible();
    expect(calls.filter((call) => call.path.startsWith("/admin/gateway/fleet/events")).map((call) => call.path)).toEqual(["/admin/gateway/fleet/events?limit=100"]);
  });
});
