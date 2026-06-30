import { describe, it, expect } from "vitest";

import {
  annotationKind,
  toolbarControls,
  toolbarAnchorPoint,
  DUPLICATE_OFFSET,
} from "./annotation-toolbar";

describe("annotationKind — classifying a selected Fabric object", () => {
  it("classifies a FabricArrow as an arrow", () => {
    expect(annotationKind("FabricArrow")).toBe("arrow");
  });

  it("classifies the drawable shapes by their Fabric type", () => {
    expect(annotationKind("Ellipse")).toBe("ellipse");
    expect(annotationKind("Rect")).toBe("rectangle");
    expect(annotationKind("Polyline")).toBe("polyline");
    expect(annotationKind("Polygon")).toBe("polygon");
  });

  it("classifies a text box and a freehand drawing", () => {
    expect(annotationKind("IText")).toBe("text");
    expect(annotationKind("Path")).toBe("freehand");
  });

  it("returns null for the background image, unknown objects, and an absent type", () => {
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

  it("gives a text box and a freehand drawing a Label then Delete toolbar (no Copy)", () => {
    // #812 — every Annotation can carry a Label, so text and freehand gain the
    // Label control; they still expose no Copy (an unchanged #811 decision).
    expect(toolbarControls("text")).toEqual(["label", "delete"]);
    expect(toolbarControls("freehand")).toEqual(["label", "delete"]);
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
