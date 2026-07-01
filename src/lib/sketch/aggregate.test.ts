// Issue #865 — Sketch S5, M2: the Floor / Sketch measurement aggregator.
//
// M2 is the pure roll-up between a Floor's Rooms (M1) and the Statistics panel /
// the Floor-or-Sketch-scoped Estimate pull. A Floor's totals sum its Rooms; a
// Sketch's totals sum its Floors (CONTEXT.md "Floor": a Floor's totals aggregate
// its Rooms; ADR 0025 — one parametric spine). Keeping it a pure module means the
// "how big is this level / whole plan" rule is unit-testable in one spot, reused
// identically by the panel and the pull feed.

import { describe, expect, it } from "vitest";

import { aggregateFloor, aggregateSketch } from "./aggregate";
import { measureRoom } from "./measure-room";

describe("aggregateFloor", () => {
  it("sums its Rooms' measurements and counts the Rooms (Floor totals)", () => {
    // Two distinct Rooms so a dropped or double-counted term can't hide: a 3×4
    // Room (floor 12, perimeter 14, gross wall 112, volume 96) and a 5×6 Room
    // (floor 30, perimeter 22, gross wall 176, volume 240), both at 8′.
    const floor = aggregateFloor([
      { measurements: measureRoom({ width: 3, length: 4, ceilingHeight: 8 }) },
      { measurements: measureRoom({ width: 5, length: 6, ceilingHeight: 8 }) },
    ]);

    expect(floor.measurements.floorArea).toBe(42); // 12 + 30
    expect(floor.measurements.ceilingArea).toBe(42);
    expect(floor.measurements.perimeter).toBe(36); // 14 + 22
    expect(floor.measurements.grossWallArea).toBe(288); // 112 + 176
    expect(floor.measurements.netWallArea).toBe(288);
    expect(floor.measurements.volume).toBe(336); // 96 + 240

    // Counts: two Rooms on the Floor; openings aren't modeled yet, so doors and
    // windows are 0 until they exist (the S5 acceptance criteria say exactly so).
    expect(floor.counts.rooms).toBe(2);
    expect(floor.counts.doors).toBe(0);
    expect(floor.counts.windows).toBe(0);
  });
});

describe("aggregateSketch", () => {
  it("sums its Floors' totals into whole-Sketch totals", () => {
    // A two-Floor Sketch: Ground Floor with one 3×4 Room (floor 12, volume 96),
    // a Basement with one 5×6 Room (floor 30, volume 240). The Sketch total is
    // the sum of the Floor totals, which are the sum of their Rooms.
    const ground = aggregateFloor([
      { measurements: measureRoom({ width: 3, length: 4, ceilingHeight: 8 }) },
    ]);
    const basement = aggregateFloor([
      { measurements: measureRoom({ width: 5, length: 6, ceilingHeight: 8 }) },
    ]);

    const sketch = aggregateSketch([ground, basement]);

    expect(sketch.measurements.floorArea).toBe(42); // 12 + 30
    expect(sketch.measurements.volume).toBe(336); // 96 + 240
    expect(sketch.counts.rooms).toBe(2); // one Room on each Floor
  });

  it("includes a detached-structure Floor in the Sketch totals", () => {
    // A detached garage is modeled as its own Floor, not a second Sketch
    // (CONTEXT.md "Floor"). Passing it to aggregateSketch must fold it into the
    // whole-plan total exactly like an attached Floor — nothing special-cases it.
    const house = aggregateFloor([
      { measurements: measureRoom({ width: 10, length: 10, ceilingHeight: 8 }) },
    ]);
    const detachedGarage = aggregateFloor([
      { measurements: measureRoom({ width: 20, length: 20, ceilingHeight: 8 }) },
    ]);

    const withGarage = aggregateSketch([house, detachedGarage]);
    const houseOnly = aggregateSketch([house]);

    expect(houseOnly.measurements.floorArea).toBe(100);
    // The garage's 400 sq ft is in the total — it is not dropped as "detached".
    expect(withGarage.measurements.floorArea).toBe(500);
    expect(withGarage.counts.rooms).toBe(2);
  });
});

describe("empty scopes", () => {
  it("reports zeros for a Floor with no Rooms", () => {
    // An empty Floor (just added, no Rooms drawn yet) totals to zeros, never NaN
    // or undefined — the Statistics panel shows 0, and a Sketch summing it is
    // unaffected (S5 acceptance criteria: empty Floor → zeros).
    const floor = aggregateFloor([]);

    expect(floor.measurements.floorArea).toBe(0);
    expect(floor.measurements.volume).toBe(0);
    expect(floor.counts.rooms).toBe(0);
    expect(floor.counts.doors).toBe(0);
    expect(floor.counts.windows).toBe(0);
  });

  it("reports zeros for a Sketch with no Floors", () => {
    const sketch = aggregateSketch([]);

    expect(sketch.measurements.floorArea).toBe(0);
    expect(sketch.counts.rooms).toBe(0);
  });
});

describe("opening counts", () => {
  it("sums per-Room door and window counts through the Floor and Sketch", () => {
    // Openings aren't modeled yet, so real Rooms carry 0 — but the aggregator's
    // contract is to sum them when they exist, so a Floor's counts roll up to the
    // Sketch. Locks that path now so wiring openings later needs no aggregator
    // change. Distinct door/window totals so neither can be read for the other.
    const floor = aggregateFloor([
      { measurements: measureRoom({ width: 3, length: 4, ceilingHeight: 8 }), doors: 1, windows: 2 },
      { measurements: measureRoom({ width: 5, length: 6, ceilingHeight: 8 }), doors: 2, windows: 3 },
    ]);
    expect(floor.counts.doors).toBe(3); // 1 + 2
    expect(floor.counts.windows).toBe(5); // 2 + 3

    const sketch = aggregateSketch([floor, floor]);
    expect(sketch.counts.doors).toBe(6); // the Floor twice
    expect(sketch.counts.windows).toBe(10);
    expect(sketch.counts.rooms).toBe(4);
  });
});
