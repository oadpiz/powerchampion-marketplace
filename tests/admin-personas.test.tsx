import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPortal } from "../components/admin-portal";
import { adminFetch, wrap } from "./support/admin-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const list = {
  gatewayConfigured: true,
  personas: [
    { persona_id: "p1", name: "Support", created_at: 1_760_000_000, active_rev: 1, latest_rev: 2 },
    { persona_id: "p9", name: "Draft", created_at: 1_760_000_100, active_rev: null, latest_rev: null },
  ],
};
const revisions = [
  { rev: 2, note: "warmer", author: "admin", created_at: 1_760_000_300, system_len: 12, example_count: 0 },
  { rev: 1, note: "first", author: "admin", created_at: 1_760_000_200, system_len: 8, example_count: 1 },
];
const detail = (rev: number) => ({
  persona: {
    persona_id: "p1", name: "Support", created_at: 1_760_000_000, active_rev: 1, rev,
    system: rev === 1 ? "Be kind." : "Be warm and kind.", note: rev === 1 ? "first" : "warmer", author: "admin", rev_created_at: 1_760_000_200,
    examples: rev === 1 ? [{ user: "hi", assistant: "hello" }] : [],
  },
  revisions,
});

async function openP1(user: ReturnType<typeof userEvent.setup>) {
  wrap(<AdminPortal section="personas" />);
  await user.click(await screen.findByRole("button", { name: "View Support" }));
  await screen.findByText("Revision A");
}

