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
  it("collapses each Path + two white Circle handles into one FabricArrow, keeping other objects in order", () => {
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

    expect(parseAnnotations(stored)).toEqual([
      { type: "rect", left: 1, top: 1 },
      { type: "i-text", left: 5, top: 5, text: "note" },
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
    ]);
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
  it("is the single allowlist of custom Annotation properties (Arrow + shared Label)", () => {
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
