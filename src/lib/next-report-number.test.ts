// Issue #400 — Photo Report Rework, Slice 2a.
//
// A Photo Report is numbered per Job ("Report #1, #2, ..."). `nextReportNumber`
// is the single, pure place that decides the next number from the numbers a Job
// already has, so the "what number is this report" rule lives in one
// unit-testable spot instead of inside a route handler or component.

import { describe, expect, it } from "vitest";

import { nextReportNumber } from "./next-report-number";

describe("nextReportNumber", () => {
  it("starts at 1 when a Job has no numbered reports yet", () => {
    expect(nextReportNumber([])).toBe(1);
  });

  it("is one past the highest number a Job already uses", () => {
    expect(nextReportNumber([1])).toBe(2);
    expect(nextReportNumber([1, 2, 3])).toBe(4);
  });

  it("leaves gaps alone — it never reuses a freed-up number", () => {
    // Report #2 was deleted; the next report is #4, not #2.
    expect(nextReportNumber([1, 3])).toBe(4);
  });

  it("does not assume the numbers arrive sorted", () => {
    expect(nextReportNumber([3, 1, 2])).toBe(4);
    expect(nextReportNumber([5, 2])).toBe(6);
  });

  it("tolerates duplicate numbers without double-counting", () => {
    expect(nextReportNumber([2, 2, 2])).toBe(3);
  });
});
