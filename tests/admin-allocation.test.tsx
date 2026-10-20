import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  AdminAllocationSection,
  SYNC_STEPS,
  type AllocationState,
} from "../components/admin-allocation-section";
import { LocaleProvider } from "../components/locale-provider";

const NUMBERS = [11, 12, 13, 14, 15, 16, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const OWNERS: Record<string, string> = {
  justin: "11 12 13",
  mwind: "15 16 22",
  zhuling: "23 24 25",
  nati: "26 27 28",
  ll: "29 30",
};
const engineerId = (username: string) => username.padEnd(32, "0").replace(/[^a-f0-9]/g, "a").slice(0, 32);

function seedState(): AllocationState {
  const owner = (n: number) => Object.keys(OWNERS).find((u) => OWNERS[u].split(" ").includes(String(n)));
  return {
    revision: 3,
    ownerEmail: null,
    lastExport: null,
    nodes: NUMBERS.map((n) => {
      const user = owner(n);
      return {
        name: `b300-${n}`,
        ip: `172.16.10.${n}`,
        role: n === 14 || n === 31 ? "selling" : user ? "engineer" : "reserved",
        engineerId: user ? engineerId(user) : null,
        engineer: user ? { id: engineerId(user), username: user, displayName: user } : null,
        note: "",
        updatedAt: "2026-10-20T08:00:00Z",
        updatedBy: null,
        pendingCleanup: null,
      };
    }),
    engineers: Object.keys(OWNERS).map((username) => ({
      id: engineerId(username),
      clusterId: `eng${Object.keys(OWNERS).indexOf(username) + 1}`,
      username,
      email: `${username}@oadpiz.com`,
      displayName: username,
      sshPubkey: username === "nati" ? "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOx nati@laptop" : null,
      keyFingerprint: username === "nati" ? "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" : null,
      keyType: username === "nati" ? "ssh-ed25519" : null,
      active: true,
      nodes: OWNERS[username].split(" ").map((n) => `b300-${n}`),
      createdAt: null,
      updatedAt: null,
    })),
    summary: {
      selling: 2,
      engineer: 14,
      reserved: 0,
      perEngineer: Object.keys(OWNERS).map((username) => ({
        id: engineerId(username),
        username,
        nodes: OWNERS[username].split(" ").length,
      })),
    },
    pendingCleanup: [],
  };
}

type Call = { method: string; path: string; body: unknown };
function stubPortal(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace("/api/portal", "");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const route = routes[`${method} ${path}`];
      if (!route) return Response.json({ error: "not_found" }, { status: 404 });
      const value = route(body);
      return value instanceof Response ? value : Response.json(value);
    }),
  );
  return calls;
}

