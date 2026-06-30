// Issue #516 — the pure zoom/pan math behind the full-screen Photo viewer.
//
// The viewer shows a Photo `object-contain` (centered, letterboxed on black).
// This module layers a magnification on top of that fit baseline and answers
// every gesture — pinch, scroll, ＋－, drag-pan, double-tap — as a clamped
// {@link Transform}. It never touches the DOM or canvas: the component reads
// pointer/touch/wheel events, calls in here, and writes the result out as a CSS
// `translate(...) scale(...)`. Keeping the math here means the tricky parts —
// edge-clamped panning and zoom-about-a-point — are verified without rendering.

/** The fixed pixel sizes the transform math reasons about. */
export interface ViewportContext {
  /** Natural pixel size of the source image. */
  imageW: number;
  imageH: number;
  /** Pixel size of the surface the image is shown on. */
  viewportW: number;
  viewportH: number;
}

/**
 * A zoom/pan state, applied on top of the `object-contain` fit.
 *
 * `scale` is relative to fit: `1` is the letterboxed baseline and the math
 * never goes below it. `offsetX/offsetY` translate the image **centre** away
 * from the viewport centre, in viewport pixels; at fit the image is centred so
 * both are `0`. This maps straight to CSS `translate(offsetX, offsetY)
 * scale(scale)` with a centred transform-origin.
 */
export interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Fit can't be zoomed out past; this is the floor for {@link clampScale}. */
export const MIN_SCALE = 1;
/** The magnification ceiling — deep enough to inspect a detail (#516). */
export const MAX_SCALE = 8;
/** Where a double-tap / double-click jumps to from fit. */
export const DOUBLE_TAP_SCALE = 2;
/** The factor one press of the ＋ (or − as its reciprocal) button applies. */
export const ZOOM_STEP = 1.5;

/** The centred, unzoomed baseline: the Photo at `object-contain` fit. */
export const FIT: Transform = { scale: MIN_SCALE, offsetX: 0, offsetY: 0 };

/** Clamp a desired scale into the allowed `[MIN_SCALE, MAX_SCALE]` range. */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The `object-contain` fit factor: image pixels → on-screen pixels at fit.
 *
 * The image is shrunk until it fits inside the viewport, so the limiting
 * dimension is whichever axis is relatively larger. Multiplying the image size
 * by this gives the letterboxed display size at `scale === 1`.
 */
function fitScale(ctx: ViewportContext): number {
  return Math.min(ctx.viewportW / ctx.imageW, ctx.viewportH / ctx.imageH);
}

/** Per-axis cap on how far the image centre may shift away from centre. */
export interface PanBounds {
  maxOffsetX: number;
  maxOffsetY: number;
}

/**
 * How far the image centre may travel, per axis, before a black gap would open
 * at an edge.
 *
 * The displayed image is `imageSize × fitScale × scale`. Whatever it overflows
 * the viewport by can be split evenly to either side, so the centre may move by
 * half the overflow. An axis that still fits within the viewport (overflow ≤ 0)
 * stays pinned at the centre.
 */
export function panBounds(scale: number, ctx: ViewportContext): PanBounds {
  const fit = fitScale(ctx);
  const dispW = ctx.imageW * fit * scale;
  const dispH = ctx.imageH * fit * scale;
  return {
    maxOffsetX: Math.max(0, (dispW - ctx.viewportW) / 2),
    maxOffsetY: Math.max(0, (dispH - ctx.viewportH) / 2),
  };
}

const clamp = (v: number, limit: number): number => {
  const c = Math.min(limit, Math.max(-limit, v));
  // Normalise -0 → 0 so offsets stay canonical (and never leak `-0px` into a
  // style string or surprise an equality check).
  return c === 0 ? 0 : c;
};

/**
 * Pull a transform's offsets back inside the pan bounds for its scale.
 *
 * Used both directly (after a drag) and as the final step of every zoom, so a
 * gesture can never leave the image showing a gap. A dimension whose bound is
 * `0` (still letterboxed) collapses to centred.
 */
export function clampOffset(t: Transform, ctx: ViewportContext): Transform {
  const { maxOffsetX, maxOffsetY } = panBounds(t.scale, ctx);
  return {
    scale: t.scale,
    offsetX: clamp(t.offsetX, maxOffsetX),
    offsetY: clamp(t.offsetY, maxOffsetY),
  };
}

