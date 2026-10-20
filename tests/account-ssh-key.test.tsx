import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPortal } from "../components/account-portal";
import { LocaleProvider } from "../components/locale-provider";

const customer = { id: "cust-1", email: "justin@oadpiz.com", name: "justin", role: "customer" };
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGx0ZXN0a2V5dGVzdGtleXRlc3RrZXl0ZXN0a2V5 justin@laptop";
const engineer = (overrides: Record<string, unknown> = {}) => ({
  username: "justin",
  displayName: "justin",
  active: true,
  nodes: ["b300-11", "b300-12", "b300-13"],
  key: null,
  keyPendingSync: false,
  keyUpdatedBy: null,
  ...overrides,
});

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
      if (!route) return Response.json({ error: "unexpected" }, { status: 500 });
      const value = route(body);
      return value instanceof Response ? value : Response.json(value);
    }),
  );
  return calls;
}
const notEngineer = () => Response.json({ error: "not_engineer", detail: "not linked" }, { status: 404 });
const wrap = (section: "overview" | "ssh-key") =>
  render(
    <LocaleProvider>
      <AccountPortal section={section} />
    </LocaleProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account SSH key section", () => {
  it("is hidden from the navigation when the account is not linked to an engineer", async () => {
    const calls = stubPortal({
      "GET /session": () => ({ user: customer }),
      "GET /overview": () => ({ user: customer, keyCount: 0, pendingCreditCount: 0, approvedCreditUsd: 0, gatewayConfigured: true }),
      "GET /me/engineer": notEngineer,
    });
    wrap("overview");
    const nav = await screen.findByRole("navigation", { name: "Account navigation" });
    await waitFor(() => expect(calls.some((call) => call.path === "/me/engineer")).toBe(true));
    expect(await within(nav).findByRole("link", { name: "Security" })).toBeVisible();
    expect(within(nav).queryByRole("link", { name: "SSH key" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("appears in the navigation for a linked engineer", async () => {
    stubPortal({
      "GET /session": () => ({ user: customer }),
      "GET /overview": () => ({ user: customer, keyCount: 0, pendingCreditCount: 0, approvedCreditUsd: 0, gatewayConfigured: true }),
      "GET /me/engineer": () => engineer(),
    });
    wrap("overview");
    const nav = await screen.findByRole("navigation", { name: "Account navigation" });
    expect(await within(nav).findByRole("link", { name: "SSH key" })).toHaveAttribute("href", "/account/ssh-key");
  });

  it("ignores a response that is not an engineer summary", async () => {
    const calls = stubPortal({
      "GET /session": () => ({ user: customer }),
      "GET /overview": () => ({ user: customer, keyCount: 0, pendingCreditCount: 0, approvedCreditUsd: 0, gatewayConfigured: true }),
      "GET /me/engineer": () => ({ keys: [] }),
    });
    wrap("overview");
    await screen.findByText("Overview", { selector: "h1" });
    await waitFor(() => expect(calls.some((call) => call.path === "/me/engineer")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("link", { name: "SSH key" })).not.toBeInTheDocument();
  });

  it("explains that an unlinked account has no SSH key page", async () => {
    stubPortal({ "GET /session": () => ({ user: customer }), "GET /me/engineer": notEngineer });
    wrap("ssh-key");
    expect(await screen.findByText(/not linked to a GPU-cluster engineer/)).toBeVisible();
    expect(screen.queryByLabelText("SSH public key")).not.toBeInTheDocument();
  });

  it("submits a new key with the current password and shows it as pending sync", async () => {
    const user = userEvent.setup();
    const calls = stubPortal({
      "GET /session": () => ({ user: customer }),
      "GET /me/engineer": () => engineer(),
      "POST /me/engineer/ssh-key": () => ({
        changed: true,
        detail: "Key received.",
        engineer: engineer({
          key: { type: "ssh-ed25519", bits: 256, fingerprint: "SHA256:newfingerprint" },
          keyPendingSync: true,
          keyUpdatedBy: "engineer",
        }),
      }),
    });
    wrap("ssh-key");
    expect(await screen.findByRole("heading", { name: "Current key" })).toBeVisible();
    expect(screen.getByText("b300-11, b300-12, b300-13")).toBeVisible();
    expect(screen.getByText("No key yet")).toBeVisible();
    expect(screen.getByText("Not provided")).toBeVisible();
    const submit = screen.getByRole("button", { name: "Submit key" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("SSH public key"), KEY);
    await user.type(screen.getByLabelText("Current password"), "temporary-password-1234");
    await user.click(submit);
    expect(await screen.findByText(/Key received\. It takes effect after the administrator's next export and sync\./)).toBeVisible();
    expect(calls.find((call) => call.method === "POST")).toEqual({
      method: "POST",
      path: "/me/engineer/ssh-key",
      body: { sshPubkey: KEY, currentPassword: "temporary-password-1234" },
    });
    expect(screen.getByText("SHA256:newfingerprint")).toBeVisible();
    expect(screen.getByText("Pending sync")).toBeVisible();
    expect(screen.getByLabelText("SSH public key")).toHaveValue("");
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.queryByText(KEY)).not.toBeInTheDocument();
  });

  it("shows a synced key and the server's reason when a submission is refused", async () => {
    const user = userEvent.setup();
    const responses = [
      Response.json({ error: "invalid_input", detail: "RSA keys must be at least 3072 bits (this one is 2048). Prefer ssh-ed25519." }, { status: 400 }),
      Response.json({ error: "invalid_current_password", detail: "The current password is incorrect." }, { status: 400 }),
      Response.json({ error: "engineer_conflict", detail: "Another engineer already uses this SSH public key." }, { status: 409 }),
      Response.json({ error: "rate_limited", detail: "Too many attempts." }, { status: 429 }),
    ];
    stubPortal({
      "GET /session": () => ({ user: customer }),
      "GET /me/engineer": () =>
        engineer({ key: { type: "ssh-ed25519", bits: 256, fingerprint: "SHA256:current" }, keyUpdatedBy: "admin" }),
      "POST /me/engineer/ssh-key": () => responses.shift(),
    });
    wrap("ssh-key");
    expect(await screen.findByText("SHA256:current")).toBeVisible();
    expect(screen.getByText("Synced")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Replace your key" })).toBeVisible();
    await user.type(screen.getByLabelText("SSH public key"), KEY);
    await user.type(screen.getByLabelText("Current password"), "temporary-password-1234");
    const expected = [
      /RSA keys must be at least 3072 bits/,
      /The current password is incorrect\./,
      /Another engineer already uses this key/,
      /Too many requests/,
    ];
    for (const message of expected) {
      await user.click(screen.getByRole("button", { name: "Submit key" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    }
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByLabelText("SSH public key")).toHaveValue(KEY);
    expect(screen.getByText("Synced")).toBeVisible();
  });

  it("never sends a pasted private key", async () => {
    const user = userEvent.setup();
    const calls = stubPortal({ "GET /session": () => ({ user: customer }), "GET /me/engineer": () => engineer() });
    wrap("ssh-key");
    await user.type(await screen.findByLabelText("SSH public key"), "-----BEGIN OPENSSH PRIVATE KEY----- abc");
    await user.type(screen.getByLabelText("Current password"), "temporary-password-1234");
    await user.click(screen.getByRole("button", { name: "Submit key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/looks like a private key/);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("has no form for a deactivated engineer", async () => {
    stubPortal({ "GET /session": () => ({ user: customer }), "GET /me/engineer": () => engineer({ active: false, nodes: [] }) });
    wrap("ssh-key");
    expect(await screen.findByText(/engineer access is deactivated/)).toBeVisible();
    expect(screen.getByText("No nodes assigned right now")).toBeVisible();
    expect(screen.queryByLabelText("SSH public key")).not.toBeInTheDocument();
  });

  it("locks the form until an administrator-issued password is changed", async () => {
    const calls = stubPortal({
      "GET /session": () => ({ user: customer }),
      "GET /me/engineer": () => engineer({ passwordChangeRequired: true }),
    });
    wrap("ssh-key");
    const notice = (await screen.findByText(/issued by an administrator/)).closest("p")!;
    expect(notice).toHaveAttribute("role", "status");
    expect(within(notice).getByRole("link", { name: "Security" })).toHaveAttribute("href", "/account/security");
    expect(screen.getByLabelText("SSH public key")).toBeDisabled();
    expect(screen.getByLabelText("Current password")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit key" })).toBeDisabled();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("explains a password_change_required refusal", async () => {
    const user = userEvent.setup();
    stubPortal({
      "GET /session": () => ({ user: customer }),
      "GET /me/engineer": () => engineer({ passwordChangeRequired: false }),
      "POST /me/engineer/ssh-key": () =>
        Response.json({ error: "password_change_required", detail: "change it" }, { status: 403 }),
    });
    wrap("ssh-key");
    await user.type(await screen.findByLabelText("SSH public key"), KEY);
    await user.type(screen.getByLabelText("Current password"), "temporary-password-1234");
    await user.click(screen.getByRole("button", { name: "Submit key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Change the password your administrator gave you under Security/);
  });
});
