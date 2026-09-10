// Task 3 review finding (Important 2): the page-level
// `catalog.source === "snapshot" ? catalog.updated : null` wiring in
// app/page.tsx and app/models/page.tsx had no direct test with a mocked
// live fetchCatalog() — component tests exercised ModelsPageContent /
// HomeContent directly and always passed snapshotDate explicitly, bypassing
// the ternary entirely. These tests call the async page functions themselves
// (they are plain async functions returning JSX, not real RSC-streamed
// components, so calling them directly and rendering the resolved element
// works under vitest+jsdom) with a mocked lib/catalog so both the "live"
// and "snapshot" branches of the ternary are actually exercised.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/locale-provider";
import { CATALOG_SNAPSHOT, type CatalogResult } from "../lib/catalog";

vi.mock("../lib/catalog", async () => {
  const actual = await vi.importActual<typeof import("../lib/catalog")>("../lib/catalog");
  return { ...actual, fetchCatalog: vi.fn() };
});

const { fetchCatalog } = await import("../lib/catalog");
const { default: Home } = await import("../app/page");
const { default: ModelsPage } = await import("../app/models/page");

const mockedFetchCatalog = vi.mocked(fetchCatalog);

function liveResult(): CatalogResult {
  return { source: "live", updated: "2026-09-10", models: CATALOG_SNAPSHOT };
}

function snapshotResult(): CatalogResult {
  return { source: "snapshot", updated: "2026-01-01", models: CATALOG_SNAPSHOT };
}

describe("page-level catalog source wiring", () => {
  it("Home renders no snapshot notice when fetchCatalog reports a live catalogue", async () => {
    mockedFetchCatalog.mockResolvedValueOnce(liveResult());
    const jsx = await Home();
    render(<LocaleProvider>{jsx}</LocaleProvider>);
    expect(screen.queryByText(/snapshot taken/i)).not.toBeInTheDocument();
  });

  it("Home renders the dated snapshot notice when fetchCatalog reports a snapshot", async () => {
    mockedFetchCatalog.mockResolvedValueOnce(snapshotResult());
    const jsx = await Home();
    render(<LocaleProvider>{jsx}</LocaleProvider>);
    expect(
      screen.getByText("Catalogue shown from a snapshot taken 2026-01-01; live availability unavailable."),
    ).toBeVisible();
  });

  it("/models renders no snapshot notice when fetchCatalog reports a live catalogue", async () => {
    mockedFetchCatalog.mockResolvedValueOnce(liveResult());
    const jsx = await ModelsPage();
    render(<LocaleProvider>{jsx}</LocaleProvider>);
    expect(screen.queryByText(/snapshot taken/i)).not.toBeInTheDocument();
  });

  it("/models renders the dated snapshot notice when fetchCatalog reports a snapshot", async () => {
    mockedFetchCatalog.mockResolvedValueOnce(snapshotResult());
    const jsx = await ModelsPage();
    render(<LocaleProvider>{jsx}</LocaleProvider>);
    expect(
      screen.getByText("Catalogue shown from a snapshot taken 2026-01-01; live availability unavailable."),
    ).toBeVisible();
  });
});
