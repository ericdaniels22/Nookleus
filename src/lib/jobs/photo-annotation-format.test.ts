import { describe, it, expect } from "vitest";

import {
  ANNOTATION_CUSTOM_PROPS,
  parseAnnotations,
  serializeAnnotations,
} from "./photo-annotation-format";

describe("parseAnnotations — format 3 (native Fabric JSON)", () => {
  it("returns the stored canvas objects for a format-3 envelope", () => {
    const stored = {
      format: 3,
      canvas: {
        version: "7.2.0",
        objects: [
          { type: "Rect", left: 10, top: 20 },
          { type: "FabricArrow", x1: 0, y1: 0, x2: 5, y2: 5 },
        ],
      },
    };

    expect(parseAnnotations(stored)).toEqual([
      { type: "Rect", left: 10, top: 20 },
      { type: "FabricArrow", x1: 0, y1: 0, x2: 5, y2: 5 },
    ]);
  });
});

describe("parseAnnotations — version 2 (explicit arrow data)", () => {
  it("converts arrows to FabricArrow descriptors, then appends non-arrow objects", () => {
    const stored = {
      version: 2,
      arrows: [
        {
          x1: 1,
          y1: 2,
          x2: 3,
          y2: 4,
          color: "#FF0000",
          label: { text: "leak", fontSize: 28 },
        },
      ],
      objects: [{ type: "Ellipse", left: 50, top: 60 }],
    };

    expect(parseAnnotations(stored)).toEqual([
      {
        type: "FabricArrow",
        x1: 1,
        y1: 2,
        x2: 3,
        y2: 4,
        arrowColor: "#FF0000",
        labelText: "leak",
        labelFontSize: 28,
        arrowThickness: 6,
      },
      { type: "Ellipse", left: 50, top: 60 },
    ]);
  });

  it("applies default color, label and font size when an arrow omits them", () => {
    const stored = {
      version: 2,
      arrows: [{ x1: 0, y1: 0, x2: 10, y2: 10 }],
    };

    expect(parseAnnotations(stored)).toEqual([
      {
        type: "FabricArrow",
        x1: 0,
        y1: 0,
        x2: 10,
        y2: 10,
        arrowColor: "#F59E0B",
        labelText: null,
        labelFontSize: 20,
        arrowThickness: 6,
      },
    ]);
  });
});

describe("parseAnnotations — version 1 (raw dump with Path+Circle arrow triples)", () => {
  it("collapses each Path + two white Circle handles into one FabricArrow, in its original z-position", () => {
    const stored = {
      version: "5.3.0",
      objects: [
        { type: "rect", left: 1, top: 1 },
        {
          type: "path",
          strokeWidth: 6,
          strokeLineCap: "round",
          fill: "transparent",
          stroke: "#00FF00",
          path: [["M", 100, 110]],
        },
        { type: "circle", radius: 8, fill: "#FFFFFF", left: 100, top: 110 },
        { type: "circle", radius: 8, fill: "#FFFFFF", left: 200, top: 210 },
        { type: "i-text", left: 5, top: 5, text: "note" },
      ],
    };

    // The recovered Arrow takes the slot its collapsed triple occupied —
    // between the rect below it and the i-text drawn over it — so the migrated
    // stacking order matches what the user originally drew.
    expect(parseAnnotations(stored)).toEqual([
      { type: "rect", left: 1, top: 1 },
      {
        type: "FabricArrow",
        x1: 100,
        y1: 110,
        x2: 200,
        y2: 210,
        arrowColor: "#00FF00",
        labelText: null,
        labelFontSize: 20,
        arrowThickness: 6,
      },
      { type: "i-text", left: 5, top: 5, text: "note" },
    ]);
  });

  it("keeps a recovered Arrow below a shape that was drawn over it (no z-lift)", () => {
    const stored = {
      version: "5.3.0",
      objects: [
        // Arrow drawn FIRST, so it sits at the bottom of the stack.
        {
          type: "path",
          strokeWidth: 6,
          strokeLineCap: "round",
          fill: "transparent",
          stroke: "#00FF00",
        },
        { type: "circle", radius: 8, fill: "#FFFFFF", left: 10, top: 10 },
        { type: "circle", radius: 8, fill: "#FFFFFF", left: 90, top: 90 },
        // Rect drawn AFTER the arrow — it must stay on top of it.
        { type: "rect", left: 2, top: 2 },
      ],
    };

    expect(parseAnnotations(stored)).toEqual([
      {
        type: "FabricArrow",
        x1: 10,
        y1: 10,
        x2: 90,
        y2: 90,
        arrowColor: "#00FF00",
        labelText: null,
        labelFontSize: 20,
        arrowThickness: 6,
      },
      { type: "rect", left: 2, top: 2 },
    ]);
  });

  it("preserves z-order across multiple arrows interleaved with shapes", () => {
    const arrowTriple = (stroke: string, x: number, y: number) => [
      {
        type: "path",
        strokeWidth: 6,
        strokeLineCap: "round",
        fill: "transparent",
        stroke,
      },
      { type: "circle", radius: 8, fill: "#FFFFFF", left: x, top: y },
      { type: "circle", radius: 8, fill: "#FFFFFF", left: x + 50, top: y + 50 },
    ];
    const stored = {
      version: "5.3.0",
      objects: [
        { type: "rect", left: 0, top: 0 },
        ...arrowTriple("#111111", 10, 10),
        { type: "ellipse", left: 5, top: 5 },
        ...arrowTriple("#222222", 20, 20),
      ],
    };

    const result = parseAnnotations(stored);

    expect(result.map((o) => o.type)).toEqual([
      "rect",
      "FabricArrow",
      "ellipse",
      "FabricArrow",
    ]);
    // Each recovered Arrow carries its own triple's color — they didn't swap or
    // bunch up at the end.
    expect(result[1].arrowColor).toBe("#111111");
    expect(result[3].arrowColor).toBe("#222222");
  });

  it("leaves a stroked Path that lacks two white Circle handles untouched", () => {
    const stored = {
      version: "5.3.0",
      objects: [
        {
          type: "path",
          strokeWidth: 6,
          strokeLineCap: "round",
          fill: "transparent",
          stroke: "#00FF00",
        },
        { type: "circle", radius: 8, fill: "#FFFFFF", left: 1, top: 1 },
        { type: "rect", left: 2, top: 2 },
      ],
    };

    // Only one handle circle follows the path, so nothing collapses.
    expect(parseAnnotations(stored)).toEqual([
      {
        type: "path",
        strokeWidth: 6,
        strokeLineCap: "round",
        fill: "transparent",
        stroke: "#00FF00",
      },
      { type: "circle", radius: 8, fill: "#FFFFFF", left: 1, top: 1 },
      { type: "rect", left: 2, top: 2 },
    ]);
  });
});

