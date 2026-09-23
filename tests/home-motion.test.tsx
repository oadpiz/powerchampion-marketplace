import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { animate } from "motion";
import { useHomeMotion } from "../components/use-home-motion";

vi.mock("motion", () => ({ animate: vi.fn(() => ({ stop: vi.fn() })) }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("keeps a keyboard-focused section visible when a queued scroll observer fires", () => {
  let onIntersection: IntersectionObserverCallback = () => {};
  const unobserve = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { onIntersection = callback; }
    observe() {}
    unobserve = unobserve;
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 2000, bottom: 2200, left: 0, right: 400, width: 400, height: 200, x: 0, y: 2000, toJSON() {},
  });
  function Page() {
    const root = useHomeMotion(false);
    return <main ref={root}><section aria-label="Models"><button>Explore models</button></section></main>;
  }
  render(<Page />);
  const section = screen.getByRole("region", { name: "Models" });
  expect(section).toHaveAttribute("data-home-reveal", "pending");
  act(() => { screen.getByRole("button").focus(); });
  expect(section).toHaveStyle({ opacity: "1", transform: "none" });
  expect(unobserve).toHaveBeenCalledWith(section);
  act(() => { onIntersection([{
    target: section, isIntersecting: true, intersectionRatio: 1, time: 0, rootBounds: null,
    boundingClientRect: section.getBoundingClientRect(), intersectionRect: section.getBoundingClientRect(),
  }], {} as IntersectionObserver); });
  expect(animate).not.toHaveBeenCalled();
  expect(section).toHaveStyle({ opacity: "1", transform: "none" });
});
