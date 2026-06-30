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
  fabricViewportTransform,
  DOUBLE_TAP_SCALE,
  ZOOM_STEP,
  type Transform,
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

describe("fabricViewportTransform — a Transform as Fabric's scene→screen matrix", () => {
  // The annotator's canvas IS its viewport: a 1000×800 fit-scaled Photo, so the
  // scene plane already fills the viewport at scale 1 (fitScale === 1).
  const W = 1000;
  const H = 800;
  const square: ViewportContext = {
    imageW: W,
    imageH: H,
    viewportW: W,
    viewportH: H,
  };
  // Fabric maps a scene point (x, y) to screen with [a, b, c, d, e, f]:
  //   screenX = a·x + c·y + e ;  screenY = b·x + d·y + f
  const toScreen = (
    m: ReturnType<typeof fabricViewportTransform>,
    x: number,
    y: number,
  ) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

  it("is the identity matrix at FIT (no magnification, no shift)", () => {
    expect(fabricViewportTransform(FIT, W, H)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("scales about the viewport centre — the centre pixel stays put", () => {
    const m = fabricViewportTransform(
      { scale: 3, offsetX: 0, offsetY: 0 },
      W,
      H,
    );
    expect(m[0]).toBe(3);
    expect(m[3]).toBe(3);
    expect(toScreen(m, W / 2, H / 2)).toEqual({ x: W / 2, y: H / 2 });
  });

  it("keeps the content under the focal fixed — a zoomAbout round-trips", () => {
    // At FIT the matrix is the identity, so the scene point under an off-centre
    // focal IS the focal itself. After zooming about that focal via the shared
    // model, the matrix must map that same scene point back onto the focal —
    // this is exactly the property AC3 (precise placement while zoomed) needs.
    const focal = { x: 250, y: 600 };
    const zoomed = zoomAbout(FIT, 4, focal, square);
    const moved = toScreen(fabricViewportTransform(zoomed, W, H), focal.x, focal.y);
    expect(moved.x).toBeCloseTo(focal.x);
    expect(moved.y).toBeCloseTo(focal.y);
  });

  it("folds the pan offset straight into the translation terms", () => {
    const t: Transform = { scale: 2, offsetX: 40, offsetY: -25 };
    const m = fabricViewportTransform(t, W, H);
    expect(m[4]).toBe((1 - 2) * (W / 2) + 40);
    expect(m[5]).toBe((1 - 2) * (H / 2) - 25);
  });

  it("inverts to recover the Photo point under a screen coordinate, zoomed AND panned", () => {
    // The placement guarantee (AC3): Fabric inverts this same matrix in
    // getScenePoint to turn a pointer's on-screen position into the
    // underlying-Photo coordinate a new Annotation (or a dragged Arrow handle)
    // lands on. Model that inverse for a view that is both magnified and panned
    // — the case where a naive screen==scene assumption would mis-place markup.
    const t: Transform = { scale: 2.5, offsetX: 60, offsetY: -40 };
    const m = fabricViewportTransform(t, W, H);
    // Affine inverse for this shear-free matrix (b === c === 0): undo the
    // translation, then the scale.
    const toScene = (sx: number, sy: number) => ({
      x: (sx - m[4]) / m[0],
      y: (sy - m[5]) / m[3],
    });

    // A click at the viewport centre maps to whatever scene point the centred
    // zoom parked there: the image centre shifted by the (descaled) pan offset.
    const atCentre = toScene(W / 2, H / 2);
    expect(atCentre.x).toBeCloseTo(W / 2 - t.offsetX / t.scale);
    expect(atCentre.y).toBeCloseTo(H / 2 - t.offsetY / t.scale);

    // And the projection is a true round-trip: any scene point pushed to screen
    // inverts back to itself, so placement is exact wherever the user taps.
    const scene = { x: 321, y: 477 };
    const screen = toScreen(m, scene.x, scene.y);
    const back = toScene(screen.x, screen.y);
    expect(back.x).toBeCloseTo(scene.x);
    expect(back.y).toBeCloseTo(scene.y);
  });
});
