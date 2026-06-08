// Issue #516 — the pure zoom/pan math behind the full-screen Photo viewer.
//
// The viewer lets the user magnify a Photo (pinch / scroll / ＋－), pan around
// when zoomed, and double-tap to snap between fit and zoomed. All of that
// transform math — scale clamping, panning kept within the image edges,
// zoom-about-a-point, and the double-tap toggle — lives here, free of React,
// the DOM, and canvas, so it can be verified without rendering. The component
// is the thin shell that wires pointer/touch/wheel events to these functions
// and writes the result out as a CSS transform.

import { describe, it, expect } from "vitest";
import {
  FIT,
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  panBounds,
  clampOffset,
  pan,
  zoomAbout,
  doubleTap,
  zoomBy,
  DOUBLE_TAP_SCALE,
  ZOOM_STEP,
  type ViewportContext,
} from "./photo-zoom-transform";

// Viewport centre of the 1000×800 fixture — what the ＋/－ buttons zoom about.
const centre = { x: 500, y: 400 };

// On-screen position (relative to viewport centre, one axis) of the image
// content coordinate `u`, under offset/scale. Zoom-about-a-point means: the `u`
// that sat under the focal point before the zoom sits under it after, too.
const screenOf = (u: number, offset: number, scale: number) => offset + scale * u;

// A landscape viewport with a landscape image that fits wider than tall.
const ctx: ViewportContext = {
  imageW: 4000,
  imageH: 3000,
  viewportW: 1000,
  viewportH: 800,
};

describe("clampScale — never below fit, never past the max", () => {
  it("leaves a scale within range untouched", () => {
    expect(clampScale(2)).toBe(2);
    expect(clampScale(4.5)).toBe(4.5);
  });

  it("clamps below fit up to MIN_SCALE (you can't pinch out smaller than fit)", () => {
    expect(clampScale(0.5)).toBe(MIN_SCALE);
    expect(MIN_SCALE).toBe(1);
  });

  it("clamps past the ceiling down to MAX_SCALE", () => {
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(MAX_SCALE).toBe(8);
  });

  it("FIT is the centered, unzoomed baseline", () => {
    expect(FIT).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

// At fit, fitW = 1000 (= viewportW, spans full width) and fitH = 750 (< 800,
// letterboxed). So the image fills the width but is shorter than the viewport.
describe("panBounds — how far the centre may travel before an edge gaps", () => {
  it("allows no panning at fit (the image is centred, nothing overflows)", () => {
    expect(panBounds(1, ctx)).toEqual({ maxOffsetX: 0, maxOffsetY: 0 });
  });

  it("allows panning by half the overflow once zoomed past fit", () => {
    // scale 2: displayed 2000×1500 over a 1000×800 viewport.
    // overflow 1000×700 → half is 500×350.
    expect(panBounds(2, ctx)).toEqual({ maxOffsetX: 500, maxOffsetY: 350 });
  });

  it("keeps a dimension centred while it still fits, even as the other pans", () => {
    // scale 1.05: width 1050 overflows by 50 (→ 25), height 787.5 still under
    // 800 → that axis stays pinned at 0.
    expect(panBounds(1.05, ctx)).toEqual({ maxOffsetX: 25, maxOffsetY: 0 });
  });
});

describe("pan — drag the image, but never past its edges", () => {
  it("does nothing at fit: the image is pinned to centre", () => {
    expect(pan(FIT, 120, -90, ctx)).toEqual(FIT);
  });

  it("moves freely while the drag stays within bounds", () => {
    // scale 2 → bounds 500×350; this drag lands well inside them.
    const t = { scale: 2, offsetX: 0, offsetY: 0 };
    expect(pan(t, -200, -100, ctx)).toEqual({
      scale: 2,
      offsetX: -200,
      offsetY: -100,
    });
  });

  it("clamps a drag that would pull an edge into view", () => {
    const t = { scale: 2, offsetX: 0, offsetY: 0 };
    // Overshoot both axes; clamps to ±(500, 350).
    expect(pan(t, -9999, 9999, ctx)).toEqual({
      scale: 2,
      offsetX: -500,
      offsetY: 350,
    });
  });

  it("clampOffset pulls an out-of-bounds transform back to its edge", () => {
    expect(clampOffset({ scale: 2, offsetX: 800, offsetY: -800 }, ctx)).toEqual({
      scale: 2,
      offsetX: 500,
      offsetY: -350,
    });
  });
});

// Viewport centre is (500, 400) for the 1000×800 fixture.
describe("zoomAbout — magnify around a point, keeping it fixed", () => {
  it("zooming about the centre keeps the image centred", () => {
    expect(zoomAbout(FIT, 2, { x: 500, y: 400 }, ctx)).toEqual({
      scale: 2,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("zooming about an off-centre point shifts so that point stays put", () => {
    // Focal 200px right of centre. Result derived: offsetX = (1−r)·fx = −200.
    const result = zoomAbout(FIT, 2, { x: 700, y: 400 }, ctx);
    expect(result).toEqual({ scale: 2, offsetX: -200, offsetY: 0 });

    // The content under the focal before the zoom is still under it after.
    const fx = 700 - 500;
    const uUnderFocal = (fx - FIT.offsetX) / FIT.scale;
    expect(screenOf(uUnderFocal, result.offsetX, result.scale)).toBeCloseTo(fx);
  });

  it("clamps the scale to the ceiling and stays put about the centre", () => {
    expect(zoomAbout(FIT, 99, { x: 500, y: 400 }, ctx)).toEqual({
      scale: 8,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("clamps the resulting offset so a corner zoom can't gap an edge", () => {
    // Zoom about the bottom-right corner: the raw shift (−500, −400) exceeds
    // the y-bound (±350), so it clamps there.
    expect(zoomAbout(FIT, 2, { x: 1000, y: 800 }, ctx)).toEqual({
      scale: 2,
      offsetX: -500,
      offsetY: -350,
    });
  });
});

describe("doubleTap — snap between fit and zoomed", () => {
  it("jumps from fit to the double-tap scale about the tapped point", () => {
    expect(DOUBLE_TAP_SCALE).toBe(2);
    // Same effect as zooming to 2× about that off-centre point.
    expect(doubleTap(FIT, { x: 700, y: 400 }, ctx)).toEqual({
      scale: 2,
      offsetX: -200,
      offsetY: 0,
    });
  });

  it("snaps any zoomed state back to fit, ignoring the tap point", () => {
    const zoomed = { scale: 4, offsetX: 300, offsetY: -120 };
    expect(doubleTap(zoomed, { x: 50, y: 750 }, ctx)).toEqual(FIT);
  });
});

describe("zoomBy — a relative factor (wheel / pinch / ＋－)", () => {
  it("multiplies the current scale about the focal point", () => {
    expect(zoomBy({ scale: 2, offsetX: 0, offsetY: 0 }, 1.5, centre, ctx)).toEqual({
      scale: 3,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("clamps at the ceiling instead of overshooting", () => {
    expect(zoomBy({ scale: 6, offsetX: 0, offsetY: 0 }, 4, centre, ctx)).toEqual({
      scale: 8,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("a ＋ step then a − step returns to the starting scale", () => {
    expect(ZOOM_STEP).toBeGreaterThan(1);
    const inOnce = zoomBy(FIT, ZOOM_STEP, centre, ctx);
    expect(inOnce.scale).toBeGreaterThan(1);
    const backOut = zoomBy(inOnce, 1 / ZOOM_STEP, centre, ctx);
    expect(backOut.scale).toBeCloseTo(1);
  });
});
