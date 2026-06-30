// Issue #879 — Sketch S2, the pure drawing rules behind the footprint canvas.
//
// PRD story 8: as the user taps corners, each new wall snaps to a right angle
// (0/90/180/270°) and its length rounds to clean feet, and tapping back near the
// first corner closes the loop. That decision logic is pure and lives here so it
// is unit-testable away from Fabric; the canvas layer only renders what these
// functions return (mirrors the photo annotator's pure-core / thin-Fabric split).

import { describe, expect, it } from "vitest";

import { type Point } from "./footprint";
import { shouldClosePolygon, snapWall } from "./footprint-draw";

describe("snapWall", () => {
  it("snaps a mostly-horizontal drag to a level wall and rounds it to clean feet", () => {
    // The drag is mostly along x, so the wall goes horizontal: the y wobble is
    // flattened to the previous corner's y, and the 3.2 ft run rounds to 3.
    expect(snapWall({ x: 0, y: 0 }, { x: 3.2, y: 0.4 })).toEqual({ x: 3, y: 0 });
  });

  it("snaps a mostly-vertical drag to a plumb wall and rounds it to clean feet", () => {
    expect(snapWall({ x: 0, y: 0 }, { x: 0.4, y: 3.2 })).toEqual({ x: 0, y: 3 });
  });

  it("rounds a wall length up to the nearest whole foot", () => {
    expect(snapWall({ x: 0, y: 0 }, { x: 2.6, y: 0.1 })).toEqual({ x: 3, y: 0 });
  });

  it("keeps the wall direction when the drag runs back toward the origin", () => {
    // Drawing leftward/downward must stay leftward/downward, not flip: a −2.6 ft
    // run rounds to −3 and the plumb axis is pinned to the previous corner.
    expect(snapWall({ x: 5, y: 5 }, { x: 2.4, y: 4.8 })).toEqual({ x: 2, y: 5 });
  });

  it("holds the cross-axis exactly equal to the previous corner (a true right angle)", () => {
    const prev: Point = { x: 7, y: 2 };
    const snapped = snapWall(prev, { x: 7.3, y: 9.9 });
    // Vertical wall: x is pinned to prev.x to the bit, so the corner is square.
    expect(snapped.x).toBe(prev.x);
  });
});

describe("shouldClosePolygon", () => {
  const TRIANGLE: Point[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
  ];

  it("closes the loop when a tap lands within the threshold of the first corner", () => {
    expect(shouldClosePolygon(TRIANGLE, { x: 0.3, y: 0.2 }, 0.5)).toBe(true);
  });

  it("does not close when the tap is well away from the first corner", () => {
    expect(shouldClosePolygon(TRIANGLE, { x: 2, y: 2 }, 0.5)).toBe(false);
  });

  it("will not close a footprint that has fewer than three corners", () => {
    // Two corners is a single wall, not an enclosable Room — tapping the start
    // again must keep drawing, not collapse to a degenerate shape.
    const oneWall: Point[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
    expect(shouldClosePolygon(oneWall, { x: 0.1, y: 0.1 }, 0.5)).toBe(false);
  });

  it("treats a tap exactly on the threshold as closing", () => {
    expect(shouldClosePolygon(TRIANGLE, { x: 0.5, y: 0 }, 0.5)).toBe(true);
  });
});
