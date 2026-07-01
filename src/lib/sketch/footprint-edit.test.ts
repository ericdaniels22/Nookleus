// Issue #862 — Sketch S4, the pure footprint-editing operations.
//
// After a Room is drawn, the user reworks it: drag a corner to a new spot,
// delete a wall or a corner, or type a wall's exact length off the tape measure.
// Each is a pure Point[] → Point[] transform living here, away from the canvas,
// so the "what does this edit do to the shape" rule is unit-tested in one spot
// and the measurement engine (M1, `measureFootprint`) recomputes off the result
// — the same pure-core / thin-Fabric split the drawing rules (M4) already use.

import { describe, expect, it } from "vitest";

import { type Point } from "./footprint";
import { mergeCollinear } from "./footprint-draw";
import {
  deleteVertex,
  deleteWall,
  moveVertex,
  setWallLength,
} from "./footprint-edit";
import { measureFootprint } from "./measure-room";

const SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

describe("moveVertex", () => {
  it("drags one corner to a new spot and leaves the rest of the shape put", () => {
    // Pull the top-right corner out to (6,5); the other three corners are
    // untouched, turning the square into an irregular quadrilateral.
    expect(moveVertex(SQUARE, 2, { x: 6, y: 5 })).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 6, y: 5 },
      { x: 0, y: 4 },
    ]);
  });

  it("does not mutate the caller's footprint", () => {
    const original: Point[] = SQUARE.map((p) => ({ ...p }));
    moveVertex(SQUARE, 0, { x: 9, y: 9 });
    expect(SQUARE).toEqual(original);
  });

  it("rejects a corner index outside the footprint", () => {
    expect(() => moveVertex(SQUARE, 4, { x: 0, y: 0 })).toThrow(RangeError);
    expect(() => moveVertex(SQUARE, -1, { x: 0, y: 0 })).toThrow(RangeError);
  });
});

describe("deleteVertex", () => {
  it("removes a corner so its two walls join into one", () => {
    // Drop the top-right corner of the square: the top and right walls merge
    // into a single wall from (4,0) straight to (0,4), leaving a triangle.
    expect(deleteVertex(SQUARE, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ]);
  });

  it("rejects a corner index outside the footprint", () => {
    expect(() => deleteVertex(SQUARE, 4)).toThrow(RangeError);
    expect(() => deleteVertex(SQUARE, -1)).toThrow(RangeError);
  });
});

describe("deleteWall", () => {
  it("collapses a wall to its midpoint, joining its two neighbouring walls", () => {
    // Delete the bottom wall (0,0)→(4,0): its ends pull together to the wall's
    // midpoint (2,0), and the square becomes a triangle.
    expect(deleteWall(SQUARE, 0)).toEqual([
      { x: 2, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
  });

  it("collapses the closing wall that runs from the last corner back to the first", () => {
    // Wall 3 is the closing edge (0,4)→(0,0); its midpoint is (0,2).
    expect(deleteWall(SQUARE, 3)).toEqual([
      { x: 0, y: 2 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]);
  });

  it("rejects a wall index outside the footprint", () => {
    expect(() => deleteWall(SQUARE, 4)).toThrow(RangeError);
    expect(() => deleteWall(SQUARE, -1)).toThrow(RangeError);
  });

  it("rejects deleting a wall from a footprint that is not a closed Room", () => {
    // Fewer than three corners has no enclosed loop of walls to collapse.
    expect(() => deleteWall([{ x: 0, y: 0 }, { x: 4, y: 0 }], 0)).toThrow(
      RangeError,
    );
  });
});

describe("setWallLength", () => {
  it("sets a wall to an exact length by sliding its far corner along the wall", () => {
    // Shorten the bottom wall from 4 ft to 3 ft: the anchor (0,0) holds and the
    // far corner slides in along the wall to (3,0) — the tape-measure edit.
    expect(setWallLength(SQUARE, 0, 3)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
  });

  it("keeps a slanted wall's direction, only its length changes", () => {
    // A 3-4-5 wall stretched to 10 ft stays pointed the same way (6,8), not
    // re-snapped to an axis — the exact-length edit scales, it does not rotate.
    const slanted: Point[] = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ];
    expect(setWallLength(slanted, 0, 10)).toEqual([
      { x: 0, y: 0 },
      { x: 6, y: 8 },
      { x: 0, y: 4 },
    ]);
  });

  it("sets the length of the closing wall by moving the first corner", () => {
    // Wall 3 is the closing edge (0,4)→(0,0); its far corner is the first one.
    // Setting it to 2 ft slides that corner from (0,0) up to (0,2).
    expect(setWallLength(SQUARE, 3, 2)).toEqual([
      { x: 0, y: 2 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]);
  });

  it("rejects a negative length", () => {
    expect(() => setWallLength(SQUARE, 0, -3)).toThrow(RangeError);
  });

  it("rejects setting the length of a zero-length wall — it has no direction", () => {
    const collapsed: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 4, y: 4 },
    ];
    expect(() => setWallLength(collapsed, 0, 3)).toThrow(RangeError);
  });

  it("rejects a wall index outside the footprint", () => {
    expect(() => setWallLength(SQUARE, 4, 3)).toThrow(RangeError);
  });
});

describe("live recomputation through M1", () => {
  it("feeds an edited footprint straight into the measurement engine", () => {
    // The whole point of keeping edits pure: resize a wall, hand the result to
    // M1, and the Room's numbers move with it — no bespoke recompute path.
    const before = measureFootprint({ footprint: SQUARE, ceilingHeight: 8 });
    expect(before.floorArea).toBe(16); // 4 × 4

    // Pull the right wall from 4 ft to 2 ft, making a trapezoid.
    const resized = setWallLength(SQUARE, 1, 2);
    const after = measureFootprint({ footprint: resized, ceilingHeight: 8 });

    expect(after.floorArea).toBe(12); // shoelace of (0,0)(4,0)(4,2)(0,4)
    expect(after.volume).toBe(96); // 12 × 8
  });

  it("folds a collinear seam without changing the Room's measured size", () => {
    // M4's merge is a tidy-up, not a reshape: dropping a mid-wall seam leaves
    // the floor area (and every derived number) exactly where it was.
    const seamed: Point[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 }, // redundant seam on the bottom wall
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const folded = mergeCollinear(seamed);
    expect(folded).toHaveLength(4);

    const seamedArea = measureFootprint({
      footprint: seamed,
      ceilingHeight: 8,
    }).floorArea;
    const foldedArea = measureFootprint({
      footprint: folded,
      ceilingHeight: 8,
    }).floorArea;
    expect(foldedArea).toBe(seamedArea);
  });
});
