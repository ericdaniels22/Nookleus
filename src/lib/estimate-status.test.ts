import { describe, it, expect } from "vitest";
import { rowTint, type RowTint, type EntityKind } from "./estimate-status";

// #384 — Status presentation: the Overview row tint draws attention only where
// it's needed. A converted invoice still in draft is yellow ("ready for
// review"); a sent invoice is blue; estimate rows and every other invoice state
// are untinted. This is the isolation test that each (kind, status) pair yields
// the expected tint.
describe("rowTint", () => {
  const cases: Array<[EntityKind, string, RowTint]> = [
    // Invoice rows — only draft and sent are tinted.
    ["invoice", "draft", "yellow"],
    ["invoice", "sent", "blue"],
    ["invoice", "partial", "none"],
    ["invoice", "paid", "none"],
    ["invoice", "voided", "none"],
    // Estimate rows — colour is reserved for invoices, so always untinted.
    ["estimate", "draft", "none"],
    ["estimate", "sent", "none"],
    ["estimate", "approved", "none"],
    ["estimate", "rejected", "none"],
    ["estimate", "converted", "none"],
    ["estimate", "voided", "none"],
  ];

  it.each(cases)("tints (%s, %s) as %s", (kind, status, expected) => {
    expect(rowTint(kind, status)).toBe(expected);
  });
});
