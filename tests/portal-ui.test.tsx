import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "../components/auth-form";
import { AccountPortal } from "../components/account-portal";
import { AdminPortal } from "../components/admin-portal";
import { AdminShell } from "../components/admin-shell";
import { LocaleProvider } from "../components/locale-provider";
import { PortalError, portalErrorText, safeAccountReturn } from "../lib/portal-client";

const customer = {
  id: "cust-1",
  email: "person@example.com",
  name: "Person",
  role: "customer",
};
const wrap = (node: React.ReactNode) =>
  render(<LocaleProvider>{node}</LocaleProvider>);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("account portal", () => {
  it("registers with the supplied credentials, clears the password and never stores it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ user: customer }));
    vi.stubGlobal("fetch", fetchMock);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    wrap(<AuthForm mode="register" />);
    await user.type(screen.getByLabelText("Name"), "Person");
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "a-long-password-test");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      await screen.findByRole("link", { name: "Open workspace ↗" }),
    ).toHaveAttribute("href", "/account");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: "person@example.com",
      password: "a-long-password-test",
      name: "Person",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/portal/auth/register");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(storage).not.toHaveBeenCalled();
  });

  it("limits authentication return locations to known account routes", () => {
    expect(safeAccountReturn("https://bad.example")).toBe("/account");
    expect(safeAccountReturn("//bad.example")).toBe("/account");
    expect(safeAccountReturn("/account/keys")).toBe("/account/keys");
    expect(safeAccountReturn("/account/security")).toBe("/account/security");
    expect(safeAccountReturn("/tasks")).toBe("/tasks");
    expect(safeAccountReturn(`/tasks?agent=${"d".repeat(32)}`)).toBe(`/tasks?agent=${"d".repeat(32)}`);
    expect(safeAccountReturn("/tasks?starter=analysis")).toBe("/tasks?starter=analysis");
    expect(safeAccountReturn("/tasks?starter=comparison")).toBe("/tasks?starter=comparison");
    expect(safeAccountReturn("/tasks?starter=handover")).toBe("/tasks?starter=handover");
    expect(safeAccountReturn(`/tasks?starter=analysis&agent=${"d".repeat(32)}`)).toBe(`/tasks?agent=${"d".repeat(32)}&starter=analysis`);
    expect(safeAccountReturn("/tasks?starter=unknown")).toBe("/tasks");
    expect(safeAccountReturn("/tasks?starter=https%3A%2F%2Fevil.example")).toBe("/tasks");
    expect(safeAccountReturn("/tasks?starter=analysis&next=https://evil.example")).toBe("/account");
    expect(safeAccountReturn("/tasks?starter=analysis&starter=handover")).toBe("/account");
    expect(safeAccountReturn(`/tasks?agent=${"d".repeat(32)}&agent=${"f".repeat(32)}`)).toBe("/account");
    expect(safeAccountReturn("/agents/build")).toBe("/agents/build");
    expect(safeAccountReturn("/agents/build?template=research")).toBe("/agents/build?template=research");
    expect(safeAccountReturn("/agents/build?template=unknown")).toBe("/account");
    expect(safeAccountReturn(`/tasks?agent=${"d".repeat(32)}&next=https://bad.example`)).toBe("/account");
    expect(safeAccountReturn("/tasks//evil.example")).toBe("/account");
    expect(safeAccountReturn("/tasks?next=https://evil.example")).toBe("/account");
    expect(safeAccountReturn("/admin")).toBe("/admin");
    expect(safeAccountReturn("/admin/customers")).toBe("/admin/customers");
    expect(safeAccountReturn("/admin/anything")).toBe("/account");
    expect(portalErrorText(new PortalError(503, "usage_pricing_incomplete", "Internal details"), "en")).toContain("Pricing data is incomplete");
    expect(portalErrorText(new PortalError(404, "gateway_rejected", "Model not found on the gateway."), "en")).toBe("Model not found on the gateway.");
    expect(portalErrorText(new PortalError(404, "gateway_rejected", ""), "en")).toBe("The gateway rejected the request.");
    expect(portalErrorText(new PortalError(503, "gateway_unavailable", "x"), "en")).toBe("The API gateway is unavailable right now. Try again in a moment.");
    expect(portalErrorText(new PortalError(400, "unknown_action", "x"), "en")).toBe("That node action is not available.");
    expect(portalErrorText(new PortalError(404, "key_not_found", "x"), "en")).toBe("That API key no longer exists on the gateway.");
    expect(portalErrorText(new PortalError(404, "customer_not_found", "x"), "en")).toBe("That account was not found.");
    expect(portalErrorText(new PortalError(503, "gateway_auth_failed", "x"), "en")).toBe("The gateway rejected the portal's admin token. Check PC_GATEWAY_ADMIN_TOKEN on the portal service.");
    expect(portalErrorText(new PortalError(503, "gateway_auth_failed", "x"), "zh")).toBe("閘道拒絕了入口網站的管理權杖，請檢查 portal 服務的 PC_GATEWAY_ADMIN_TOKEN 設定。");
    expect(portalErrorText(new PortalError(409, "account_disabled", "x"), "en")).toBe("This key's account is disabled. Enable the account first.");
    expect(portalErrorText(new PortalError(409, "account_disabled", "x"), "zh")).toBe("此金鑰所屬的帳號已停用，請先啟用帳號。");
    expect(portalErrorText(new PortalError(403, "account_disabled", "x"), "en")).toBe("This account has been disabled. Contact support.");
  });

  it("preserves the saved-agent destination when switching from login to registration", async () => {
    const destination = `/tasks?agent=${"d".repeat(32)}`;
    window.history.replaceState({}, "", `/login?next=${encodeURIComponent(destination)}`);
    wrap(<AuthForm mode="login" />);
    expect(await screen.findByRole("link", { name: "Create account" })).toHaveAttribute("href", `/register?next=${encodeURIComponent(destination)}`);
  });

  it.each(["login", "register"] as const)("keeps the task starter through %s and the authentication mode switch", async (mode) => {
    const user = userEvent.setup();
    const destination = `/tasks?agent=${"d".repeat(32)}&starter=comparison`;
    window.history.replaceState({}, "", `/${mode}?next=${encodeURIComponent(destination)}`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user: customer })));
    wrap(<AuthForm mode={mode} />);
    const otherMode = mode === "login" ? "register" : "login";
    expect(await screen.findByRole("link", { name: mode === "login" ? "Create account" : "Sign in" })).toHaveAttribute("href", `/${otherMode}?next=${encodeURIComponent(destination)}`);
    if (mode === "register") await user.type(screen.getByLabelText("Name"), "Person");
    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "a-long-password-test");
    await user.click(screen.getByRole("button", { name: mode === "login" ? "Sign in" : "Create account" }));
    expect(await screen.findByRole("link", { name: "Open workspace ↗" })).toHaveAttribute("href", destination);
  });

  it("shows a sign-in requirement without fake account statistics", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "auth_required" }, { status: 401 }),
        ),
    );
    wrap(<AccountPortal section="overview" />);
    expect(
      await screen.findByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/login?next=%2Faccount");
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an unconfigured usage provider from zero usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ user: customer }))
        .mockResolvedValueOnce(
          Response.json({
            month: "2026-09",
            rows: [],
            source: "unconfigured",
            updatedAt: null,
          }),
        ),
    );
    wrap(<AccountPortal section="usage" />);
    expect(
      await screen.findByText(/Usage reporting is not connected/),
    ).toBeVisible();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("reveals a newly issued key once, supports copying and clears the secret on dismissal", async () => {
    const user = userEvent.setup();
    const secret = "sk-once-only-test-secret";
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (String(url).endsWith("/session"))
        return Promise.resolve(Response.json({ user: customer }));
      if (init?.method === "POST")
        return Promise.resolve(
          Response.json({
            key: {
              id: "key-1",
              label: "Staging",
              prefix: "sk-once",
              status: "active",
              createdAt: "2026-09-01T00:00:00Z",
            },
            secret,
          }),
        );
      return Promise.resolve(
        Response.json({ keys: [], gatewayConfigured: true, keyIssuance: true }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    wrap(<AccountPortal section="keys" />);
    await user.type(await screen.findByLabelText("Key label"), "Staging");
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    expect(await screen.findByText(secret)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Copy key" }));
    await user.click(
      screen.getByRole("button", { name: "I have saved this key" }),
    );
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(storage).not.toHaveBeenCalled();
  });

  it("replaces key creation with a contact note when customer issuance is off", async () => {
    const fetchMock = vi.fn().mockImplementation((url) =>
      Promise.resolve(
        String(url).endsWith("/session")
          ? Response.json({ user: customer })
          : Response.json({
              keys: [{ id: "key-1", label: "Production", prefix: "sk-prod", status: "active", createdAt: "2026-09-01T00:00:00Z" }],
              gatewayConfigured: true,
              keyIssuance: false,
            }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    wrap(<AccountPortal section="keys" />);
    expect(await screen.findByText("API keys are issued by our team — contact support.")).toBeVisible();
    expect(screen.queryByLabelText("Key label")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create API key" })).not.toBeInTheDocument();
    expect(screen.queryByText(/not connected to the model gateway/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke Production" })).toBeEnabled();
  });

  it("requires a concrete confirmation before revoking a key", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (String(url).endsWith("/session"))
        return Promise.resolve(Response.json({ user: customer }));
      if (init?.method === "DELETE")
        return Promise.resolve(Response.json({ ok: true }));
      return Promise.resolve(
        Response.json({
          keys: [
            {
              id: "key-1",
              label: "Production",
              prefix: "sk-prod",
              status: "active",
              createdAt: "2026-09-01T00:00:00Z",
            },
          ],
          gatewayConfigured: true,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    wrap(<AccountPortal section="keys" />);
    await user.click(
      await screen.findByRole("button", { name: "Revoke Production" }),
    );
    expect(
      fetchMock.mock.calls.some((call) => call[1]?.method === "DELETE"),
    ).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "Revoke API key?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Revoke key" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) =>
            call[0] === "/api/portal/keys/key-1" &&
            call[1]?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });

  it("creates a pending credit verification request without claiming payment or balance", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (String(url).endsWith("/session"))
        return Promise.resolve(Response.json({ user: customer }));
      if (init?.method === "POST")
        return Promise.resolve(
          Response.json({
            request: {
              id: "credit-1",
              amountUsd: 50,
              status: "pending",
              reference: "BANK-123",
            },
          }),
        );
      return Promise.resolve(Response.json({ requests: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    wrap(<AccountPortal section="credits" />);
    const amount = await screen.findByLabelText("Amount paid (USD)");
    fireEvent.change(amount, { target: { value: "50" } });
    await user.type(screen.getByLabelText("Payment reference"), "BANK-123");
    await user.click(
      screen.getByRole("button", { name: "Submit verification request" }),
    );
    expect(
      await screen.findByText(/Verification request submitted/),
    ).toBeVisible();
    expect(
      JSON.parse(
        fetchMock.mock.calls.find((call) => call[1]?.method === "POST")![1]
          .body,
      ),
    ).toEqual({ amountUsd: 50, reference: "BANK-123" });
    expect(
      screen.getByText(
        /does not charge your payment method or add gateway credits/,
      ),
    ).toBeVisible();
  });

  it("does not fetch admin records for a customer session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ user: customer })),
    );
    wrap(<AdminPortal section="overview" />);
    expect(
      await screen.findByText("Administrator access required"),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Customer accounts")).not.toBeInTheDocument();
  });

  it("renders the section title as the page h1", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ user: { ...customer, role: "admin" } }),
        )
        .mockResolvedValue(
          Response.json({ error: "unavailable" }, { status: 503 }),
        ),
    );
    wrap(<AdminPortal section="customers" />);
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Customers",
    );
  });

  it("does not render zero admin statistics when the backend is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ user: { ...customer, role: "admin" } }),
        )
        .mockResolvedValueOnce(
          Response.json({ error: "unavailable" }, { status: 503 }),
        ),
    );
    wrap(<AdminPortal section="overview" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Administration services are currently unavailable",
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("allows cancelling a credit review and requires a separate confirmation to record approval", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      if (String(url).endsWith("/session"))
        return Promise.resolve(
          Response.json({ user: { ...customer, role: "admin" } }),
        );
      if (init?.method === "POST")
        return Promise.resolve(Response.json({ ok: true }));
      return Promise.resolve(
        Response.json({
          requests: [
            {
              id: "credit-1",
              email: customer.email,
              name: customer.name,
              amountUsd: 50,
              status: "pending",
              reference: "BANK-123",
              createdAt: "2026-09-01T00:00:00Z",
              reviewedAt: null,
            },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    wrap(<AdminPortal section="credits" />);
    const approve = await screen.findByRole("button", {
      name: "Approve person@example.com · credit-1",
    });
    await user.click(approve);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "does not charge, refund, or add credit",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some((call) => call[1]?.method === "POST"),
    ).toBe(false);
    await user.click(approve);
    await user.type(
      screen.getByLabelText("Review note (optional)"),
      "Matched bank reference",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm and record approval" }),
    );
    expect(
      await screen.findByText(
        "Approval recorded. No gateway balance was changed.",
      ),
    ).toBeVisible();
    const post = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(post?.[0]).toBe("/api/portal/admin/credits/credit-1/review");
    expect(JSON.parse(post?.[1].body)).toEqual({
      decision: "approve",
      note: "Matched bank reference",
    });
  });
  it("disables a customer after confirmation and reflects the new status", async () => {
    const user = userEvent.setup();
    const customers = [{ id: "b".repeat(32), email: "roy@example.test", name: "Roy", role: "customer", status: "active", createdAt: "2026-09-25T00:00:00Z", keyCount: 0 }];
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      const u = String(url);
      if (u.endsWith("/session")) return Promise.resolve(Response.json({ user: { ...customer, role: "admin" } }));
      if (u.endsWith("/admin/customers") && !init?.method) return Promise.resolve(Response.json({ customers }));
      if (u.endsWith("/status") && init?.method === "POST") {
        customers[0].status = "disabled";
        return Promise.resolve(Response.json({ customer: customers[0], keysRevoked: 2, keysFailed: 0 }));
      }
      return Promise.resolve(Response.json({ error: "unexpected" }, { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    wrap(<AdminPortal section="customers" />);
    await user.click(await screen.findByRole("button", { name: /disable/i }));
    expect(screen.getByText(/every active gateway API key of this account is revoked/)).toBeVisible();
    expect(screen.queryByText(/not affected/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirm/i }));
    expect(await screen.findByText("disabled", { exact: false })).toBeVisible();
    expect(screen.getByText(/2 gateway keys revoked\./)).toBeVisible();
    expect(screen.queryByText(/could not be revoked/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/search by name/i)).toHaveFocus();
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(String(call?.[0])).toMatch(/\/admin\/customers\/b{32}\/status$/);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ action: "disable" });
  });

  it("warns when some keys could not be revoked while disabling an account", async () => {
    const user = userEvent.setup();
    const customers = [{ id: "b".repeat(32), email: "roy@example.test", name: "Roy", role: "customer", status: "active", createdAt: "2026-09-25T00:00:00Z", keyCount: 3 }];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url, init) => {
      const u = String(url);
      if (u.endsWith("/session")) return Promise.resolve(Response.json({ user: { ...customer, role: "admin" } }));
      if (u.endsWith("/admin/customers") && !init?.method) return Promise.resolve(Response.json({ customers }));
      if (u.endsWith("/status") && init?.method === "POST") {
        customers[0].status = "disabled";
        return Promise.resolve(Response.json({ customer: customers[0], keysRevoked: 1, keysFailed: 2 }));
      }
      return Promise.resolve(Response.json({ error: "unexpected" }, { status: 500 }));
    }));
    wrap(<AdminPortal section="customers" />);
    await user.click(await screen.findByRole("button", { name: /disable/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));
    expect(await screen.findByText(/1 gateway key revoked\./)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("2 keys could not be revoked. Reconcile them on the API keys page.");
  });

  it("offers no account actions on the signed-in admin's own row", async () => {
    const customers = [
      { id: "cust-1", email: "person@example.com", name: "Person", role: "admin", status: "active", createdAt: "2026-09-25T00:00:00Z", keyCount: 0 },
      { id: "b".repeat(32), email: "roy@example.test", name: "Roy", role: "customer", status: "active", createdAt: "2026-09-25T00:00:00Z", keyCount: 0 },
    ];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url) => {
      if (String(url).endsWith("/session")) return Promise.resolve(Response.json({ user: { ...customer, role: "admin" } }));
      return Promise.resolve(Response.json({ customers }));
    }));
    wrap(<AdminPortal section="customers" />);
    expect(await screen.findByRole("button", { name: "Disable roy@example.test" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /person@example.com/ })).not.toBeInTheDocument();
    expect(screen.getByText("You")).toBeVisible();
  });

  it("resets a customer password only when both entries match", async () => {
    const user = userEvent.setup();
    const customers = [{ id: "b".repeat(32), email: "roy@example.test", name: "Roy", role: "customer", status: "active", createdAt: "2026-09-25T00:00:00Z", keyCount: 0 }];
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      const u = String(url);
      if (u.endsWith("/session")) return Promise.resolve(Response.json({ user: { ...customer, role: "admin" } }));
      if (u.endsWith("/admin/customers") && !init?.method) return Promise.resolve(Response.json({ customers }));
      if (u.endsWith("/reset-password")) return Promise.resolve(Response.json({ ok: true }));
      return Promise.resolve(Response.json({ error: "unexpected" }, { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    wrap(<AdminPortal section="customers" />);
    await user.click(await screen.findByRole("button", { name: /reset password/i }));
    await user.type(screen.getByLabelText(/new password/i), "brand-new-password-987!");
    await user.type(screen.getByLabelText(/confirm/i), "different-password-000!");
    await user.click(screen.getByRole("button", { name: /confirm/i }));
    expect(screen.getByText(/do not match/i)).toBeVisible();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await user.clear(screen.getByLabelText(/confirm/i));
    await user.type(screen.getByLabelText(/confirm/i), "brand-new-password-987!");
    await user.click(screen.getByRole("button", { name: /confirm/i }));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ newPassword: "brand-new-password-987!" });
    expect(await screen.findByText(/password was reset/i)).toBeVisible();
  });

  it("changes the password from the security section", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url, init) => {
      const u = String(url);
      if (u.endsWith("/session")) return Promise.resolve(Response.json({ user: customer }));
      if (u.endsWith("/password") && init?.method === "POST") return Promise.resolve(Response.json({ ok: true }));
      return Promise.resolve(Response.json({ error: "unexpected" }, { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    wrap(<AccountPortal section="security" />);
    await user.type(await screen.findByLabelText(/current password/i), "customer-test-password-123!");
    await user.type(screen.getByLabelText(/^new password/i), "brand-new-password-987!");
    await user.type(screen.getByLabelText(/confirm/i), "brand-new-password-987!");
    await user.click(screen.getByRole("button", { name: /update password/i }));
    expect(await screen.findByText(/password updated/i)).toBeVisible();
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ currentPassword: "customer-test-password-123!", newPassword: "brand-new-password-987!" });
  });
});

describe("AdminShell", () => {
  it("renders the admin navigation with the current section marked", () => {
    wrap(<AdminShell pathname="/admin/customers"><p>content</p></AdminShell>);
    const nav = screen.getByRole("navigation", { name: /administration/i });
    expect(nav).toBeVisible();
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /back to site/i })).toHaveAttribute("href", "/");
    expect(screen.getByText("content")).toBeVisible();
  });

  it("signs out through the portal and leaves for the login page", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    wrap(<AdminShell pathname="/admin"><p>content</p></AdminShell>);
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/portal\/auth\/logout$/);
    expect(assign).toHaveBeenCalledWith("/login");
  });
});