const wrap = () => render(<LocaleProvider><AdminAllocationSection /></LocaleProvider>);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin node allocation section", () => {
  it("renders the summary, all 16 nodes and the engineer list", async () => {
    stubPortal({ "GET /admin/allocation": () => seedState() });
    wrap();
    expect(await screen.findByText("Selling: 2")).toBeVisible();
    expect(screen.getByText("Engineers: 14")).toBeVisible();
    expect(screen.getByText("Reserved: 0")).toBeVisible();
    expect(screen.getByText("ll: 2")).toBeVisible();
    const nodes = screen.getByRole("table", { name: "GPU node allocation" });
    expect(within(nodes).getAllByRole("row")).toHaveLength(17);
    const b14 = within(nodes).getByRole("rowheader", { name: "b300-14" }).closest("tr")!;
    expect(within(b14).getByText("172.16.10.14")).toBeVisible();
    expect(within(b14).getByText("Selling")).toBeVisible();
    const engineers = screen.getByRole("table", { name: "Engineers" });
    expect(within(engineers).getAllByText("No key yet (exported as CHANGE_ME)")).toHaveLength(4);
    expect(within(engineers).getByText("SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")).toBeVisible();
    expect(within(engineers).getByText("eng5")).toBeVisible();
  });

  it("asks for confirmation before a node leaves selling and sends the explicit flag", async () => {
    const user = userEvent.setup();
    const updated = seedState();
    updated.nodes[3] = { ...updated.nodes[3], role: "reserved" };
    updated.revision = 4;
    const calls = stubPortal({
      "GET /admin/allocation": () => seedState(),
      "POST /admin/allocation/nodes/b300-14": () => updated,
    });
    wrap();
    await user.click(await screen.findByRole("button", { name: "Edit b300-14" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "b300-14 role" }), "reserved");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: "Move b300-14 out of selling?" });
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Move out of selling" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")).toEqual({
      method: "POST",
      path: "/admin/allocation/nodes/b300-14",
      body: { role: "reserved", note: "", expected_revision: 3, confirm_selling_change: true },
    });
    const row = (await screen.findByRole("rowheader", { name: "b300-14" })).closest("tr")!;
    expect(within(row).getByText("Reserved")).toBeVisible();
  });

  it("reassigns an engineer node without the selling confirmation and shows server warnings", async () => {
    const user = userEvent.setup();
    const calls = stubPortal({
      "GET /admin/allocation": () => seedState(),
      "POST /admin/allocation/nodes/b300-30": () => ({ ...seedState(), warnings: ["b300-30 warning from server"] }),
    });
    wrap();
    await user.click(await screen.findByRole("button", { name: "Edit b300-30" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "b300-30 engineer" }), engineerId("nati"));
    await user.type(screen.getByRole("textbox", { name: "b300-30 note" }), "bench");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("b300-30 warning from server")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      role: "engineer",
      engineerId: engineerId("nati"),
      note: "bench",
      expected_revision: 3,
    });
  });

  it("shows the API's reason when a write is refused", async () => {
    const user = userEvent.setup();
    stubPortal({
      "GET /admin/allocation": () => seedState(),
      [`POST /admin/allocation/engineers/${engineerId("ll")}/status`]: () =>
        Response.json({ error: "engineer_has_nodes", detail: "ll still has b300-29, b300-30. Reassign those nodes first." }, { status: 409 }),
    });
    wrap();
    await user.click(await screen.findByRole("button", { name: "Deactivate ll" }));
    expect(await screen.findByText("ll still has b300-29, b300-30. Reassign those nodes first.")).toBeVisible();
  });

  it("adds an engineer with the username taken from the email", async () => {
    const user = userEvent.setup();
    const calls = stubPortal({
      "GET /admin/allocation": () => seedState(),
      "POST /admin/allocation/engineers": () => seedState(),
    });
    wrap();
    await user.click(await screen.findByRole("button", { name: "Add engineer" }));
    const dialog = screen.getByRole("dialog", { name: "Add engineer" });
    await user.type(within(dialog).getByRole("textbox", { name: "Email" }), "Kim@oadpiz.com");
    expect(within(dialog).getByRole("textbox", { name: /Username/ })).toHaveValue("kim");
    await user.type(within(dialog).getByRole("textbox", { name: /SSH public key/ }), "ssh-ed25519 AAAAC3Nza kim");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      email: "kim@oadpiz.com",
      displayName: "",
      expected_revision: 3,
      sshPubkey: "ssh-ed25519 AAAAC3Nza kim",
      username: "kim",
    });
  });

  it("downloads engineers.yaml, shows the export warnings and the runbook commands", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue("blob:engineers");
    const revokeObjectURL = vi.fn();
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    onTestFinished(() => {
      Object.assign(URL, original);
    });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(`${this.download} ${this.href}`);
    });
    const exported = { ...seedState(), lastExport: { revision: 3, at: "2026-10-20T09:00:00Z" } };
    const calls = stubPortal({
      "GET /admin/allocation": () => seedState(),
      "POST /admin/allocation/export/mark": () => exported,
      "GET /admin/allocation/export": () => {
        return {
          filename: "engineers.yaml",
          yaml: "selling:\n  nodes: [b300-14, b300-31]\n",
          revision: 3,
          generatedAt: "2026-10-20T09:00:00Z",
          warnings: ["justin: no SSH public key yet"],
          excluded: [{ username: "justin", reason: "no_ssh_pubkey" }],
          renderReady: false,
          monitoringReady: true,
          missingKeys: ["justin"],
          pendingCleanup: [],
        };
      },
    });
    wrap();
    expect(await screen.findByText(/Never exported/)).toBeVisible();
    for (const step of SYNC_STEPS) expect(screen.getByText(step.command)).toBeVisible();
    expect(screen.getByText("python3 access/render.py check").closest("pre")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Export engineers.yaml" }));
    expect(await screen.findByText("justin: no SSH public key yet")).toBeVisible();
    expect(downloads).toEqual(["engineers.yaml blob:engineers"]);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe("selling:\n  nodes: [b300-14, b300-31]\n");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:engineers");
    expect(await screen.findByText(/Last export: revision 3/)).toBeVisible();
    expect(screen.getByText(/Monitoring can sync .*justin have no key yet/)).toBeVisible();
    expect(calls.filter((call) => call.path === "/admin/allocation/export")).toHaveLength(1);
    expect(calls.find((call) => call.path === "/admin/allocation/export/mark")).toEqual({
      method: "POST",
      path: "/admin/allocation/export/mark",
      body: { revision: 3 },
    });
  });

  it("does not let an engineer node go straight to selling", async () => {
    const user = userEvent.setup();
    const calls = stubPortal({ "GET /admin/allocation": () => seedState() });
    wrap();
    await user.click(await screen.findByRole("button", { name: "Edit b300-30" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "b300-30 role" }), "selling");
    expect(screen.getByText(/Set the node to Reserved and finish the node sync first/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("needs an export and the sync checkbox before a pending node becomes selling", async () => {
    const user = userEvent.setup();
    const pending = (lastExport: number | null) => {
      const state = seedState();
      state.revision = 5;
      state.lastExport = lastExport === null ? null : { revision: lastExport, at: null };
      state.nodes[14] = { ...state.nodes[14], role: "reserved", engineerId: null, engineer: null, pendingCleanup: { revision: 5, engineer: "ll" } };
      state.pendingCleanup = [{ node: "b300-30", revision: 5, engineer: "ll" }];
      return state;
    };
    let current = pending(4);
    const calls = stubPortal({
      "GET /admin/allocation": () => current,
      "POST /admin/allocation/nodes/b300-30": () => seedState(),
    });
    const { unmount } = wrap();
    expect(await screen.findByText("b300-30: was ll (since revision 5)")).toBeVisible();
    expect(screen.getByText("Pending cleanup (was ll)")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit b300-30" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "b300-30 role" }), "selling");
    expect(screen.getByText(/revision 5 or later/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    unmount();

    current = pending(5);
    wrap();
    await user.click(await screen.findByRole("button", { name: "Edit b300-30" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "b300-30 role" }), "selling");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I ran the node sync \(runbook 4\.7\)/ }));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      role: "selling",
      note: "",
      expected_revision: 5,
      confirm_node_synced: true,
    });
  });

  it("rejects a templated display name before sending anything", async () => {
    const user = userEvent.setup();
    const calls = stubPortal({ "GET /admin/allocation": () => seedState() });
    wrap();
    await user.click(await screen.findByRole("button", { name: "Edit justin" }));
    const dialog = screen.getByRole("dialog");
    for (const payload of ["{{ lookup('pipe','id') }}", "Justin: admin"]) {
      const field = within(dialog).getByRole("textbox", { name: /Display name/ });
      await user.clear(field);
      await user.type(field, payload.replace(/[{[]/g, (c) => c + c));
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(/no \{ \} % # : , quotes or backslash/);
    }
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("shows the conflict message when another administrator changed the data", async () => {
    const user = userEvent.setup();
    stubPortal({
      "GET /admin/allocation": () => seedState(),
      "POST /admin/allocation/nodes/b300-11": () =>
        Response.json({ error: "revision_conflict", detail: "資料已被其他管理員更新，請重新整理。 (The allocation changed; reload and try again.)" }, { status: 409 }),
    });
    wrap();
    await user.click(await screen.findByRole("button", { name: "Edit b300-11" }));
    await user.type(screen.getByRole("textbox", { name: "b300-11 note" }), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/資料已被其他管理員更新，請重新整理/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
  });
});