describe("parseAnnotations — defensive (empty / malformed input)", () => {
  it("returns an empty array for nullish, non-object, empty and malformed input", () => {
    expect(parseAnnotations(null)).toEqual([]);
    expect(parseAnnotations(undefined)).toEqual([]);
    expect(parseAnnotations("{}")).toEqual([]);
    expect(parseAnnotations({})).toEqual([]);
    expect(parseAnnotations({ format: 3 })).toEqual([]); // format 3 but no canvas
    expect(parseAnnotations({ version: 2 })).toEqual([]); // version 2 but no arrows/objects
  });
});

describe("serializeAnnotations", () => {
  it("wraps markup objects in the format-3 envelope (markup only)", () => {
    const objects = [
      { type: "Rect", left: 1, top: 2 },
      { type: "FabricArrow", x1: 0, y1: 0, x2: 9, y2: 9 },
    ];

    expect(serializeAnnotations(objects)).toEqual({
      format: 3,
      canvas: { version: "7.2.0", objects },
    });
  });

  it("serializes an empty markup set to an empty objects array", () => {
    expect(serializeAnnotations([])).toEqual({
      format: 3,
      canvas: { version: "7.2.0", objects: [] },
    });
  });
});

describe("ANNOTATION_CUSTOM_PROPS", () => {
  it("is the single allowlist of every Annotation's custom properties", () => {
    expect([...ANNOTATION_CUSTOM_PROPS]).toEqual([
      "x1",
      "y1",
      "x2",
      "y2",
      "arrowColor",
      "labelText",
      "labelFontSize",
      "labelColor",
      "arrowThickness",
      "markerNumber",
      "markerColor",
    ]);
  });
});

describe("round-trip parity", () => {
  it("re-parses serialized markup to an identical Annotation array (no markup dropped)", () => {
    // A version-2 record migrates on parse; wrapping it and parsing again must
    // be a fixed point — proof that serialize drops no markup.
    const v2 = {
      version: 2,
      arrows: [{ x1: 1, y1: 2, x2: 3, y2: 4, color: "#ABCDEF" }],
      objects: [{ type: "Ellipse", left: 7, top: 8 }],
    };

    const once = parseAnnotations(v2);
    const roundTripped = parseAnnotations(serializeAnnotations(once));

    expect(roundTripped).toEqual(once);
  });
});
