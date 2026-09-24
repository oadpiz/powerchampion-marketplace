import { describe, expect, it } from "vitest";
import { taskEntry } from "../lib/task-starters";

describe("task entry links", () => {
  it.each(["analysis", "comparison", "handover"])("keeps a valid %s starter without carrying extra fields", (starter) => {
    expect(taskEntry(`?starter=${starter}&key=must-not-travel&goal=untrusted`)).toEqual({
      agent: null, starterId: starter, returnPath: `/tasks?starter=${starter}`,
    });
  });

  it("keeps both a valid agent and starter in one canonical return path", () => {
    const agent = "d".repeat(32);
    expect(taskEntry(`?starter=comparison&agent=${agent}`)).toEqual({
      agent, starterId: "comparison", returnPath: `/tasks?agent=${agent}&starter=comparison`,
    });
  });

  it.each(["unknown", "https://outside.example", "//outside.example", "analysis%26next%3Dhttps%3A%2F%2Foutside.example", ""])("ignores the unsupported starter %s", (starter) => {
    expect(taskEntry(`?starter=${starter}`)).toEqual({ agent: null, starterId: null, returnPath: "/tasks" });
  });

  it("retains an invalid agent as an explicit missing selection but never propagates it through authentication", () => {
    expect(taskEntry("?agent=unavailable&starter=handover")).toEqual({
      agent: "unavailable", starterId: "handover", returnPath: "/tasks?starter=handover",
    });
  });
});
