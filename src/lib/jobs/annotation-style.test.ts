import { describe, it, expect } from "vitest";

import {
  ANNOTATION_COLORS,
  ANNOTATION_THICKNESSES,
  applyColor,
  applyThickness,
  arrowHeadLength,
  currentColor,
  currentThickness,
  supportsStyleEditor,
} from "./annotation-style";

describe("applyColor — recoloring a selected Annotation in place", () => {
  it("repaints a selected Arrow by writing its arrowColor, leaving endpoints and Label intact", () => {
    const arrow = {
      type: "FabricArrow",
      x1: 10,
      y1: 20,
      x2: 110,
      y2: 0,
      arrowColor: "#F59E0B",
      arrowThickness: 4,
      labelText: "ridge",
      set(key: string, value: unknown) {
        (this as Record<string, unknown>)[key] = value;
      },
    };

    applyColor(arrow, "#C41E2A");

    expect(arrow.arrowColor).toBe("#C41E2A");
    // The same object is recoloured in place — its identity, endpoints,
    // thickness, and attached Label are untouched.
    expect(arrow.x1).toBe(10);
    expect(arrow.y1).toBe(20);
    expect(arrow.x2).toBe(110);
    expect(arrow.y2).toBe(0);
    expect(arrow.arrowThickness).toBe(4);
    expect(arrow.labelText).toBe("ridge");
  });

  it("repaints a shape or freehand path by writing its stroke, not arrowColor", () => {
    for (const fabricType of ["Ellipse", "Rect", "Polyline", "Polygon", "Path"]) {
      const shape = {
        type: fabricType,
        stroke: "#F59E0B",
        strokeWidth: 4,
        left: 5,
        top: 6,
        set(key: string, value: unknown) {
          (this as Record<string, unknown>)[key] = value;
        },
      };

      applyColor(shape, "#2B5EA7");

      expect(shape.stroke).toBe("#2B5EA7");
      expect(shape).not.toHaveProperty("arrowColor");
      // geometry untouched
      expect(shape.strokeWidth).toBe(4);
      expect(shape.left).toBe(5);
      expect(shape.top).toBe(6);
    }
  });
});

describe("applyThickness — re-weighting a selected Annotation in place", () => {
  it("re-thickens a selected Arrow by writing its arrowThickness, leaving color and endpoints intact", () => {
    const arrow = {
      type: "FabricArrow",
      x1: 10,
      y1: 20,
      x2: 110,
      y2: 0,
      arrowColor: "#F59E0B",
      arrowThickness: 4,
      set(key: string, value: unknown) {
        (this as Record<string, unknown>)[key] = value;
      },
    };

    applyThickness(arrow, 8);

    expect(arrow.arrowThickness).toBe(8);
    expect(arrow.arrowColor).toBe("#F59E0B");
    expect(arrow.x1).toBe(10);
    expect(arrow.x2).toBe(110);
  });

  it("re-thickens a shape or freehand path by writing its strokeWidth, not arrowThickness", () => {
    for (const fabricType of ["Ellipse", "Rect", "Polyline", "Polygon", "Path"]) {
      const shape = {
        type: fabricType,
        stroke: "#F59E0B",
        strokeWidth: 4,
        set(key: string, value: unknown) {
          (this as Record<string, unknown>)[key] = value;
        },
      };

      applyThickness(shape, 2);

      expect(shape.strokeWidth).toBe(2);
      expect(shape).not.toHaveProperty("arrowThickness");
      expect(shape.stroke).toBe("#F59E0B");
    }
  });
});

describe("arrowHeadLength — the Arrow's arrowhead scales with its thickness", () => {
  it("scales the arrowhead linearly so a thicker Arrow gets a proportionally longer head", () => {
    // The head length the FabricArrow render derives at creation today: thick * 4.
    // The editor changes only arrowThickness, so the head rescales through the
    // same single relationship — doubling thickness doubles head length.
    expect(arrowHeadLength(4)).toBe(16);
    expect(arrowHeadLength(8)).toBe(arrowHeadLength(4) * 2);
    expect(arrowHeadLength(2)).toBe(arrowHeadLength(4) / 2);
  });
});

describe("ANNOTATION_COLORS / ANNOTATION_THICKNESSES — the one palette shared by new markup and the editor", () => {
  it("offers the six canonical swatches in their fixed order", () => {
    expect(ANNOTATION_COLORS).toEqual([
      { value: "#F59E0B", label: "Yellow" },
      { value: "#C41E2A", label: "Red" },
      { value: "#2B5EA7", label: "Blue" },
      { value: "#0F6E56", label: "Green" },
      { value: "#FFFFFF", label: "White" },
      { value: "#1A1A1A", label: "Black" },
    ]);
  });

  it("offers the three canonical thickness steps in their fixed order", () => {
    expect(ANNOTATION_THICKNESSES).toEqual([
      { value: 2, label: "Thin" },
      { value: 4, label: "Medium" },
      { value: 8, label: "Thick" },
    ]);
  });
});

describe("supportsStyleEditor — which selected Annotations get the color/thickness editor", () => {
  it("offers the editor for an Arrow, every shape, and a freehand drawing", () => {
    for (const kind of [
      "arrow",
      "ellipse",
      "rectangle",
      "polyline",
      "polygon",
      "freehand",
    ] as const) {
      expect(supportsStyleEditor(kind)).toBe(true);
    }
  });

  it("withholds the editor from a text box, a Numbered marker, and a non-Annotation selection", () => {
    expect(supportsStyleEditor("text")).toBe(false);
    // A Numbered marker (#816) is a fixed-radius badge: it has no line weight to
    // re-thicken, and its color is set from the active color at drop time, not
    // edited after the fact — so the color/thickness editor does not apply.
    expect(supportsStyleEditor("marker")).toBe(false);
    expect(supportsStyleEditor(null)).toBe(false);
  });
});

describe("currentColor / currentThickness — what the editor pre-highlights", () => {
  it("reads an Arrow's color and thickness from its arrow-specific properties", () => {
    const arrow = {
      type: "FabricArrow",
      arrowColor: "#0F6E56",
      arrowThickness: 8,
      stroke: "#000000",
      strokeWidth: 1,
    };
    expect(currentColor(arrow)).toBe("#0F6E56");
    expect(currentThickness(arrow)).toBe(8);
  });

  it("reads a shape or freehand path's color and thickness from stroke / strokeWidth", () => {
    for (const fabricType of ["Ellipse", "Rect", "Polyline", "Polygon", "Path"]) {
      const shape = { type: fabricType, stroke: "#C41E2A", strokeWidth: 2 };
      expect(currentColor(shape)).toBe("#C41E2A");
      expect(currentThickness(shape)).toBe(2);
    }
  });
});
