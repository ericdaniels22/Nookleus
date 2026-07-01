// Issue #879 — Sketch S2, the pure drawing rules behind the footprint canvas.
//
// PRD story 8: as the user taps corners, each new wall snaps to a right angle
// (0/90/180/270°) and its length rounds to clean feet, and tapping back near the
// first corner closes the loop. That decision logic is pure and lives here so it
// is unit-testable away from Fabric; the canvas layer only renders what these
// functions return (mirrors the photo annotator's pure-core / thin-Fabric split).

import { describe, expect, it } from "vitest";

import { rectangleFootprint, type Point } from "./footprint";
import {
  mergeCollinear,
  shouldClosePolygon,
  snapToSharedWalls,
  snapWall,
} from "./footprint-draw";

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

describe("mergeCollinear", () => {
  it("drops a redundant corner sitting mid-wall on a straight run", () => {
    // A square with an extra corner planted halfway along its top wall. That
    // corner adds no shape — the wall is dead straight through it — so M4 folds
    // the two collinear segments back into the single 4-corner square.
    const withSeam: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 }, // seam mid-wall between (0,0) and (4,0)
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(mergeCollinear(withSeam)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
  });

  it("keeps every real corner of an L-shape — a right-angle turn is not a seam", () => {
    // The L has six genuine corners; none lies on the line through its
    // neighbours, so M4 must leave the shape exactly as drawn.
    const lShape: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(mergeCollinear(lShape)).toEqual(lShape);
  });

  it("folds a seam that wraps across the first corner", () => {
    // The redundant corner is at index 0, so folding it exercises the closed
    // loop's wrap: its neighbours are the last corner and the second corner.
    const wrapped: Point[] = [
      { x: 2, y: 0 }, // collinear between (0,0) [last] and (4,0)
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 0, y: 0 },
    ];
    expect(mergeCollinear(wrapped)).toEqual([
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 0, y: 0 },
    ]);
  });

  it("collapses a whole straightened run back to the two wall ends", () => {
    // Three interior corners planted along one wall all disappear — a removal
    // leaves the next corner newly collinear, so the scan re-runs to the end.
    const stitched: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(mergeCollinear(stitched)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
  });

  it("folds a corner only once it bulges within the tolerance", () => {
    // A corner 0.001 ft off the straight wall: kept at the default (near-exact)
    // tolerance, folded once the tolerance is opened past its deviation.
    const nearlyStraight: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0.001 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(mergeCollinear(nearlyStraight)).toHaveLength(5); // default: kept
    expect(mergeCollinear(nearlyStraight, 0.01)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
  });

  it("leaves a triangle — the smallest Room — untouched and unmutated", () => {
    const triangle: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ];
    expect(mergeCollinear(triangle)).toEqual(triangle);
    // Pure: the returned corners are a fresh array, not the caller's input.
    expect(mergeCollinear(triangle)).not.toBe(triangle);
  });
});

describe("snapToSharedWalls", () => {
  it("snaps a dragged Room's near-touching wall flush against a neighbour's", () => {
    // Room A is a 10×10 at the floor origin, so its right wall sits at x=10.
    // Room B (6×8) is dragged so its left wall lands at x=10.25 — a quarter foot
    // shy of A's right wall, inside the 0.5 ft threshold. Snapping nudges B's
    // origin left so the two walls coincide exactly: an adjoining shared wall.
    const roomA = { footprint: rectangleFootprint(10, 10), origin: { x: 0, y: 0 } };
    const roomB = { footprint: rectangleFootprint(6, 8), origin: { x: 10.25, y: 0 } };

    expect(snapToSharedWalls(roomB, [roomA], 0.5)).toEqual({ x: 10, y: 0 });
  });

  it("leaves the origin untouched when no wall is within the threshold", () => {
    // B's nearest wall to A is a foot and a half away — well outside the 0.5 ft
    // threshold — so nothing snaps and the dragged position stands as-is.
    const roomA = { footprint: rectangleFootprint(10, 10), origin: { x: 0, y: 0 } };
    const roomB = { footprint: rectangleFootprint(6, 8), origin: { x: 11.5, y: 3 } };

    expect(snapToSharedWalls(roomB, [roomA], 0.5)).toEqual({ x: 11.5, y: 3 });
  });

  it("snaps flush on both axes at once when dragged toward a corner", () => {
    // B is dragged near A's top-right corner: its left wall is a quarter foot
    // past A's right wall (x 10.25→10) and its top wall a quarter foot below A's
    // top (y 10.25→10). Both axes snap independently, landing B's corner exactly
    // on A's — the two Rooms meet at a shared corner.
    const roomA = { footprint: rectangleFootprint(10, 10), origin: { x: 0, y: 0 } };
    const roomB = { footprint: rectangleFootprint(6, 6), origin: { x: 10.25, y: 10.25 } };

    expect(snapToSharedWalls(roomB, [roomA], 0.5)).toEqual({ x: 10, y: 10 });
  });

  it("aligns parallel walls that line up, even when the Rooms don't touch", () => {
    // B sits well above A with no shared edge, but its left wall (x=0.25) is a
    // hair off A's left wall (x=0). Snapping aligns them to the same line so the
    // two Rooms stack flush — alignment, not just adjacency. The y is untouched:
    // no horizontal wall of A is anywhere near B's.
    const roomA = { footprint: rectangleFootprint(10, 10), origin: { x: 0, y: 0 } };
    const roomB = { footprint: rectangleFootprint(6, 6), origin: { x: 0.25, y: 40 } };

    expect(snapToSharedWalls(roomB, [roomA], 0.5)).toEqual({ x: 0, y: 40 });
  });

  it("snaps to the nearer of two candidate walls in range", () => {
    // B's left wall at x=9.8 is within 0.5 of both A's right wall (x=10, 0.2 off)
    // and A's inner wall (x=9.4, 0.4 off — an L-shaped A). The nearer one wins:
    // it snaps to x=10, not x=9.4.
    const lShapedA = {
      // A 10-wide footprint with a notch, giving vertical walls at x=0, 9.4, 10.
      footprint: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 9.4, y: 4 },
        { x: 9.4, y: 10 },
        { x: 0, y: 10 },
      ],
      origin: { x: 0, y: 0 },
    };
    const roomB = { footprint: rectangleFootprint(6, 6), origin: { x: 9.8, y: 0 } };

    expect(snapToSharedWalls(roomB, [lShapedA], 0.5).x).toBe(10);
  });

  it("returns the origin unchanged when there are no other Rooms to snap to", () => {
    // The first Room placed on a Floor has nothing to share a wall with.
    const roomB = { footprint: rectangleFootprint(6, 8), origin: { x: 3.25, y: 7.5 } };

    expect(snapToSharedWalls(roomB, [], 0.5)).toEqual({ x: 3.25, y: 7.5 });
  });
});
