// Issue #402 — Photo Report Rework, Slice 2c.
//
// The recoverable-trash split for Photo Reports. A report is "active" while its
// `deleted_at` is null and "trashed" once it carries a timestamp — the same
// canonical rule the rest of the platform uses for a soft-deleted row
// (`deleted_at IS NULL`, the Active-job rule). This is the single, pure place
// that owns that decision so the Overview list, the trash view, and any future
// guard all agree on what counts as active.

import { describe, expect, it } from "vitest";

import {
  isActivePhotoReport,
  isTrashedPhotoReport,
  partitionPhotoReportsByTrash,
} from "./photo-report-trash";

describe("isActivePhotoReport", () => {
  it("treats a report with no deleted_at as active", () => {
    expect(isActivePhotoReport({ deleted_at: null })).toBe(true);
  });

  it("treats a report carrying a deleted_at timestamp as not active", () => {
    expect(
      isActivePhotoReport({ deleted_at: "2026-06-04T17:00:00.000Z" }),
    ).toBe(false);
  });
});

describe("isTrashedPhotoReport", () => {
  it("is the inverse of active: a timestamp means trashed", () => {
    expect(
      isTrashedPhotoReport({ deleted_at: "2026-06-04T17:00:00.000Z" }),
    ).toBe(true);
    expect(isTrashedPhotoReport({ deleted_at: null })).toBe(false);
  });
});

describe("partitionPhotoReportsByTrash", () => {
  it("splits a mixed list into active and trashed, preserving order", () => {
    const reports = [
      { id: "a", deleted_at: null },
      { id: "b", deleted_at: "2026-06-04T10:00:00.000Z" },
      { id: "c", deleted_at: null },
      { id: "d", deleted_at: "2026-06-04T11:00:00.000Z" },
    ];

    const { active, trashed } = partitionPhotoReportsByTrash(reports);

    expect(active.map((r) => r.id)).toEqual(["a", "c"]);
    expect(trashed.map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("returns two empty buckets for a Job with no reports yet", () => {
    // The always-visible Overview list relies on this: no reports still yields
    // a (rendered) empty active list rather than nothing at all (AC #1).
    expect(partitionPhotoReportsByTrash([])).toEqual({
      active: [],
      trashed: [],
    });
  });
});
