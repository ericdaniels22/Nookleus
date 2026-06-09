import { describe, it, expect } from "vitest";
import {
  rowTint,
  canTransitionEstimate,
  ESTIMATE_STATUS_TRANSITIONS,
  type RowTint,
  type EntityKind,
} from "./estimate-status";
import type { EstimateStatus } from "@/lib/types";

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
    ["estimate", "converted", "none"],
    ["estimate", "voided", "none"],
  ];

  it.each(cases)("tints (%s, %s) as %s", (kind, status, expected) => {
    expect(rowTint(kind, status)).toBe(expected);
  });
});

// #567 — the Estimate workflow is exactly draft → sent → converted / voided,
// realigning with ADR 0007 (the approved/rejected step is dropped). These are
// the pure transition rules extracted out of the status API route. Convert is
// its own action (POST /convert) that flips the row to `converted`, never a
// status transition — so neither `converted` nor any path *to* it appears here.
describe("ESTIMATE_STATUS_TRANSITIONS", () => {
  it("pins the allowed set: draft→{sent,voided}, sent→{voided}, converted/voided terminal", () => {
    expect(ESTIMATE_STATUS_TRANSITIONS).toEqual({
      draft: ["sent", "voided"],
      sent: ["voided"],
      converted: [],
      voided: [],
    });
  });

  it("has dropped the old approved / rejected states entirely", () => {
    expect(ESTIMATE_STATUS_TRANSITIONS).not.toHaveProperty("approved");
    expect(ESTIMATE_STATUS_TRANSITIONS).not.toHaveProperty("rejected");
    for (const targets of Object.values(ESTIMATE_STATUS_TRANSITIONS)) {
      expect(targets).not.toContain("approved");
      expect(targets).not.toContain("rejected");
    }
  });
});

describe("canTransitionEstimate", () => {
  const statuses: EstimateStatus[] = ["draft", "sent", "converted", "voided"];
  const allowed = new Set(["draft→sent", "draft→voided", "sent→voided"]);
  const cases: Array<[EstimateStatus, EstimateStatus, boolean]> = statuses.flatMap(
    (from) =>
      statuses.map(
        (to) =>
          [from, to, allowed.has(`${from}→${to}`)] as [
            EstimateStatus,
            EstimateStatus,
            boolean,
          ],
      ),
  );

  it.each(cases)("%s → %s allowed=%s", (from, to, expected) => {
    expect(canTransitionEstimate(from, to)).toBe(expected);
  });

  it("rejects the retired approved / rejected transitions", () => {
    // Old workflow allowed sent→approved, sent→rejected, approved→voided.
    // None survive: approved/rejected are no longer valid statuses, and an
    // unknown `from` must be treated as terminal rather than throwing.
    const approved = "approved" as string as EstimateStatus;
    const rejected = "rejected" as string as EstimateStatus;
    expect(canTransitionEstimate("sent", approved)).toBe(false);
    expect(canTransitionEstimate("sent", rejected)).toBe(false);
    expect(canTransitionEstimate(approved, "voided")).toBe(false);
  });
});
