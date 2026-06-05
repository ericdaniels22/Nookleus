// Issue #401 — Photo Report Rework, Slice 2b.
//
// Tests for the pure drag-end resolver: it maps a dnd-kit DragEndEvent (active +
// over, each carrying a `data.current` descriptor the builder attaches) into a
// single builder reducer action, or null when the drop is a no-op. Isolated from
// React so it can be unit tested in plain Node (mirrors move-line-item.ts).

import { describe, expect, it } from "vitest";

import { resolvePhotoReportDragEnd } from "./photo-report-drag";

function section(id: string, index: number) {
  return { id, data: { current: { type: "section", index } } };
}

function photo(id: string, sectionIndex: number) {
  return { id, data: { current: { type: "photo", photoId: id, sectionIndex } } };
}

describe("resolvePhotoReportDragEnd", () => {
  it("maps a section dropped onto another section to a reorder", () => {
    const action = resolvePhotoReportDragEnd({
      active: section("s0", 0),
      over: section("s2", 2),
    });
    expect(action).toEqual({ type: "reorderSection", from: 0, to: 2 });
  });

  it("returns null when there is no drop target", () => {
    expect(
      resolvePhotoReportDragEnd({ active: section("s0", 0), over: null }),
    ).toBeNull();
  });

  it("maps a photo dropped onto a section to an assignment into that section", () => {
    const action = resolvePhotoReportDragEnd({
      active: photo("p1", 0),
      over: section("s1", 1),
    });
    expect(action).toEqual({
      type: "assignPhotoToSection",
      photoId: "p1",
      sectionIndex: 1,
    });
  });

  it("treats dropping a photo back onto its own section as a no-op", () => {
    // No within-section reordering this slice — a same-section drop changes
    // nothing rather than surprising the user by jumping the photo to the end.
    // (Sections are the only drop targets, so `over` is always a section.)
    expect(
      resolvePhotoReportDragEnd({ active: photo("p1", 0), over: section("s0", 0) }),
    ).toBeNull();
  });

  it("returns null for an unrecognized drag descriptor", () => {
    expect(
      resolvePhotoReportDragEnd({
        active: { id: "x", data: { current: { type: "mystery" } } },
        over: section("s1", 1),
      }),
    ).toBeNull();
  });
});
