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

function photo(id: string, sectionIndex: number, photoIndex?: number) {
  return {
    id,
    data: { current: { type: "photo", photoId: id, sectionIndex, photoIndex } },
  };
}

// A photo in the phone-only "not in the report" tray: no Section, no position.
function trayPhoto(id: string) {
  return { id, data: { current: { type: "photo", photoId: id } } };
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

  it("treats dropping a photo back onto its own section's container as a no-op", () => {
    // The container drop carries no target position, and assigning would
    // surprise the user by jumping the photo to the end.
    expect(
      resolvePhotoReportDragEnd({ active: photo("p1", 0), over: section("s0", 0) }),
    ).toBeNull();
  });

  it("maps a photo dropped onto another photo in the same section to a within-section reorder (#552)", () => {
    const action = resolvePhotoReportDragEnd({
      active: photo("p1", 0, 0),
      over: photo("p3", 0, 2),
    });
    expect(action).toEqual({
      type: "reorderPhotoWithinSection",
      sectionIndex: 0,
      from: 0,
      to: 2,
    });
  });

  it("treats a photo dropped onto its own position as a no-op", () => {
    expect(
      resolvePhotoReportDragEnd({
        active: photo("p1", 0, 1),
        over: photo("p1", 0, 1),
      }),
    ).toBeNull();
  });

  it("maps a photo dropped onto a photo in another section to an assignment into that section", () => {
    const action = resolvePhotoReportDragEnd({
      active: photo("p1", 0, 0),
      over: photo("p9", 2, 1),
    });
    expect(action).toEqual({
      type: "assignPhotoToSection",
      photoId: "p1",
      sectionIndex: 2,
    });
  });

  it("maps a tray photo dropped onto a photo in a section to an assignment into that section", () => {
    const action = resolvePhotoReportDragEnd({
      active: trayPhoto("p9"),
      over: photo("p1", 1, 0),
    });
    expect(action).toEqual({
      type: "assignPhotoToSection",
      photoId: "p9",
      sectionIndex: 1,
    });
  });

  it("treats a photo dropped onto a tray photo as a no-op (the tray is not a drop target)", () => {
    expect(
      resolvePhotoReportDragEnd({
        active: photo("p1", 0, 0),
        over: trayPhoto("p9"),
      }),
    ).toBeNull();
  });

  it("maps a section dropped onto a photo to a reorder targeting that photo's section", () => {
    // closestCenter can pick a photo as the nearest droppable while a section
    // card is being dragged; landing on a photo means landing on its section.
    const action = resolvePhotoReportDragEnd({
      active: section("s0", 0),
      over: photo("p9", 2, 1),
    });
    expect(action).toEqual({ type: "reorderSection", from: 0, to: 2 });
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
