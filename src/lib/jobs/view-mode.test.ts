import { describe, expect, it } from "vitest";

import { parseJobsViewMode } from "./view-mode";

describe("parseJobsViewMode", () => {
  it("returns the mode for a recognized stored value", () => {
    expect(parseJobsViewMode("list")).toBe("list");
  });

  it("recognizes every valid view mode", () => {
    expect(parseJobsViewMode("grid")).toBe("grid");
    expect(parseJobsViewMode("comfortable")).toBe("comfortable");
    expect(parseJobsViewMode("list")).toBe("list");
  });

  it("falls back to grid when nothing is stored", () => {
    expect(parseJobsViewMode(null)).toBe("grid");
    expect(parseJobsViewMode(undefined)).toBe("grid");
  });

  it("falls back to grid for an unrecognized stored value", () => {
    expect(parseJobsViewMode("banana")).toBe("grid");
    expect(parseJobsViewMode("")).toBe("grid");
    expect(parseJobsViewMode("GRID")).toBe("grid");
  });
});
