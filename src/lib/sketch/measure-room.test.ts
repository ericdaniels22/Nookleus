// Issue #860 — Sketch surface + first rectangular Room (tracer bullet).
//
// M1, the Room measurement calculator, is the single pure place that turns a
// Room's footprint + ceiling height into the area/length/volume quantities an
// Estimate later pulls from (CONTEXT.md "Room"; ADR 0024 §"wall area
// (perimeter × height, less openings), perimeter, and volume"). Keeping it a
// pure module means the "how big is this space" rule is unit-testable in one
// spot instead of smeared across the API route and the builder UI.

import { describe, expect, it } from "vitest";

import { rectangleFootprint, type Point } from "./footprint";
import { measureFootprint, measureRoom } from "./measure-room";

describe("measureRoom", () => {
  it("derives every measurement of a 3 × 4 rectangular Room at 8′ ceiling", () => {
    // Distinct width/length/height so a wrong formula can't accidentally land
    // on the right number: floor 12, perimeter 14, gross wall 112, volume 96
    // are all different.
    const m = measureRoom({ width: 3, length: 4, ceilingHeight: 8 });

    expect(m.floorArea).toBe(12); // w · l
    expect(m.ceilingArea).toBe(12); // w · l (no openings in the ceiling yet)
    expect(m.perimeter).toBe(14); // 2 · (w + l)
    expect(m.grossWallArea).toBe(112); // perimeter · h
    expect(m.netWallArea).toBe(112); // gross − openings; no openings → net == gross
    expect(m.volume).toBe(96); // w · l · h
  });

  it("treats the unit cube as the identity case", () => {
    // 1 × 1 × 1 pins the two equalities the model relies on: a flat ceiling
    // has the same area as the floor, and with no openings the net wall area
    // is the gross wall area.
    const m = measureRoom({ width: 1, length: 1, ceilingHeight: 1 });

    expect(m.floorArea).toBe(1);
    expect(m.ceilingArea).toBe(1);
    expect(m.ceilingArea).toBe(m.floorArea);
    expect(m.perimeter).toBe(4);
    expect(m.grossWallArea).toBe(4);
    expect(m.netWallArea).toBe(m.grossWallArea);
    expect(m.volume).toBe(1);
  });

  it("scales only wall area and volume when the ceiling height changes", () => {
    // A Room can override its Floor's default ceiling height. Raising the
    // ceiling must change wall area and volume but leave the footprint-derived
    // measurements — floor area, ceiling area, perimeter — untouched.
    const footprint = { width: 3, length: 4 };
    const low = measureRoom({ ...footprint, ceilingHeight: 8 });
    const high = measureRoom({ ...footprint, ceilingHeight: 10 });

    // Footprint-only measurements are invariant to ceiling height.
    expect(high.floorArea).toBe(low.floorArea);
    expect(high.ceilingArea).toBe(low.ceilingArea);
    expect(high.perimeter).toBe(low.perimeter);

    // Wall area and volume scale linearly with height (8 → 10 = ×1.25).
    expect(high.grossWallArea).toBe(140); // 14 · 10
    expect(high.netWallArea).toBe(140);
    expect(high.volume).toBe(120); // 12 · 10
    expect(high.grossWallArea).toBeCloseTo(low.grossWallArea * 1.25);
    expect(high.volume).toBeCloseTo(low.volume * 1.25);
  });

  it("returns zeros — never NaN — for a fully degenerate Room", () => {
    // A half-drawn Room (a point) must read as all zeros, not NaN, so the
    // builder can show a live 0 while the user is still dragging out a shape.
    const m = measureRoom({ width: 0, length: 0, ceilingHeight: 0 });

    for (const value of Object.values(m)) {
      expect(Number.isNaN(value)).toBe(false);
      expect(value).toBe(0);
    }
  });

  it("zeroes the size measurements when one footprint dimension is zero", () => {
    // A zero-width "slit" has no area and no volume, but the implementation
    // must still produce finite numbers for the others rather than NaN.
    const m = measureRoom({ width: 0, length: 4, ceilingHeight: 8 });

    expect(m.floorArea).toBe(0);
    expect(m.ceilingArea).toBe(0);
    expect(m.volume).toBe(0);
    for (const value of Object.values(m)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("rejects negative dimensions instead of returning nonsense measurements", () => {
    // Negative width/length/height is never a real Room; surface it as an
    // error at the calculator boundary rather than letting a negative area
    // flow downstream into an Estimate quantity.
    expect(() => measureRoom({ width: -3, length: 4, ceilingHeight: 8 })).toThrow();
    expect(() => measureRoom({ width: 3, length: -4, ceilingHeight: 8 })).toThrow();
    expect(() => measureRoom({ width: 3, length: 4, ceilingHeight: -8 })).toThrow();
  });
});

describe("measureFootprint", () => {
  // S2 generalizes M1 from a width × length rectangle to an arbitrary polygon
  // footprint. The rectangle is now one shape among many, so the same six
  // quantities must fall out of the shoelace/perimeter formulas (CONTEXT.md
  // "Room"; ADR 0024). An L-shaped Room: a 4×4 square missing a 2×2 top-right
  // bite — area 12, perimeter 16, all corners right-angled.
  const L_SHAPE: Point[] = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 4 },
    { x: 0, y: 4 },
  ];

  it("reproduces the rectangle case exactly — a rectangle is just 4 points", () => {
    // The generalized engine must not move a single #860 number: the 3 × 4 × 8
    // rectangle still reads floor 12, perimeter 14, gross wall 112, volume 96.
    const m = measureFootprint({
      footprint: rectangleFootprint(3, 4),
      ceilingHeight: 8,
    });

    expect(m.floorArea).toBe(12);
    expect(m.ceilingArea).toBe(12);
    expect(m.perimeter).toBe(14);
    expect(m.grossWallArea).toBe(112);
    expect(m.netWallArea).toBe(112);
    expect(m.volume).toBe(96);
  });

  it("measures an arbitrary L-shaped Room the rectangle model could not", () => {
    const m = measureFootprint({ footprint: L_SHAPE, ceilingHeight: 8 });

    expect(m.floorArea).toBe(12); // shoelace: 4×4 − 2×2
    expect(m.ceilingArea).toBe(12);
    expect(m.perimeter).toBe(16); // 4 + 2 + 2 + 2 + 2 + 4
    expect(m.grossWallArea).toBe(128); // 16 · 8
    expect(m.netWallArea).toBe(128);
    expect(m.volume).toBe(96); // 12 · 8
  });

  it("scales only wall area and volume when the ceiling height changes", () => {
    // Overriding a Room's ceiling height moves wall area and volume but leaves
    // the footprint-derived floor/ceiling area and perimeter untouched.
    const low = measureFootprint({ footprint: L_SHAPE, ceilingHeight: 8 });
    const high = measureFootprint({ footprint: L_SHAPE, ceilingHeight: 10 });

    expect(high.floorArea).toBe(low.floorArea);
    expect(high.ceilingArea).toBe(low.ceilingArea);
    expect(high.perimeter).toBe(low.perimeter);

    expect(high.grossWallArea).toBe(160); // 16 · 10
    expect(high.volume).toBe(120); // 12 · 10
  });

  it("deducts door and window areas from net wall area (one door + one window)", () => {
    // #866 — the money case: openings cut into the walls so net < gross. A 3 × 4
    // Room at 8′ has gross wall 14 · 8 = 112. A 3 × 7 door (21 sq ft) and a 2 × 4
    // window (8 sq ft) are placed on its walls, so net = 112 − 21 − 8 = 83. Only
    // net wall area moves — floor/ceiling/perimeter/gross/volume are
    // opening-invariant (ADR 0024: wall area is perimeter × height, less openings).
    const m = measureFootprint({
      footprint: rectangleFootprint(3, 4),
      ceilingHeight: 8,
      openings: [
        { type: "door", width: 3, height: 7 },
        { type: "window", width: 2, height: 4 },
      ],
    });

    expect(m.grossWallArea).toBe(112); // perimeter · h, before openings
    expect(m.netWallArea).toBe(83); // 112 − 21 − 8

    // Everything else is untouched by openings.
    expect(m.floorArea).toBe(12);
    expect(m.ceilingArea).toBe(12);
    expect(m.perimeter).toBe(14);
    expect(m.volume).toBe(96);
  });

  it("rejects a negative opening dimension instead of inflating net wall area", () => {
    // A negative width/height would be SUBTRACTED as a negative — pushing net
    // above gross and sending a bogus, oversized wall quantity downstream into
    // an Estimate. Reject it at the boundary, like the other dimension guards.
    expect(() =>
      measureFootprint({
        footprint: rectangleFootprint(3, 4),
        ceilingHeight: 8,
        openings: [{ type: "window", width: -2, height: 4 }],
      }),
    ).toThrow();
    expect(() =>
      measureFootprint({
        footprint: rectangleFootprint(3, 4),
        ceilingHeight: 8,
        openings: [{ type: "door", width: 3, height: -7 }],
      }),
    ).toThrow();
  });

  it("returns zeros — never NaN — for a degenerate footprint of under three points", () => {
    // A half-drawn Room (no corners, one corner, a single wall) reads as all
    // zeros so the live readout shows 0 while the user is still tapping corners.
    for (const footprint of [[], [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 3, y: 0 }]]) {
      const m = measureFootprint({ footprint, ceilingHeight: 8 });
      for (const value of Object.values(m)) {
        expect(Number.isNaN(value)).toBe(false);
        expect(value).toBe(0);
      }
    }
  });

  it("rejects a negative ceiling height at the calculator boundary", () => {
    expect(() =>
      measureFootprint({ footprint: L_SHAPE, ceilingHeight: -8 }),
    ).toThrow();
  });
});