describe("admin personas section", () => {
  it("lists personas and creates one", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/personas": list,
      "POST /admin/personas": Response.json({ persona_id: "p3" }, { status: 201 }),
      "GET /admin/personas/p3": { persona: { persona_id: "p3", name: "Sales", created_at: 1, active_rev: null }, revisions: [] },
    });
    wrap(<AdminPortal section="personas" />);
    expect(await screen.findByText("Support")).toBeVisible();
    expect(screen.getByText("Not active yet")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Personas");
    await user.click(screen.getByRole("button", { name: "New persona" }));
    const dialog = await screen.findByRole("dialog", { name: "New persona" });
    await user.type(within(dialog).getByLabelText("Name"), "Sales");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "/admin/personas" && call.method === "GET")).toHaveLength(2));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Sales" });
    expect(await screen.findByText("No revisions yet. Create the first revision.")).toBeVisible();
  });

  it("views a persona, switches revisions and confirms activation", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/personas": list,
      "GET /admin/personas/p1": detail(2),
      "GET /admin/personas/p1?rev=1": detail(1),
      "POST /admin/personas/p1/activate": { ok: true },
    });
    await openP1(user);
    expect(screen.getByText("Be warm and kind.", { selector: "pre" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "View revision 1" }));
    expect(await screen.findByText("Be kind.", { selector: "pre" })).toBeVisible();
    expect(calls.some((call) => call.path === "/admin/personas/p1?rev=1")).toBe(true);
    expect(screen.queryByRole("button", { name: "Activate revision 1" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Activate revision 2" }));
    let dialog = await screen.findByRole("dialog", { name: "Activate revision 2?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Activate revision 2" }));
    dialog = await screen.findByRole("dialog", { name: "Activate revision 2?" });
    expect(within(dialog).getByText("Requests that use this persona switch to revision 2 immediately.")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(calls.find((call) => call.method === "POST")).toMatchObject({ path: "/admin/personas/p1/activate", body: { rev: 2 } }));
  });

  it("saves a new revision without activating by default and validates before sending", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/personas": list,
      "GET /admin/personas/p1": detail(2),
      "GET /admin/personas/p1?rev=3": detail(2),
      "POST /admin/personas/p1/revisions": { rev: 3 },
    });
    await openP1(user);
    const checkbox = screen.getByRole("checkbox", { name: "Activate immediately after saving" });
    expect(checkbox).not.toBeChecked();
    const system = screen.getByLabelText("System prompt");
    fireEvent.change(system, { target: { value: "x".repeat(32001) } });
    await user.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByText("The system prompt can be at most 32,000 characters.")).toBeVisible();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    fireEvent.change(system, { target: { value: "Be brief." } });
    await user.click(screen.getByRole("button", { name: "Add example" }));
    await user.type(screen.getByLabelText("Example 1 user"), "hi");
    await user.type(screen.getByLabelText("Example 1 assistant"), "hello");
    await user.type(screen.getByLabelText("Note"), "shorter");
    await user.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({
        system: "Be brief.", examples: [{ user: "hi", assistant: "hello" }], note: "shorter", activate: false,
      }),
    );
    await waitFor(() => expect(calls.some((call) => call.path === "/admin/personas/p1?rev=3")).toBe(true));
  });

  it("tries two revisions side by side and shows per-revision errors", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/personas": list,
      "GET /admin/personas/p1": detail(2),
      "POST /admin/personas/p1/try": {
        input: "price?",
        results: [
          { rev: null, reply: "It costs $5.", usage: { prompt_tokens: 12, completion_tokens: 4 } },
          { rev: 1, error: "backend timeout" },
        ],
      },
    });
    await openP1(user);
    expect(screen.getByText(/Every try calls the model and counts toward gateway usage \(it is recorded in the audit log\)\. It can take up to about 90 seconds; a try that times out may still have used tokens\./)).toBeVisible();
    await user.type(screen.getByLabelText("Test message"), "price?");
    await user.selectOptions(screen.getByLabelText("Revision B (compare, optional)"), "1");
    await user.click(screen.getByRole("button", { name: "Run try" }));
    expect(await screen.findByText("It costs $5.")).toBeVisible();
    expect(screen.getByText("backend timeout")).toBeVisible();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ input: "price?", revs: [null, 1], maxTokens: 300 });
  });

  it("shows the request size and blocks saving a revision over the limit", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({ "GET /admin/personas": list, "GET /admin/personas/p1": detail(2) });
    await openP1(user);
    expect(screen.getByText(/^Size: [\d,]+ \/ 196,608 bytes$/)).toBeVisible();
    // 30,000 CJK characters are within the character limit but 90,000 bytes; ten 8,000-byte examples push it over.
    fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "字".repeat(30000) } });
    for (let index = 0; index < 10; index += 1) await user.click(screen.getByRole("button", { name: "Add example" }));
    for (let index = 1; index <= 10; index += 1) fireEvent.change(screen.getByLabelText(`Example ${index} user`), { target: { value: "字".repeat(4000) } });
    expect(screen.getByRole("button", { name: "Save revision" })).toBeDisabled();
    expect(screen.getByText(/^Size: [\d,]+ \/ 196,608 bytes$/)).toHaveClass("portal-error");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("explains that a timed-out try may still have used tokens", async () => {
    const user = userEvent.setup();
    adminFetch({
      "GET /admin/personas": list,
      "GET /admin/personas/p1": detail(2),
      "POST /admin/personas/p1/try": Response.json({ error: "service_unavailable", detail: "x" }, { status: 504 }),
    });
    await openP1(user);
    await user.type(screen.getByLabelText("Test message"), "hello");
    await user.click(screen.getByRole("button", { name: "Run try" }));
    expect(await screen.findByText("The try timed out without a result. The model may still have run and used tokens.")).toBeVisible();
  });

  it("shows the not-connected notice without a create button", async () => {
    adminFetch({ "GET /admin/personas": { gatewayConfigured: false, personas: [] } });
    wrap(<AdminPortal section="personas" />);
    expect(await screen.findByText(/Gateway not connected/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "New persona" })).not.toBeInTheDocument();
  });

  it("handles a persona without revisions", async () => {
    const user = userEvent.setup();
    adminFetch({
      "GET /admin/personas": list,
      "GET /admin/personas/p9": { persona: { persona_id: "p9", name: "Draft", created_at: 1, active_rev: null }, revisions: [] },
    });
    wrap(<AdminPortal section="personas" />);
    await user.click(await screen.findByRole("button", { name: "View Draft" }));
    expect(await screen.findByText("No revisions yet. Create the first revision.")).toBeVisible();
    expect(screen.getByLabelText("System prompt")).toHaveValue("");
    expect(screen.getByText("Save a revision before trying this persona.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run try" })).not.toBeInTheDocument();
  });

  it("returns to the list when the persona no longer exists", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/personas": list,
      "GET /admin/personas/p1": Response.json({ error: "persona_not_found", detail: "x" }, { status: 404 }),
    });
    wrap(<AdminPortal section="personas" />);
    await user.click(await screen.findByRole("button", { name: "View Support" }));
    expect(await screen.findByText("That persona or revision was not found.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to the list" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "/admin/personas")).toHaveLength(2));
    expect(screen.queryByText("That persona or revision was not found.")).not.toBeInTheDocument();
  });
});
