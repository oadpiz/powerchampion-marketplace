import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPortal } from "../components/admin-portal";
import { AdminShell } from "../components/admin-shell";
import { adminFetch, wrap } from "./support/admin-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const code = (codeId: string, status: string, extra: Record<string, unknown> = {}) => ({
  codeId, amountUsd: "5.00", label: "Promo", createdAt: "2026-10-21T00:00:00Z", createdBy: "admin",
  redeemedAt: null, redeemedByKeyId: null, redeemedBy: null, disabledAt: null, expiresAt: null, status, ...extra,
});
const listing = (extra: Record<string, unknown> = {}) => ({
  gatewayConfigured: true,
  codes: [
    code("c1", "active"),
    code("c2", "redeemed", { redeemedAt: "2026-10-21T01:00:00Z", redeemedByKeyId: "gk-1", redeemedBy: { id: "u1", email: "buyer@example.com", name: "Buyer" } }),
    code("c3", "disabled", { label: "Old" }),
    code("c4", "expired", { label: "Old" }),
  ],
  total: 4,
  counts: { active: 1, redeemed: 1, disabled: 1, expired: 1 },
  truncated: false,
  ...extra,
});
const issued = {
  codes: [
    { code: "PlainRedeemCode-0001-abcdefghijkl", codeId: "code-1", amountUsd: "5.00" },
    { code: "PlainRedeemCode-0002-abcdefghijkl", codeId: "code-2", amountUsd: "5.00" },
  ],
  count: 2, amountUsd: "5.00", label: "Promo", expiresDays: 30,
};

async function fillGenerate(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, values: { amount: string; count: string; label?: string; days?: string }) {
  for (const [name, value] of [["Amount per code (USD)", values.amount], ["Number of codes", values.count], ["Batch label", values.label ?? "Promo"], ["Valid for days (optional)", values.days ?? ""]]) {
    const input = within(dialog).getByLabelText(name);
    await user.clear(input);
    if (value) await user.type(input, value);
  }
}

