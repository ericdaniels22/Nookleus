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

  it("falls back to comfortable when nothing is stored", () => {
    expect(parseJobsViewMode(null)).toBe("comfortable");
    expect(parseJobsViewMode(undefined)).toBe("comfortable");
  });

  it("falls back to comfortable for an unrecognized stored value", () => {
    expect(parseJobsViewMode("banana")).toBe("comfortable");
    expect(parseJobsViewMode("")).toBe("comfortable");
    expect(parseJobsViewMode("GRID")).toBe("comfortable");
  });
});
