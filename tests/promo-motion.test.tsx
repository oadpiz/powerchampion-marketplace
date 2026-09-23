import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromoMotionRoot, usePromoMotion } from "../components/promo-motion";

function Probe() {
  const { canAnimate } = usePromoMotion();
  return <p>{canAnimate ? "Motion enabled" : "Readable still"}</p>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("promotional motion policy", () => {
  it("keeps standalone and manually paused scenes static", () => {
    const view = render(<Probe />);
    expect(screen.getByText("Readable still")).toBeVisible();
    view.rerender(<PromoMotionRoot paused><Probe /></PromoMotionRoot>);
    expect(screen.getByText("Readable still")).toBeVisible();
    view.rerender(<PromoMotionRoot><Probe /></PromoMotionRoot>);
    expect(screen.getByText("Motion enabled")).toBeVisible();
    view.rerender(<PromoMotionRoot paused><Probe /></PromoMotionRoot>);
    expect(screen.getByText("Readable still")).toBeVisible();
  });

  it("stops motion while the document is hidden and restores it on return", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    render(<PromoMotionRoot><Probe /></PromoMotionRoot>);
    expect(screen.getByText("Motion enabled")).toBeVisible();
    act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByText("Readable still")).toBeVisible();
    act(() => { hidden.mockReturnValue(false); document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByText("Motion enabled")).toBeVisible();
  });

  it("honors a changed operating-system preference and removes subscriptions", () => {
    let reduced = false;
    const listeners = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      media: query, get matches() { return reduced; }, onchange: null,
      addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener as () => void),
      removeEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener as () => void),
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
    } as MediaQueryList));
    const view = render(<PromoMotionRoot><Probe /></PromoMotionRoot>);
    expect(screen.getByText("Motion enabled")).toBeVisible();
    act(() => { reduced = true; listeners.forEach((listener) => listener()); });
    expect(screen.getByText("Readable still")).toBeVisible();
    view.unmount();
    expect(listeners.size).toBe(0);
  });
});
