import { describe, it, expect } from "vitest";

import {
  annotationKind,
  toolbarControls,
  toolbarAnchorPoint,
  DUPLICATE_OFFSET,
} from "./annotation-toolbar";

describe("annotationKind — classifying a selected Fabric object", () => {
  // A *live* Fabric instance reports a lowercase `type` — this is what the
  // annotator's selection handler actually passes (`target.type`). IText is the
  // odd one out: its live type is the hyphenated "i-text".
  it("classifies a live (lowercase) Fabric instance type", () => {
    expect(annotationKind("fabricarrow")).toBe("arrow");
    expect(annotationKind("ellipse")).toBe("ellipse");
    expect(annotationKind("rect")).toBe("rectangle");
    expect(annotationKind("polyline")).toBe("polyline");
    expect(annotationKind("polygon")).toBe("polygon");
    expect(annotationKind("i-text")).toBe("text");
    expect(annotationKind("path")).toBe("freehand");
  });

  // A *serialized* object and the static subclass `type` are PascalCase; the
  // classifier accepts those too so the same call site works either way.
  it("classifies a serialized (PascalCase) Fabric type", () => {
    expect(annotationKind("FabricArrow")).toBe("arrow");
    expect(annotationKind("Ellipse")).toBe("ellipse");
    expect(annotationKind("Rect")).toBe("rectangle");
    expect(annotationKind("Polyline")).toBe("polyline");
    expect(annotationKind("Polygon")).toBe("polygon");
    expect(annotationKind("IText")).toBe("text");
    expect(annotationKind("Path")).toBe("freehand");
  });

  it("classifies a FabricNumberedMarker as a marker in either form", () => {
    expect(annotationKind("fabricnumberedmarker")).toBe("marker"); // live
    expect(annotationKind("FabricNumberedMarker")).toBe("marker"); // serialized
  });

  it("returns null for the background image, unknown objects, and an absent type", () => {
    expect(annotationKind("image")).toBeNull(); // live background-image type
    expect(annotationKind("FabricImage")).toBeNull();
    expect(annotationKind("Group")).toBeNull();
    expect(annotationKind(undefined)).toBeNull();
    expect(annotationKind(null)).toBeNull();
  });
});

describe("toolbarControls — which controls a kind's toolbar shows", () => {
  it("gives an arrow a Label, Copy, then Delete control, in that order", () => {
    expect(toolbarControls("arrow")).toEqual(["label", "copy", "delete"]);
  });

  it("gives every shape kind the full Label, Copy, Delete toolbar", () => {
    for (const kind of ["ellipse", "rectangle", "polyline", "polygon"] as const) {
      expect(toolbarControls(kind)).toEqual(["label", "copy", "delete"]);
    }
  });

  it("gives a text box and a freehand drawing a Delete-only toolbar", () => {
    expect(toolbarControls("text")).toEqual(["delete"]);
    expect(toolbarControls("freehand")).toEqual(["delete"]);
  });

  it("gives a Numbered marker a Label then Delete toolbar, but no Copy", () => {
    expect(toolbarControls("marker")).toEqual(["label", "delete"]);
  });
});

describe("DUPLICATE_OFFSET — the diagonal offset a copied Annotation lands at", () => {
  it("matches the existing Arrow duplicate offset of 30px", () => {
    expect(DUPLICATE_OFFSET).toBe(30);
  });
});

describe("toolbarAnchorPoint — where the toolbar floats over an object", () => {
  it("returns the client point at the horizontal centre of the object's top edge", () => {
    const box = { left: 100, top: 40, width: 60 };
    const canvasRect = { left: 10, top: 20 };
    expect(toolbarAnchorPoint(box, canvasRect)).toEqual({ x: 140, y: 60 });
  });

  it("offsets by the canvas's on-screen position so the point is in client space", () => {
    const box = { left: 0, top: 0, width: 0 };
    expect(toolbarAnchorPoint(box, { left: 200, top: 300 })).toEqual({
      x: 200,
      y: 300,
    });
  });
});
