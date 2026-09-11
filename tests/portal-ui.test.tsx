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
    expect(safeAccountReturn("/admin")).toBe("/account");
    expect(portalErrorText(new PortalError(503, "usage_pricing_incomplete", "Internal details"), "en")).toContain("Pricing data is incomplete");
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
        Response.json({ keys: [], gatewayConfigured: true }),
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
});
