// Issue #879 — Sketch S2, the hand-drawn Room footprint.
//
// A Room is no longer a width × length rectangle but a polygon footprint: an
// ordered list of corner points on a scaled grid (1 grid square = 1 ft), the
// walls being the edges between consecutive points on a closed loop
// (CONTEXT.md "Room"; ADR 0024). This module is the pure geometry the
// measurement calculator (M1) and the drawing surface both build on — area via
// the shoelace formula, perimeter as the closed-loop edge sum, and the bounding
// box that still feeds the legacy width/length columns. No Fabric, no I/O.

import { describe, expect, it } from "vitest";

import {
  boundingBox,
  normalizeFootprint,
  polygonArea,
  polygonPerimeter,
  rectangleFootprint,
  translateFootprint,
  type Point,
} from "./footprint";

// An L-shaped Room: a 4×4 square with a 2×2 bite taken out of the top-right.
// Area = 4×4 − 2×2 = 12; walls = 4 + 2 + 2 + 2 + 2 + 4 = 16; bbox = 4 × 4.
const L_SHAPE: Point[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 4 },
  { x: 0, y: 4 },
];

describe("rectangleFootprint", () => {
  it("turns a width × length into four corners walked from the origin", () => {
    // The rectangle is the bridge from #860's form to the polygon model: a
    // rectangle is just 4 points, so every #860 number must survive unchanged.
    expect(rectangleFootprint(3, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ]);
  });
});

describe("polygonArea", () => {
  it("measures a unit square as the identity case", () => {
    expect(polygonArea(rectangleFootprint(1, 1))).toBe(1);
  });

  it("matches #860 exactly for a rectangle (a rectangle is 4 points)", () => {
    expect(polygonArea(rectangleFootprint(3, 4))).toBe(12);
  });

  it("measures an arbitrary L-shape via the shoelace formula", () => {
    expect(polygonArea(L_SHAPE)).toBe(12);
  });

  it("is independent of winding direction (clockwise reads the same as counter)", () => {
    // The user can draw a footprint in either direction; area must not go
    // negative just because the points were placed clockwise.
    const reversed = [...L_SHAPE].reverse();
    expect(polygonArea(reversed)).toBe(12);
  });

  it("returns zero — never NaN — for a degenerate footprint of under three points", () => {
    // A half-drawn Room (no corners, one corner, or a single wall) has no area
    // yet, so the live readout shows 0 rather than NaN while the user draws.
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 3, y: 0 }])).toBe(0);
  });
});

describe("polygonPerimeter", () => {
  it("sums the closed-loop edges of a rectangle to match #860", () => {
    expect(polygonPerimeter(rectangleFootprint(3, 4))).toBe(14);
  });

  it("sums every wall of an L-shape, including the closing edge", () => {
    expect(polygonPerimeter(L_SHAPE)).toBe(16);
  });

  it("returns zero for a degenerate footprint of under three points", () => {
    expect(polygonPerimeter([])).toBe(0);
    expect(polygonPerimeter([{ x: 0, y: 0 }])).toBe(0);
    expect(polygonPerimeter([{ x: 0, y: 0 }, { x: 3, y: 0 }])).toBe(0);
  });
});

describe("normalizeFootprint", () => {
  it("moves a footprint's min corner to the origin, reporting where it used to be", () => {
    // ADR 0026: a Room stores its footprint normalized (min corner at 0,0) and
    // its position as a separate `origin`. A footprint drawn at (10, 20)..(13, 24)
    // normalizes to (0,0)..(3,4) with origin (10, 20) — the two together
    // reconstruct the original placement.
    const drawn: Point[] = [
      { x: 10, y: 20 },
      { x: 13, y: 20 },
      { x: 13, y: 24 },
      { x: 10, y: 24 },
    ];
    expect(normalizeFootprint(drawn)).toEqual({
      footprint: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
        { x: 0, y: 4 },
      ],
      origin: { x: 10, y: 20 },
    });
  });
});

describe("translateFootprint", () => {
  it("places a normalized footprint into floor space at its origin", () => {
    // The inverse of normalizeFootprint: to render every Room on one Floor, each
    // Room's normalized footprint is shifted by its `origin` so the rooms sit
    // side by side in shared floor coordinates.
    const normalized: Point[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(translateFootprint(normalized, { x: 10, y: 20 })).toEqual([
      { x: 10, y: 20 },
      { x: 13, y: 20 },
      { x: 13, y: 24 },
      { x: 10, y: 24 },
    ]);
  });

  it("round-trips with normalizeFootprint", () => {
    const drawn: Point[] = [
      { x: 5, y: 7 },
      { x: 9, y: 7 },
      { x: 9, y: 11 },
      { x: 5, y: 11 },
    ];
    const { footprint, origin } = normalizeFootprint(drawn);
    expect(translateFootprint(footprint, origin)).toEqual(drawn);
  });
});

describe("boundingBox", () => {
  it("reads a rectangle's own width and length back off its corners", () => {
    expect(boundingBox(rectangleFootprint(3, 4))).toEqual({ width: 3, length: 4 });
  });

  it("spans the full extent of an arbitrary footprint", () => {
    // The bounding box is what still populates the legacy width/length columns,
    // so an L-shape reports the 4 × 4 envelope it lives inside.
    expect(boundingBox(L_SHAPE)).toEqual({ width: 4, length: 4 });
  });

  it("is all zeros for an empty footprint", () => {
    expect(boundingBox([])).toEqual({ width: 0, length: 0 });
  });
});