describe("admin redeem codes section", () => {
  it("shows counts, filters by status and label, and notes truncation", async () => {
    const user = userEvent.setup();
    adminFetch({ "GET /admin/redeem/codes": listing({ truncated: true, total: 1500 }) });
    wrap(<AdminPortal section="redeem" />);
    expect(await screen.findByText("c1")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Redeem codes");
    expect(screen.getByText("buyer@example.com")).toBeVisible();
    expect(screen.getByText("Showing the newest 1,000 of 1,500 codes; use the CSV export for all of them.")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Status"), "redeemed");
    expect(screen.getByText("c2")).toBeVisible();
    expect(screen.queryByText("c1")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Status"), "all");
    await user.selectOptions(screen.getByLabelText("Batch label"), "Old");
    expect(screen.getByText("c3")).toBeVisible();
    expect(screen.queryByText("c1")).not.toBeInTheDocument();
  });

  it("validates before sending and confirms the total value", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/redeem/codes": listing(),
      "POST /admin/redeem/codes": Response.json(issued, { status: 201 }),
    });
    wrap(<AdminPortal section="redeem" />);
    await user.click(await screen.findByRole("button", { name: "Generate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Generate redeem codes" });
    for (const [amount, count] of [["0", "2"], ["1000.01", "2"], ["1.234", "2"], ["5", "0"], ["5", "501"]]) {
      await fillGenerate(user, dialog, { amount, count });
      await user.click(within(dialog).getByRole("button", { name: "Next" }));
      expect(within(dialog).getByRole("alert")).toBeVisible();
    }
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await fillGenerate(user, dialog, { amount: "5", count: "2", days: "30" });
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByText("This will generate 2 codes at $5.00 each, $10.00 in total.")).toBeVisible();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(calls.find((call) => call.method === "POST")?.body).toEqual({ amountUsd: 5, count: 2, label: "Promo", expiresDays: 30 }));
  });

  it("shows plaintext once, cannot be dismissed with Escape, and keeps nothing afterwards", async () => {
    const user = userEvent.setup();
    let after = false;
    adminFetch({
      "GET /admin/redeem/codes": () => (after ? listing({ codes: [...listing().codes, code("code-1", "active"), code("code-2", "active")] }) : listing()),
      "POST /admin/redeem/codes": () => { after = true; return Response.json(issued, { status: 201 }); },
    });
    wrap(<AdminPortal section="redeem" />);
    await user.click(await screen.findByRole("button", { name: "Generate codes" }));
    const form = await screen.findByRole("dialog", { name: "Generate redeem codes" });
    await fillGenerate(user, form, { amount: "5", count: "2", days: "30" });
    await user.click(within(form).getByRole("button", { name: "Next" }));
    await user.click(within(form).getByRole("button", { name: "Generate" }));
    const once = await screen.findByRole("dialog", { name: "These codes are shown only once" });
    for (const item of issued.codes) expect(within(once).getByText(item.code)).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "These codes are shown only once" })).toBeVisible();
    await user.click(within(once).getByRole("button", { name: "I have saved them" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("code-2")).toBeVisible();
    for (const item of issued.codes) expect(document.body.textContent).not.toContain(item.code);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("copies all codes separated by newlines", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    adminFetch({ "GET /admin/redeem/codes": listing(), "POST /admin/redeem/codes": Response.json(issued, { status: 201 }) });
    wrap(<AdminPortal section="redeem" />);
    await user.click(await screen.findByRole("button", { name: "Generate codes" }));
    const form = await screen.findByRole("dialog");
    await fillGenerate(user, form, { amount: "5", count: "2" });
    await user.click(within(form).getByRole("button", { name: "Next" }));
    await user.click(within(form).getByRole("button", { name: "Generate" }));
    const once = await screen.findByRole("dialog", { name: "These codes are shown only once" });
    await user.click(within(once).getByRole("button", { name: "Copy all" }));
    expect(writeText).toHaveBeenCalledWith("PlainRedeemCode-0001-abcdefghijkl\nPlainRedeemCode-0002-abcdefghijkl");
    expect(await within(once).findByText("All codes copied.")).toBeVisible();
  });

  it("explains an unconfirmed issue and requires an acknowledgement before retrying", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/redeem/codes": listing(),
      "POST /admin/redeem/codes": (init: RequestInit | undefined) => {
        const body = JSON.parse(String(init?.body));
        if (body.acknowledgeUnconfirmed) return Response.json(issued, { status: 201 });
        const attempts = calls.filter((call) => call.method === "POST").length;
        return attempts === 1
          ? Response.json({ error: "gateway_unavailable", detail: "x" }, { status: 503 })
          : Response.json({ error: "redeem_issue_unconfirmed_recent", detail: "x" }, { status: 409 });
      },
    });
    wrap(<AdminPortal section="redeem" />);
    await user.click(await screen.findByRole("button", { name: "Generate codes" }));
    const form = await screen.findByRole("dialog");
    await fillGenerate(user, form, { amount: "5", count: "2" });
    await user.click(within(form).getByRole("button", { name: "Next" }));
    await user.click(within(form).getByRole("button", { name: "Generate" }));
    expect(await within(form).findByText(/Codes labelled “Promo” may have been created/)).toBeVisible();
    await user.click(within(form).getByRole("button", { name: "Generate" }));
    expect(await within(form).findByText(/Filter the list by this label first/)).toBeVisible();
    await user.click(within(form).getByRole("button", { name: "Generate" }));
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
    await user.click(within(form).getByRole("checkbox", { name: "I checked and disabled codes with this label; generate anyway" }));
    await user.click(within(form).getByRole("button", { name: "Generate" }));
    expect(await screen.findByRole("dialog", { name: "These codes are shown only once" })).toBeVisible();
    expect(calls.filter((call) => call.method === "POST").at(-1)?.body).toMatchObject({ acknowledgeUnconfirmed: true });
  });

  it("disables one code after confirmation, and every active code in a label", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/redeem/codes": listing({ codes: [code("c1", "active"), code("c5", "active"), code("c2", "redeemed")] }),
      "POST /admin/redeem/codes/c1/disable": { ok: true, codeId: "c1" },
      "POST /admin/redeem/codes/c5/disable": { ok: true, codeId: "c5" },
    });
    wrap(<AdminPortal section="redeem" />);
    await user.click(await screen.findByRole("button", { name: "Disable c1" }));
    let dialog = await screen.findByRole("dialog", { name: "Disable code c1?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Disable c1" }));
    dialog = await screen.findByRole("dialog", { name: "Disable code c1?" });
    await user.click(within(dialog).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(calls.filter((call) => call.path === "/admin/redeem/codes")).toHaveLength(2));
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual(["/admin/redeem/codes/c1/disable"]);
    await user.selectOptions(await screen.findByLabelText("Batch label"), "Promo");
    await user.click(screen.getByRole("button", { name: "Disable all 2 active codes with this label" }));
    dialog = await screen.findByRole("dialog", { name: "Disable 2 codes labelled “Promo”?" });
    await user.click(within(dialog).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual([
      "/admin/redeem/codes/c1/disable", "/admin/redeem/codes/c1/disable", "/admin/redeem/codes/c5/disable",
    ]));
  });

  it("downloads plaintext codes as a text file, one per line, never as a spreadsheet", async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return "blob:x"; });
      static revokeObjectURL = vi.fn();
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const risky = {
      codes: [
        { code: "-dashLeadingCode0001abcd", codeId: "code-1", amountUsd: "5.00" },
        { code: "=SUM(A1)codeEquals0002ab", codeId: "code-2", amountUsd: "5.00" },
      ],
      count: 2, amountUsd: "5.00", label: "=HYPERLINK(\"x\")", expiresDays: null,
    };
    adminFetch({ "GET /admin/redeem/codes": listing(), "POST /admin/redeem/codes": Response.json(risky, { status: 201 }) });
    wrap(<AdminPortal section="redeem" />);
    await user.click(await screen.findByRole("button", { name: "Generate codes" }));
    const form = await screen.findByRole("dialog");
    await fillGenerate(user, form, { amount: "5", count: "2", label: "Promo" });
    await user.click(within(form).getByRole("button", { name: "Next" }));
    await user.click(within(form).getByRole("button", { name: "Generate" }));
    const once = await screen.findByRole("dialog", { name: "These codes are shown only once" });
    expect(within(once).getByText(/Open it in a text editor; do not open it in Excel and save it again/)).toBeVisible();
    expect(within(once).queryByRole("button", { name: /CSV/ })).not.toBeInTheDocument();
    await user.click(within(once).getByRole("button", { name: "Download codes (.txt, plaintext)" }));
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("text/plain");
    expect(await blobs[0].text()).toBe("-dashLeadingCode0001abcd\n=SUM(A1)codeEquals0002ab\n");
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("redeem_codes-HYPERLINK_x.txt");
  });

  it("names the real cause of a refused label and counts code points", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({ "GET /admin/redeem/codes": listing(), "POST /admin/redeem/codes": Response.json(issued, { status: 201 }) });
    wrap(<AdminPortal section="redeem" />);
    await user.click(await screen.findByRole("button", { name: "Generate codes" }));
    const dialog = await screen.findByRole("dialog");
    await fillGenerate(user, dialog, { amount: "5", count: "2" });
    const label = within(dialog).getByLabelText("Batch label");
    fireEvent.change(label, { target: { value: "Pro\u200bmo" } });
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("The batch label contains a control or hidden character");
    fireEvent.change(label, { target: { value: "\u{1F381}".repeat(80) } });
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByText(/This will generate 2 codes/)).toBeVisible();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("turns bulk disable off while the list is truncated", async () => {
    const user = userEvent.setup();
    adminFetch({ "GET /admin/redeem/codes": listing({ truncated: true, total: 1500 }) });
    wrap(<AdminPortal section="redeem" />);
    await user.selectOptions(await screen.findByLabelText("Batch label"), "Promo");
    expect(screen.getByRole("button", { name: "Disable all 1 active codes with this label" })).toBeDisabled();
    expect(screen.getByText(/Bulk disable is off while only the newest 1,000 codes are loaded/)).toBeVisible();
  });

  it("reloads the list when a bulk disable only partly succeeds", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/redeem/codes": listing({ codes: [code("c1", "active"), code("c5", "active")] }),
      "POST /admin/redeem/codes/c1/disable": { ok: true, codeId: "c1" },
      "POST /admin/redeem/codes/c5/disable": Response.json({ error: "gateway_unavailable", detail: "x" }, { status: 503 }),
    });
    wrap(<AdminPortal section="redeem" />);
    await user.selectOptions(await screen.findByLabelText("Batch label"), "Promo");
    await user.click(screen.getByRole("button", { name: "Disable all 2 active codes with this label" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Disable" }));
    expect(await within(dialog).findByText(/1 could not be disabled/)).toBeVisible();
    await waitFor(() => expect(calls.filter((call) => call.path === "/admin/redeem/codes")).toHaveLength(2));
  });

  it("exports the hash-only CSV with the server's file name", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue("blob:x");
    vi.stubGlobal("URL", class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn(); });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    adminFetch({
      "GET /admin/redeem/codes": listing(),
      "GET /admin/redeem/codes/export": { filename: "redeem_codes-20261021.csv", csv: "code_id,code_hash\r\n", rows: 0 },
    });
    wrap(<AdminPortal section="redeem" />);
    expect(await screen.findByText("The export contains hashes only, never the plaintext codes.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("redeem_codes-20261021.csv");
  });

  it("shows the not-connected notice", async () => {
    adminFetch({ "GET /admin/redeem/codes": { gatewayConfigured: false, codes: [], total: 0, counts: { active: 0, redeemed: 0, disabled: 0, expired: 0 }, truncated: false } });
    wrap(<AdminPortal section="redeem" />);
    expect(await screen.findByText(/Gateway not connected/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Generate codes" })).not.toBeInTheDocument();
  });

  it("lists the final navigation order", () => {
    wrap(<AdminShell pathname="/admin/redeem"><p>content</p></AdminShell>);
    const labels = within(screen.getByRole("navigation", { name: /administration/i })).getAllByRole("link").map((link) => link.textContent);
    expect(labels).toEqual(["Overview", "Customers", "API keys", "Redeem codes", "Usage", "Gateway", "Personas", "Node allocation", "Credit requests", "Audit log"]);
    expect(screen.getByRole("link", { name: "Redeem codes" })).toHaveAttribute("aria-current", "page");
  });
});
