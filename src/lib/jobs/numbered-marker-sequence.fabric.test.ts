// Issue #852 — the live-Fabric regression guard for the Numbered marker
// auto-sequence (#816). The pure nextMarkerNumber rule is already covered by the
// array-helper test; this one mounts a REAL Fabric canvas with REAL marker
// instances so it pins the casing the bug turned on: a *live* Fabric object's
// `.type` is lowercased (`"fabricnumberedmarker"`), so the old
// `o.type === "FabricNumberedMarker"` filter never matched and every drop badged
// 1. existingMarkerNumbers routes the read through annotationKind instead, so it
// classifies a live marker the same way the delete path does.

import { describe, it, expect } from "vitest";
import { StaticCanvas, FabricObject, Rect } from "fabric";

import {
  existingMarkerNumbers,
  nextMarkerNumber,
} from "./numbered-marker-sequence";

// A faithful stand-in for the annotator's inline FabricNumberedMarker: a custom
// subclass whose PascalCase `static type` is what Fabric lowercases on a live
// instance, plus the `markerNumber` the sequence reads. We don't import the real
// class (it lives inside the 2.7k-line client component); we only need Fabric's
// genuine static→live type lowering, which any subclass exhibits.
class TestMarker extends FabricObject {
  static type = "FabricNumberedMarker";
  declare markerNumber: number;

  constructor(options: { markerNumber?: number } = {}) {
    super();
    this.markerNumber = options.markerNumber ?? 1;
  }
}

// A live Arrow alongside the markers — its lowercase `"fabricarrow"` type must
// NOT be counted as a marker, the same way the delete path tells them apart.
class TestArrow extends FabricObject {
  static type = "FabricArrow";
}

// Drop one marker the way the annotator's mouse:up handler does: count what's on
// the canvas, ask for the next number, add it. Returns the badged number.
function dropMarker(canvas: StaticCanvas): number {
  const markerNumber = nextMarkerNumber(existingMarkerNumbers(canvas.getObjects()));
  canvas.add(new TestMarker({ markerNumber }));
  return markerNumber;
}

describe("Numbered marker drop sequence on a live Fabric canvas (#852)", () => {
  it("badges three markers dropped in a row 1, 2, 3", () => {
    const canvas = new StaticCanvas(undefined, { renderOnAddRemove: false });

    // A live marker reports a LOWERCASE type — the casing the bug hinged on.
    // `o.type === "FabricNumberedMarker"` (PascalCase) could never match this.
    expect(new TestMarker().type).toBe("fabricnumberedmarker");

    expect(dropMarker(canvas)).toBe(1);
    expect(dropMarker(canvas)).toBe(2);
    expect(dropMarker(canvas)).toBe(3);

    const badged = canvas
      .getObjects()
      .map((o) => (o as TestMarker).markerNumber);
    expect(badged).toEqual([1, 2, 3]);
  });

  it("counts only markers — other live annotations don't shift the sequence", () => {
    const canvas = new StaticCanvas(undefined, { renderOnAddRemove: false });

    // A Photo already carrying markers 1 and 2, plus a couple of non-marker
    // annotations (a plain Rect and an Arrow) mixed in among them.
    canvas.add(new TestMarker({ markerNumber: 1 }));
    canvas.add(new Rect({ width: 10, height: 10 }));
    canvas.add(new TestMarker({ markerNumber: 2 }));
    canvas.add(new TestArrow());

    // existingMarkerNumbers sees through annotationKind, so the Rect and Arrow
    // are ignored — only the two real markers count.
    expect(existingMarkerNumbers(canvas.getObjects())).toEqual([1, 2]);

    // So the next drop continues from the highest marker (2 → 3), unaffected by
    // the other annotations on the Photo.
    expect(dropMarker(canvas)).toBe(3);
  });
});
