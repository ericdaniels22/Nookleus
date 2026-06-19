import { describe, it, expect } from "vitest";

import { ringGeometry } from "./ring-geometry";

// #717 — the pure ring-geometry helper: a collection rate (0..1, possibly over
// 1) maps to the SVG stroke-dash values for a hand-rolled arc. No charting dep.
describe("ringGeometry", () => {
  it("draws an empty ring at a 0% rate", () => {
    const g = ringGeometry(0);

    expect(g.percent).toBe(0);
    expect(g.fraction).toBe(0);
    // nothing revealed — the offset hides the entire circumference
    expect(g.dashOffset).toBeCloseTo(g.circumference, 6);
  });

  it("reveals half the circle at a 50% rate", () => {
    const g = ringGeometry(0.5);

    expect(g.percent).toBe(50);
    expect(g.fraction).toBe(0.5);
    // dashArray is the whole circle; offset hides the unfilled remainder, so a
    // half-filled ring offsets by half the circumference.
    expect(g.dashOffset).toBeCloseTo(g.circumference / 2, 6);
  });

  it("fills the whole circle at a 100% rate", () => {
    const g = ringGeometry(1);

    expect(g.percent).toBe(100);
    expect(g.fraction).toBe(1);
    expect(g.dashOffset).toBeCloseTo(0, 6);
  });

  it("clamps an over-collected (>100%) rate to a full ring, never overflowing", () => {
    const g = ringGeometry(1.5);

    expect(g.percent).toBe(100);
    expect(g.fraction).toBe(1); // not 1.5
    expect(g.dashOffset).toBeCloseTo(0, 6); // a full ring, no negative offset
  });
});