type Handler = (init: RequestInit | undefined) => unknown;
function adminFetch(routes: Record<string, Handler | unknown>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("/api/portal", "");
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (path === "/session")
      return Response.json({ user: { ...customer, role: "admin" } });
    const route = routes[`${method} ${path}`];
    if (route === undefined)
      return Response.json({ error: "not_found" }, { status: 404 });
    const value = typeof route === "function" ? (route as Handler)(init) : route;
    return value instanceof Response ? value : Response.json(value);
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

const gatewayKey = {
  gatewayKeyId: "gk-1",
  prefix: "pc-live-aaaa",
  label: "Acme production",
  dailyTokenLimit: 0,
  rpm: 60,
  maxInflight: 0,
  balanceUsd: "12.5",
  createdAt: 1_760_000_000,
  expiresAt: null,
  disabledAt: null,
  lastUsedAt: null,
  modelIds: [],
  owner: { id: "cust-9", email: "owner@example.com", name: "Owner" },
  portalKeyId: "pk-1",
  portalStatus: "active",
};

describe("admin keys section", () => {
  it("lists keys with the owner email, postpaid balance and unowned keys", async () => {
    adminFetch({
      "GET /admin/keys": {
        keys: [
          gatewayKey,
          {
            ...gatewayKey,
            gatewayKeyId: "gk-2",
            prefix: "pc-live-bbbb",
            label: "Orphan",
            owner: null,
            portalKeyId: null,
            portalStatus: null,
            balanceUsd: null,
            disabledAt: 1_760_000_100,
          },
        ],
        envKeys: [{ ...gatewayKey, gatewayKeyId: "env-1", prefix: "env-key", label: "Env key", owner: null }],
        gatewayConfigured: true,
      },
    });
    wrap(<AdminPortal section="keys" />);
    expect(await screen.findByText("owner@example.com")).toBeVisible();
    expect(screen.getByText("pc-live-aaaa")).toBeVisible();
    expect(screen.getByText("$12.50")).toBeVisible();
    expect(screen.getAllByText("Unassigned").length).toBeGreaterThan(0);
    expect(screen.getByText("Postpaid")).toBeVisible();
    expect(screen.getByText("Disabled")).toBeVisible();
    expect(screen.getByText("Env key")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("API keys");
  });

  it("shows 未歸屬 when the locale is Chinese", async () => {
    localStorage.setItem("pc-locale", "zh");
    window.history.replaceState({}, "", "/admin/keys");
    try {
      adminFetch({
        "GET /admin/keys": {
          keys: [{ ...gatewayKey, owner: null, balanceUsd: null }],
          envKeys: [],
          gatewayConfigured: true,
        },
      });
      wrap(<AdminPortal section="keys" />);
      expect(await screen.findByText("未歸屬")).toBeVisible();
      expect(screen.getByText("後付")).toBeVisible();
    } finally {
      localStorage.removeItem("pc-locale");
      window.history.replaceState({}, "", "/");
    }
  });

  it("explains an unconfigured gateway instead of rendering tables", async () => {
    adminFetch({
      "GET /admin/keys": { keys: [], envKeys: [], gatewayConfigured: false },
    });
    wrap(<AdminPortal section="keys" />);
    expect(
      await screen.findByText(/Gateway not connected \(PC_GATEWAY_ADMIN_TOKEN is not set\)/),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("names a rejected gateway token instead of a generic outage", async () => {
    adminFetch({
      "GET /admin/keys": () =>
        Response.json({ error: "gateway_auth_failed", detail: "The portal's gateway token was rejected." }, { status: 503 }),
    });
    wrap(<AdminPortal section="keys" />);
    expect(
      await screen.findByText("The gateway rejected the portal's admin token. Check PC_GATEWAY_ADMIN_TOKEN on the portal service."),
    ).toBeVisible();
    expect(screen.queryByText(/Administration services are currently unavailable/)).not.toBeInTheDocument();
  });

  it("explains why a key of a disabled account cannot be enabled", async () => {
    const user = userEvent.setup();
    adminFetch({
      "GET /admin/keys": { keys: [{ ...gatewayKey, disabledAt: 1_760_000_100, portalStatus: "revoked" }], envKeys: [], gatewayConfigured: true },
      "POST /admin/keys/gk-1/disable": () =>
        Response.json({ error: "account_disabled", detail: "Enable the account first." }, { status: 409 }),
    });
    wrap(<AdminPortal section="keys" />);
    await user.click(await screen.findByRole("button", { name: "Enable" }));
    expect(await screen.findByText("This key's account is disabled. Enable the account first.")).toBeVisible();
  });

  it("issues a key for an active customer and shows the secret once", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/keys": { keys: [], envKeys: [], gatewayConfigured: true },
      "GET /admin/customers": {
        customers: [
          { id: "cust-1", email: "active@example.com", name: "Active", role: "customer", status: "active", createdAt: 1, keyCount: 0 },
          { id: "cust-2", email: "off@example.com", name: "Off", role: "customer", status: "disabled", createdAt: 1, keyCount: 0 },
        ],
      },
      "POST /admin/customers/cust-1/keys": Response.json(
        { key: { id: "pk-5", label: "Trial", prefix: "pc-live-cccc", gatewayKeyId: "gk-5" }, secret: "pc-live-secret-value", balanceUsd: "5" },
        { status: 201 },
      ),
    });
    wrap(<AdminPortal section="keys" />);
    await user.click(await screen.findByRole("button", { name: "Issue key for a customer" }));
    const dialog = await screen.findByRole("dialog");
    const select = await within(dialog).findByLabelText("Customer");
    expect(within(dialog).queryByRole("option", { name: /off@example.com/ })).not.toBeInTheDocument();
    await user.selectOptions(select, "cust-1");
    await user.type(within(dialog).getByLabelText("Label"), "Trial");
    await user.type(within(dialog).getByLabelText("Prepaid amount (USD)"), "5");
    await user.click(within(dialog).getByRole("button", { name: "Issue key" }));
    expect(await screen.findByText("pc-live-secret-value")).toBeVisible();
    const post = calls.find((call) => call.method === "POST");
    expect(post?.path).toBe("/admin/customers/cust-1/keys");
    expect(post?.body).toEqual({ label: "Trial", prepaidUsd: 5 });
    await user.click(screen.getByRole("button", { name: "I have delivered it to the customer" }));
    expect(screen.queryByText("pc-live-secret-value")).not.toBeInTheDocument();
  });

  it("disables a key, adjusts limits and tops up the balance with the right requests", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/keys": { keys: [gatewayKey], envKeys: [], gatewayConfigured: true },
      "POST /admin/keys/gk-1/disable": { ok: true },
      "POST /admin/keys/gk-1/limits": { ok: true },
      "POST /admin/keys/gk-1/balance": { ok: true, balanceUsd: "17.5" },
    });
    wrap(<AdminPortal section="keys" />);
    await user.click(await screen.findByRole("button", { name: "Disable" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path.endsWith("/disable"))?.body).toEqual({ disabled: true }),
    );
    await user.click(await screen.findByRole("button", { name: "Limits" }));
    let dialog = await screen.findByRole("dialog");
    const rpm = within(dialog).getByLabelText("Requests per minute");
    await user.clear(rpm);
    await user.type(rpm, "120");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path.endsWith("/limits"))?.body).toEqual({
        dailyTokenLimit: 0,
        rpm: 120,
        maxInflight: 0,
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Top up" }));
    dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Amount (USD)"), "5");
    await user.click(within(dialog).getByRole("button", { name: "Add balance" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path.endsWith("/balance"))?.body).toEqual({ addUsd: 5 }),
    );
  });
});

