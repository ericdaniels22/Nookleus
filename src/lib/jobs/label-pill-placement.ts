// Issue #846 — the dimension-aware companion to the pure `label-pill` module.
// `label-pill` knows where a pill hangs relative to its host but nothing about
// the canvas it is drawn on; this module takes that anchor plus the canvas
// bounds and decides the pill's final on-canvas rectangle so an edge Annotation's
// Label isn't clipped. Kept free of Fabric/React/DOM so the edge math lives in
// one tested place.

/** A Label pill's measured size, in canvas pixels. */
export interface PillSize {
  width: number;
  height: number;
}

/** The canvas (fit-photo) bounds a pill must stay within, in canvas pixels. */
export interface CanvasBounds {
  width: number;
  height: number;
}

/** A point in canvas coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** Clamp `value` into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * The on-canvas top-left for a Label pill so it stays fully visible. The pill is
 * axis-aligned. It prefers to hang below its host with its top-centre at
 * `belowAnchor`; if hanging below would push the pill past the bottom of the
 * canvas it flips to hang above the host, with its bottom-centre at
 * `aboveAnchor`. Either way the resulting rectangle is clamped on both axes so
 * the whole pill stays within the canvas — a Label on an edge Annotation reads
 * fully in the editor and in the flattened Annotated Photo (#846).
 */
export function placeLabelPill(
  belowAnchor: Point,
  aboveAnchor: Point,
  pill: PillSize,
  canvas: CanvasBounds
): Point {
  const flip = belowAnchor.y + pill.height > canvas.height;
  const centerX = flip ? aboveAnchor.x : belowAnchor.x;
  const top = flip ? aboveAnchor.y - pill.height : belowAnchor.y;
  const left = clamp(centerX - pill.width / 2, 0, canvas.width - pill.width);
  const clampedTop = clamp(top, 0, canvas.height - pill.height);
  return { x: left, y: clampedTop };
}
