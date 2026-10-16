import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountPortal } from "../components/account-portal";
import { LocaleProvider } from "../components/locale-provider";

// Identify framework links so this flow cannot regress to the known broken
// vinext client-navigation handler. Keep the real account component and HTTP client.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props} data-framework-link="true">{children}</a>
  ),
}));
afterEach(() => vi.unstubAllGlobals());

it("uses a native document navigation for the no-key create-and-save flow", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url) => Promise.resolve(
    String(url).endsWith("/session")
      ? Response.json({ user: { id: "no-key", name: "Test", email: "nokey@example.test", role: "customer" } })
      : Response.json({ requests: [], keys: [], gatewayConfigured: true }),
  )));
  render(<LocaleProvider><AccountPortal section="credits" /></LocaleProvider>);
  const link = await screen.findByRole("link", { name: "Create and save an API key" });
  expect(link).toHaveAttribute("href", "/account/keys");
  expect(link).not.toHaveAttribute("data-framework-link");
});

it("keeps account navigation between saved keys and credit requests on native document links", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url) => Promise.resolve(
    String(url).endsWith("/session")
      ? Response.json({ user: { id: "no-key", name: "Test", email: "nokey@example.test", role: "customer" } })
      : Response.json({ requests: [], keys: [], gatewayConfigured: true }),
  )));
  render(<LocaleProvider><AccountPortal section="credits" /></LocaleProvider>);
  await screen.findByRole("link", { name: "Create and save an API key" });
  const navigation = screen.getByRole("navigation", { name: "Account navigation" });
  for (const [name, href] of [["API keys", "/account/keys"], ["Credit requests", "/account/credits"]]) {
    const link = within(navigation).getByRole("link", { name });
    expect(link).toHaveAttribute("href", href);
    expect(link).not.toHaveAttribute("data-framework-link");
  }
});
