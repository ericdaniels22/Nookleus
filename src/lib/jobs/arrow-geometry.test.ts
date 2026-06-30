import { describe, it, expect } from "vitest";

import {
  createArrow,
  dragTip,
  dragTail,
  MIN_ARROW_LENGTH,
} from "./arrow-geometry";

const length = ({ tip, tail }: ReturnType<typeof createArrow>) =>
  Math.hypot(tip.x - tail.x, tip.y - tail.y);

describe("createArrow", () => {
  it("centers the Arrow on the tapped point", () => {
    const tap = { x: 400, y: 300 };

    const { tip, tail } = createArrow(tap, { width: 1000, height: 800 });

    expect((tip.x + tail.x) / 2).toBeCloseTo(tap.x);
    expect((tip.y + tail.y) / 2).toBeCloseTo(tap.y);
  });

  it("points up-and-to-the-right by default (tip has greater x, smaller y than tail)", () => {
    const { tip, tail } = createArrow(
      { x: 400, y: 300 },
      { width: 1000, height: 800 }
    );

    expect(tip.x).toBeGreaterThan(tail.x);
    expect(tip.y).toBeLessThan(tail.y);
  });

  it("scales the Arrow length proportionally to the Photo's dimensions", () => {
    const tap = { x: 100, y: 100 };
    const small = length(createArrow(tap, { width: 500, height: 400 }));
    const large = length(createArrow(tap, { width: 1000, height: 800 }));

    // Doubling both Photo dimensions doubles the Arrow's length.
    expect(large).toBeCloseTo(small * 2);
  });

  it("derives length from the Photo size, not a fixed pixel constant", () => {
    const tap = { x: 100, y: 100 };
    const tiny = length(createArrow(tap, { width: 200, height: 150 }));
    const huge = length(createArrow(tap, { width: 4000, height: 3000 }));

    expect(huge).toBeGreaterThan(tiny);
  });
});

describe("dragTip", () => {
  it("moves the tip to the new point and leaves the tail anchored", () => {
    const arrow = createArrow({ x: 400, y: 300 }, { width: 1000, height: 800 });
    const tailBefore = { ...arrow.tail };

    const moved = dragTip(arrow, { x: 700, y: 120 });

    expect(moved.tip).toEqual({ x: 700, y: 120 });
    expect(moved.tail).toEqual(tailBefore);
  });

  it("clamps a tip dragged onto the tail out to the minimum length along the existing axis", () => {
    const arrow = createArrow({ x: 400, y: 300 }, { width: 1000, height: 800 });
    const axisBefore = {
      x: arrow.tip.x - arrow.tail.x,
      y: arrow.tip.y - arrow.tail.y,
    };

    // Drop the tip exactly onto the tail — naively a zero-length Arrow.
    const moved = dragTip(arrow, { ...arrow.tail }, 50);

    expect(moved.tail).toEqual(arrow.tail); // tail stays anchored
    expect(length(moved)).toBeCloseTo(50); // pushed out to the minimum
    // Pushed out ALONG the existing axis: colinear and same direction (outward).
    const axisAfter = {
      x: moved.tip.x - moved.tail.x,
      y: moved.tip.y - moved.tail.y,
    };
    expect(axisBefore.x * axisAfter.y - axisBefore.y * axisAfter.x).toBeCloseTo(
      0
    );
    expect(axisBefore.x * axisAfter.x + axisBefore.y * axisAfter.y).toBeGreaterThan(
      0
    );
  });

  it("defaults the clamp to MIN_ARROW_LENGTH so the production drag can't go degenerate", () => {
    const arrow = createArrow({ x: 400, y: 300 }, { width: 1000, height: 800 });

    // No explicit minimum — this is how the annotator's tip handler calls it.
    const moved = dragTip(arrow, { ...arrow.tail });

    expect(length(moved)).toBeCloseTo(MIN_ARROW_LENGTH);
  });
});

describe("dragTail", () => {
  it("moves the tail to the new point and leaves the tip anchored", () => {
    const arrow = createArrow({ x: 400, y: 300 }, { width: 1000, height: 800 });
    const tipBefore = { ...arrow.tip };

    const moved = dragTail(arrow, { x: 150, y: 560 });

    expect(moved.tail).toEqual({ x: 150, y: 560 });
    expect(moved.tip).toEqual(tipBefore);
  });

  it("clamps a tail dragged onto the tip out to the minimum length along the existing axis", () => {
    const arrow = createArrow({ x: 400, y: 300 }, { width: 1000, height: 800 });
    // Axis measured tail → tip; the clamped tail must stay on this line, behind
    // the tip (opposite the tip direction).
    const axisBefore = {
      x: arrow.tip.x - arrow.tail.x,
      y: arrow.tip.y - arrow.tail.y,
    };

    const moved = dragTail(arrow, { ...arrow.tip }, 50);

    expect(moved.tip).toEqual(arrow.tip); // tip stays anchored
    expect(length(moved)).toBeCloseTo(50); // pushed out to the minimum
    const axisAfter = {
      x: moved.tip.x - moved.tail.x,
      y: moved.tip.y - moved.tail.y,
    };
    expect(axisBefore.x * axisAfter.y - axisBefore.y * axisAfter.x).toBeCloseTo(
      0
    );
    expect(axisBefore.x * axisAfter.x + axisBefore.y * axisAfter.y).toBeGreaterThan(
      0
    );
  });

  it("defaults the clamp to MIN_ARROW_LENGTH so the production drag can't go degenerate", () => {
    const arrow = createArrow({ x: 400, y: 300 }, { width: 1000, height: 800 });

    const moved = dragTail(arrow, { ...arrow.tip });

    expect(length(moved)).toBeCloseTo(MIN_ARROW_LENGTH);
  });
});
