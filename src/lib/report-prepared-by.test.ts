// Issue #400 — Photo Report Rework, Slice 2a.
//
// The Photo Report PDF prints a "Prepared by {name}" line sourced from the
// report's `created_by` (now the real preparer's name). `formatPreparedBy` is
// the single, read-tolerant place that decides that line, so the cover page
// stays a thin renderer: it shows the line when there is a name and shows
// nothing for legacy/blank rows.

import { describe, expect, it } from "vitest";

import { formatPreparedBy } from "./report-prepared-by";

describe("formatPreparedBy", () => {
  it("renders the preparer's name on the line", () => {
    expect(formatPreparedBy("Eric Daniels")).toBe("Prepared by Eric Daniels");
  });

  it("works for the legacy single-name rows", () => {
    expect(formatPreparedBy("Eric")).toBe("Prepared by Eric");
  });

  it("shows nothing when there is no name", () => {
    expect(formatPreparedBy("")).toBeNull();
    expect(formatPreparedBy("   ")).toBeNull();
    expect(formatPreparedBy(null)).toBeNull();
    expect(formatPreparedBy(undefined)).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(formatPreparedBy("  Eric Daniels  ")).toBe(
      "Prepared by Eric Daniels",
    );
  });
});