/** Drag the image by `(dx, dy)` viewport pixels, clamped to its edges. */
export function pan(
  t: Transform,
  dx: number,
  dy: number,
  ctx: ViewportContext,
): Transform {
  return clampOffset(
    { scale: t.scale, offsetX: t.offsetX + dx, offsetY: t.offsetY + dy },
    ctx,
  );
}

/** A point on the viewport surface, in viewport pixels from its top-left. */
export interface Focal {
  x: number;
  y: number;
}

/**
 * Zoom to `targetScale` about a focal point, keeping the image content under
 * that point fixed on screen.
 *
 * This is the heart of pinch / scroll / double-tap: whatever pixel sits under
 * your fingers (or cursor) should stay under them as the image grows. Working
 * in viewport coordinates measured from the centre, the on-screen position of a
 * content point is `offset + scale · u`, so holding the focal point fixed gives
 * `offset' = (1 − r)·focal + r·offset`, where `r = scale'/scale`. The scale is
 * clamped first and the offset clamped after, so a zoom can neither exceed the
 * limits nor pan past an edge.
 */
export function zoomAbout(
  t: Transform,
  targetScale: number,
  focal: Focal,
  ctx: ViewportContext,
): Transform {
  const scale = clampScale(targetScale);
  const r = scale / t.scale;
  const fx = focal.x - ctx.viewportW / 2;
  const fy = focal.y - ctx.viewportH / 2;
  return clampOffset(
    {
      scale,
      offsetX: (1 - r) * fx + r * t.offsetX,
      offsetY: (1 - r) * fy + r * t.offsetY,
    },
    ctx,
  );
}

/**
 * Toggle between fit and zoomed on a double-tap / double-click.
 *
 * From fit it jumps to {@link DOUBLE_TAP_SCALE} about the tapped point (so the
 * detail you tapped lands in view); from any zoomed state it snaps straight
 * back to centred fit, regardless of where the tap landed.
 */
export function doubleTap(
  t: Transform,
  focal: Focal,
  ctx: ViewportContext,
): Transform {
  if (t.scale > MIN_SCALE) return FIT;
  return zoomAbout(t, DOUBLE_TAP_SCALE, focal, ctx);
}

/**
 * Zoom by a relative `factor` about a focal point.
 *
 * The natural verb for the continuous gestures: a scroll wheel turns its delta
 * into a factor just above/below 1, a pinch into the ratio of finger distances,
 * and the ＋/－ buttons into {@link ZOOM_STEP} (or its reciprocal). Multiplying
 * keeps each step proportional, so zooming feels even across the range.
 */
export function zoomBy(
  t: Transform,
  factor: number,
  focal: Focal,
  ctx: ViewportContext,
): Transform {
  return zoomAbout(t, t.scale * factor, focal, ctx);
}

/** The 6-element affine matrix `[a, b, c, d, e, f]` Fabric maps scene→screen
 *  with: `screenX = a·x + c·y + e`, `screenY = b·x + d·y + f`. */
export type FabricViewportMatrix = [
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Render a {@link Transform} as a Fabric canvas viewport transform (issue #814).
 *
 * The Photo viewer writes its transform out as a CSS `translate(...) scale(...)`;
 * the annotator instead drives a Fabric canvas, where the background Photo and
 * every Annotation share one scene plane. Feeding this matrix to
 * `canvas.setViewportTransform` magnifies that whole scene about the viewport
 * centre — and, because Fabric inverts the same matrix in `getScenePoint`,
 * every placement/hit-test keeps landing on the correct underlying-Photo point
 * while zoomed (no per-tool coordinate math needed).
 *
 * This assumes the annotator's fit baseline: the scene already fills the
 * viewport at `scale === 1` (the canvas is sized to the fit-scaled Photo), so
 * the only magnification is `Transform.scale`. Holding the viewport centre fixed
 * under a centred zoom, a scene point `u` lands at `scale·u + (1 − scale)·W/2`,
 * shifted by the pan offset — exactly the `a`/`e` (and `d`/`f`) below.
 */
export function fabricViewportTransform(
  t: Transform,
  viewportW: number,
  viewportH: number,
): FabricViewportMatrix {
  return [
    t.scale,
    0,
    0,
    t.scale,
    (1 - t.scale) * (viewportW / 2) + t.offsetX,
    (1 - t.scale) * (viewportH / 2) + t.offsetY,
  ];
}
