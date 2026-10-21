/** Shared helpers for the A2c admin section tests (copied from portal-ui.test.tsx, which keeps its own copy). */
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { LocaleProvider } from "../../components/locale-provider";

export const customer = {
  id: "cust-1",
  email: "person@example.com",
  name: "Person",
  role: "customer",
};

export const wrap = (node: React.ReactNode) => render(<LocaleProvider>{node}</LocaleProvider>);

export type Handler = (init: RequestInit | undefined) => unknown;
export type Call = { method: string; path: string; body: unknown };

/** Stubs fetch with "METHOD /path" routes (path includes any query); unknown routes are 404. */
export function adminFetch(routes: Record<string, Handler | unknown>) {
  const calls: Call[] = [];
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