describe("admin amount validation", () => {
  it("rejects prepaid amounts the server would refuse and sends no request", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/keys": { keys: [], envKeys: [], gatewayConfigured: true },
      "GET /admin/customers": {
        customers: [{ id: "cust-1", email: "active@example.com", name: "Active", role: "customer", status: "active", createdAt: 1, keyCount: 0 }],
      },
    });
    wrap(<AdminPortal section="keys" />);
    await user.click(await screen.findByRole("button", { name: "Issue key for a customer" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(await within(dialog).findByLabelText("Customer"), "cust-1");
    const label = within(dialog).getByLabelText("Label");
    expect(label).toHaveAttribute("maxlength", "80");
    await user.type(label, "Trial");
    const amount = within(dialog).getByLabelText("Prepaid amount (USD)");
    expect(amount).toHaveAttribute("step", "0.01");
    expect(amount).toHaveAttribute("max", "100000");
    for (const bad of ["1.234", "1e6", "100000.01", "0"]) {
      await user.clear(amount);
      await user.type(amount, bad);
      await user.click(within(dialog).getByRole("button", { name: "Issue key" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(/at most 100,000, with at most two decimals/);
      expect(calls.some((call) => call.method === "POST")).toBe(false);
    }
  });

  it("rejects top-up amounts over the limit or with extra decimals", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/keys": { keys: [gatewayKey], envKeys: [], gatewayConfigured: true },
    });
    wrap(<AdminPortal section="keys" />);
    await user.click(await screen.findByRole("button", { name: "Top up" }));
    const dialog = await screen.findByRole("dialog");
    const amount = within(dialog).getByLabelText("Amount (USD)");
    for (const bad of ["2.005", "100000.01"]) {
      await user.clear(amount);
      await user.type(amount, bad);
      await user.click(within(dialog).getByRole("button", { name: "Add balance" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(/two decimals/);
    }
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("limits the maintenance message to 300 characters", async () => {
    const user = userEvent.setup();
    adminFetch({
      "GET /admin/gateway": {
        gatewayConfigured: true,
        state: { models: [{ id: "m1", enabled: true }] },
        nodes: null,
        metrics: null,
        errors: { state: null, nodes: "unavailable", metrics: "unavailable" },
      },
    });
    wrap(<AdminPortal section="gateway" />);
    await user.click(await screen.findByRole("button", { name: "Maintenance message for m1" }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("Message")).toHaveAttribute("maxlength", "300");
  });
});

describe("admin dialog shell", () => {
  it("closes on Escape and returns focus to the opener", async () => {
    const user = userEvent.setup();
    adminFetch({
      "GET /admin/keys": { keys: [gatewayKey], envKeys: [], gatewayConfigured: true },
    });
    wrap(<AdminPortal section="keys" />);
    const opener = await screen.findByRole("button", { name: "Top up" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Amount (USD)")).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});

describe("admin usage section", () => {
  const usage = {
    month: "2026-10",
    source: "gateway",
    totals: { requests: 1234, costUsd: "3.14159" },
    amountStatus: "estimated",
    unpricedModels: ["mystery-model"],
    keys: [
      {
        gatewayKeyId: "gk-1",
        label: "Acme production",
        owner: { id: "cust-9", email: "owner@example.com", name: "Owner" },
        requests: 1000,
        inputTokens: 5000,
        outputTokens: 7000,
        costUsd: "2.5",
        byModel: [{ model: "glm-5", requests: 1000, inputTokens: 5000, outputTokens: 7000, costUsd: "2.5" }],
      },
    ],
    byCustomer: [{ owner: { id: "cust-9", email: "owner@example.com", name: "Owner" }, requests: 1000, costUsd: "2.5" }],
    updatedAt: 1_760_000_000,
  };

  it("renders totals, the unpriced-model warning and the per-model breakdown", async () => {
    const user = userEvent.setup();
    adminFetch({ "GET /admin/usage?month=2026-10": usage });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
    try {
      wrap(<AdminPortal section="usage" />);
      expect(await screen.findByText("$3.1416")).toBeVisible();
      expect(screen.getByText("1,234")).toBeVisible();
      expect(screen.getByText(/mystery-model/)).toBeVisible();
      expect(screen.getByText(/not confirmed/i)).toBeVisible();
      await user.click(screen.getByRole("button", { name: /Models for Acme production/ }));
      expect(screen.getByText("glm-5")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches with the chosen month", async () => {
    const calls = adminFetch({
      "GET /admin/usage?month=2026-10": usage,
      "GET /admin/usage?month=2026-09": { ...usage, month: "2026-09", totals: { requests: 7, costUsd: "0.5" }, unpricedModels: [] },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
    try {
      wrap(<AdminPortal section="usage" />);
      await screen.findByText("$3.1416");
      fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-09" } });
      expect(await screen.findByText("$0.5000")).toBeVisible();
      expect(calls.some((call) => call.path === "/admin/usage?month=2026-09")).toBe(true);
      expect(screen.queryByText(/mystery-model/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains an unconfigured gateway", async () => {
    adminFetch({
      "GET /admin/usage?month=2026-10": { ...usage, source: "unconfigured", keys: [], byCustomer: [], unpricedModels: [] },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
    try {
      wrap(<AdminPortal section="usage" />);
      expect(await screen.findByText(/Gateway not connected/)).toBeVisible();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("admin gateway section", () => {
  const overview = {
    gatewayConfigured: true,
    state: {
      models: [
        { id: "zai/glm-5", enabled: true, node: "b300-a" },
        { id: "other-model", enabled: false, maintenance_message: "Back soon" },
      ],
    },
    nodes: {
      nodes: [
        { name: "b300-a", enabled: true, role: "primary", models: ["zai/glm-5"], reachable: true, state: "serving" },
      ],
      actions: ["check", "restart", "stop"],
    },
    metrics: null,
    errors: { state: null, nodes: null, metrics: "unavailable" },
  };

  it("still renders models and nodes when the metrics source is unavailable", async () => {
    adminFetch({ "GET /admin/gateway": overview });
    wrap(<AdminPortal section="gateway" />);
    expect((await screen.findAllByText("zai/glm-5")).length).toBeGreaterThan(0);
    expect(screen.getByText("Back soon")).toBeVisible();
    expect(screen.getAllByText("b300-a").length).toBeGreaterThan(0);
    expect(screen.getByText("GPU metrics are unavailable right now.")).toBeVisible();
  });

  it("renders the gateway's GPU metrics and tolerates missing fields", async () => {
    adminFetch({
      "GET /admin/gateway": {
        ...overview,
        metrics: {
          ts: 1,
          gpu_source_up: true,
          vllm_source_up: true,
          gpus: [
            { index: 3, model: "NVIDIA B300", util: 83, mem_used_gb: 120.5, mem_total_gb: 180, temp_c: 61, power_w: 712.4 },
            { odd: true },
            null,
          ],
          serving: { running: 3, waiting: 1 },
        },
        errors: { state: null, nodes: null, metrics: null },
      },
    });
    wrap(<AdminPortal section="gateway" />);
    const row = (await screen.findByText("NVIDIA B300")).closest("tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells).toEqual(["3", "NVIDIA B300", "83%", "120.5 / 180 GB", "61°C", "712.4 W"]);
    expect(screen.getByRole("columnheader", { name: "Memory (used / total, GB)" })).toBeVisible();
    const sparse = within(screen.getByRole("table", { name: "GPU metrics" })).getAllByRole("row")[2];
    expect(within(sparse).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["1", "—", "—", "—", "—", "—"]);
    expect(screen.getByText(/Running 3/)).toBeVisible();
  });

  it("toggles a model using an encoded id", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/gateway": overview,
      "POST /admin/gateway/models/zai%2Fglm-5/toggle": { id: "zai/glm-5", enabled: false },
    });
    wrap(<AdminPortal section="gateway" />);
    await user.click(await screen.findByRole("button", { name: "Disable zai/glm-5" }));
    const dialog = await screen.findByRole("dialog", { name: "Disable model zai/glm-5?" });
    expect(within(dialog).getByText("Customers will receive 404 for this model until it is enabled again.")).toBeVisible();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Disable model" }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === "/admin/gateway/models/zai%2Fglm-5/toggle")).toBe(true),
    );
  });

  it("sends nothing when disabling a model is cancelled, and enables without a dialog", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/gateway": overview,
      "POST /admin/gateway/models/other-model/toggle": { id: "other-model", enabled: true },
    });
    wrap(<AdminPortal section="gateway" />);
    await user.click(await screen.findByRole("button", { name: "Disable zai/glm-5" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Enable other-model" }));
    await waitFor(() =>
      expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual(["/admin/gateway/models/other-model/toggle"]),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sets and clears a maintenance message", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/gateway": overview,
      "POST /admin/gateway/models/other-model/maintenance": { id: "other-model", maintenance_message: "" },
    });
    wrap(<AdminPortal section="gateway" />);
    await user.click(await screen.findByRole("button", { name: "Maintenance message for other-model" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Message")).toHaveValue("Back soon");
    await user.click(within(dialog).getByRole("button", { name: "Clear message" }));
    await waitFor(() =>
      expect(calls.find((call) => call.path.endsWith("/maintenance"))?.body).toEqual({ message: "" }),
    );
  });

  it("runs a node action and polls the job until it finishes", async () => {
    const user = userEvent.setup();
    let polls = 0;
    const calls = adminFetch({
      "GET /admin/gateway": overview,
      "POST /admin/gateway/nodes/b300-a/ops/check": { job_id: "job-7" },
      "GET /admin/gateway/nodes/b300-a/jobs/job-7": () => {
        polls += 1;
        return { job_id: "job-7", state: polls >= 2 ? "done" : "running" };
      },
    });
    wrap(<AdminPortal section="gateway" />);
    const checkButton = await screen.findByRole("button", { name: "Run check on b300-a" });
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      await user.click(checkButton);
      expect(await screen.findByText(/job-7/)).toBeVisible();
      expect(calls.find((call) => call.method === "POST" && call.path.includes("/ops/check"))).toBeDefined();
      await vi.advanceTimersByTimeAsync(5000);
      await waitFor(() => expect(polls).toBe(1));
      await vi.advanceTimersByTimeAsync(5000);
      await waitFor(() => expect(polls).toBe(2));
      expect(await screen.findByText(/done/i)).toBeVisible();
      await vi.advanceTimersByTimeAsync(20000);
      expect(polls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks for confirmation before stopping a node", async () => {
    const user = userEvent.setup();
    const calls = adminFetch({
      "GET /admin/gateway": overview,
      "POST /admin/gateway/nodes/b300-a/ops/stop": { job_id: "job-8" },
      "GET /admin/gateway/nodes/b300-a/jobs/job-8": { job_id: "job-8", state: "done" },
    });
    wrap(<AdminPortal section="gateway" />);
    await user.click(await screen.findByRole("button", { name: "Run stop on b300-a" }));
    expect(calls.some((call) => call.path.includes("/ops/stop"))).toBe(false);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.path.includes("/ops/stop"))).toBe(false);
    await user.click(await screen.findByRole("button", { name: "Run stop on b300-a" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Stop node" }));
    await waitFor(() => expect(calls.some((call) => call.path === "/admin/gateway/nodes/b300-a/ops/stop")).toBe(true));
  });

  it("explains an unconfigured gateway", async () => {
    adminFetch({
      "GET /admin/gateway": { gatewayConfigured: false, state: null, nodes: null, metrics: null, errors: { state: null, nodes: null, metrics: null } },
    });
    wrap(<AdminPortal section="gateway" />);
    expect(await screen.findByText(/Gateway not connected/)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("admin navigation for gateway sections", () => {
  it.each([
    ["/admin/keys", "API keys"],
    ["/admin/usage", "Usage"],
    ["/admin/gateway", "Gateway"],
  ])("marks %s as the current section", (pathname, name) => {
    wrap(<AdminShell pathname={pathname}><p>content</p></AdminShell>);
    expect(screen.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", pathname);
    const labels = within(screen.getByRole("navigation", { name: /administration/i }))
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual(["Overview", "Customers", "API keys", "Usage", "Gateway", "Credit requests", "Audit log"]);
  });
});
