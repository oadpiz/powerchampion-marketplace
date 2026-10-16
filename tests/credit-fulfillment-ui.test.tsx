import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPortal } from "../components/account-portal";
import { AdminPortal } from "../components/admin-portal";
import type { CreditRequest } from "../lib/credit-request";
import { LocaleProvider } from "../components/locale-provider";

const customer = { id: "cust-1", email: "person@example.com", name: "Person", role: "customer" };
const key = { id: "key-1", userId: customer.id, label: "Saved production", prefix: "sk-owned", status: "active", createdAt: "2026-10-16T00:00:00Z", gatewayKeyId: "gateway-1" };
const credit: CreditRequest & { userId: string; email: string; name: string } = { id: "credit-1", userId: customer.id, email: customer.email, name: customer.name, amountUsd: 50, status: "pending", reference: "BANK-123", createdAt: "2026-10-16T00:00:00Z", reviewedAt: null, targetKeyId: key.id, targetKeyLabel: key.label, targetKeyPrefix: key.prefix, paymentConfirmedAt: null, fulfillmentStatus: "not_started", fulfillmentError: null, fulfilledAt: null };
function setup({ admin = false, keys = [key], requests = [credit], configured = true, reviewed = credit, responseStatus = 200 } = {}) {
  const fetchMock = vi.fn().mockImplementation((url, init) => Promise.resolve(
    String(url).endsWith("/session") ? Response.json({ user: { ...customer, role: admin ? "admin" : "customer" } })
    : init?.method === "POST" ? Response.json({ request: reviewed }, { status: responseStatus })
    : Response.json({ requests, keys, gatewayConfigured: configured }),
  ));
  vi.stubGlobal("fetch", fetchMock);
  render(<LocaleProvider>{admin ? <AdminPortal section="credits" /> : <AccountPortal section="credits" />}</LocaleProvider>);
  return fetchMock;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("credit fulfillment UI", () => {
  // Catches accidental submission with no target or automatic selection of an unknown secret.
  it("requires explicit active target selection and saved-key acknowledgment before posting the target", async () => {
    const user = userEvent.setup();
    const fetchMock = setup({ keys: [key, { ...key, id: "revoked", label: "Revoked key", status: "revoked" }] });
    const select = await screen.findByLabelText("Target API key");
    expect(select).toHaveValue("");
    expect(within(select).queryByRole("option", { name: /Revoked key/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Payment reference"), "BANK-123");
    const submit = screen.getByRole("button", { name: "Submit verification request" });
    expect(submit).toBeDisabled();
    await user.selectOptions(select, "key-1");
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I have securely saved/ }));
    await user.click(submit);
    expect(await screen.findByText(/Verification request submitted/)).toBeVisible();
    expect(JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body)).toEqual({ amountUsd: 50, reference: "BANK-123", targetKeyId: "key-1" });
  });
  it("sends customers without active keys to create and save a key", async () => {
    setup({ keys: [] });
    expect(await screen.findByRole("link", { name: "Create and save an API key" })).toHaveAttribute("href", "/account/keys");
    expect(screen.queryByRole("button", { name: "Submit verification request" })).not.toBeInTheDocument();
  });
  it("blocks new requests while the gateway is unconfigured", async () => {
    setup({ configured: false });
    expect(await screen.findByText(/Funding is unavailable until/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit verification request" })).not.toBeInTheDocument();
  });
  it("explains disabled administrator fulfillment when the gateway is unconfigured", async () => {
    setup({ admin: true, configured: false });
    expect(await screen.findByText("Configure the gateway before issuing or retrying credit.")).toBeVisible();
    expect(screen.getByRole("button", { name: `Confirm payment and issue credit ${customer.email} · credit-1` })).toBeDisabled();
  });
  it("never presents legacy approval or a failed pending grant as completed credit", async () => {
    setup({ requests: [{ ...credit, id: "legacy", status: "approved", targetKeyId: null, targetKeyLabel: null, targetKeyPrefix: null }, { ...credit, paymentConfirmedAt: "2026-10-16T00:00:00Z", fulfillmentStatus: "pending", fulfillmentError: "gateway_unavailable" }] });
    expect(await screen.findByText("Approved record · credit not issued")).toBeVisible();
    expect(screen.getByText("Payment confirmed · credit pending; administrator retry required")).toBeVisible();
    expect(screen.getByText("Target key needs administrator attention")).toBeVisible();
    expect(screen.queryByText("Credit added")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });
  it("shows a completed grant with its immutable target", async () => {
    setup({ requests: [{ ...credit, status: "approved", fulfillmentStatus: "fulfilled", fulfilledAt: "2026-10-16T00:00:00Z" }] });
    expect(await screen.findByText("Credit added")).toBeVisible();
    expect(within(screen.getByRole("table")).getByText("Saved production · sk-owned…")).toBeVisible();
  });
  it("lets only the administrator retry a confirmed pending request and handles 202 without success claims", async () => {
    const user = userEvent.setup();
    const pending: typeof credit = { ...credit, paymentConfirmedAt: "2026-10-16T00:00:00Z", fulfillmentStatus: "pending", fulfillmentError: "gateway_unavailable" };
    const fetchMock = setup({ admin: true, requests: [pending], reviewed: pending, responseStatus: 202 });
    await user.click(await screen.findByRole("button", { name: `Retry credit ${customer.email} · credit-1` }));
    expect(screen.queryByRole("button", { name: /^Reject / })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Target API key")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry credit" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Payment confirmed · credit pending; administrator retry required");
    expect(JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body)).toEqual({ decision: "approve", note: "" });
    expect(screen.queryByText("Credit added")).not.toBeInTheDocument();
  });
  it("requires an explicit key belonging to the legacy request customer before admin fulfillment", async () => {
    const user = userEvent.setup();
    const legacy = { ...credit, status: "approved", targetKeyId: null, targetKeyLabel: null, targetKeyPrefix: null };
    const fetchMock = setup({ admin: true, requests: [legacy], keys: [key, { ...key, id: "other", userId: "other-customer", label: "Other customer" }], reviewed: { ...credit, status: "approved", fulfillmentStatus: "fulfilled" } });
    await user.selectOptions(await screen.findByLabelText("Filter by status"), "approved");
    await user.click(screen.getByRole("button", { name: `Issue credit ${customer.email} · credit-1` }));
    const select = screen.getByLabelText("Target API key");
    expect(select).toHaveValue("");
    expect(within(select).queryByRole("option", { name: /Other customer/ })).not.toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm payment received and issue credit" });
    expect(confirm).toBeDisabled();
    await user.selectOptions(select, "key-1");
    await user.click(confirm);
    expect(await screen.findByRole("status")).toHaveTextContent("Credit added");
    expect(JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body)).toEqual({ decision: "approve", note: "", targetKeyId: "key-1" });
  });
});
