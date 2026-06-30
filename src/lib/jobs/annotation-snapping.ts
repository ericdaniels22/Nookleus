// Issue #818 — the pure snapping & alignment-guide engine for the photo
// annotator (Module 6 of PRD #804).
//
// Given the Annotation being dragged, the other Annotations on the canvas, and
// per-axis snap thresholds, this decides whether the dragged object should
// nudge into alignment and which transient guide lines to draw. It is a pure
// function — no Fabric, canvas, or DOM dependencies — so the same input always
// yields the same result and it can be exercised in isolation (see the
// accompanying vitest). The caller (photo-annotator.tsx) feeds in axis-aligned
// bounding boxes and applies the returned position as a plain translation,
// which is why the engine never needs to know an object's origin convention.

/** An Annotation's axis-aligned bounding box, in canvas pixels. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Maximum distance, per axis, at which a candidate alignment snaps. */
export interface SnapThresholds {
  x: number;
  y: number;
}

/**
 * A transient alignment guide. A "vertical" guide is a full-height line at
 * x=`position`; a "horizontal" guide is a full-width line at y=`position`.
 */
export interface GuideLine {
  orientation: "vertical" | "horizontal";
  position: number;
}

export interface SnapResult {
  snappedPosition: { left: number; top: number };
  guideLines: GuideLine[];
}

/** The three vertical reference lines of a rect: left edge, center, right edge. */
function xRefs(r: Rect): number[] {
  return [r.left, r.left + r.width / 2, r.left + r.width];
}

/** The three horizontal reference lines of a rect: top edge, center, bottom edge. */
function yRefs(r: Rect): number[] {
  return [r.top, r.top + r.height / 2, r.top + r.height];
}

/**
 * The single closest alignment along one axis: the smallest signed shift that
 * brings one of the moving object's reference lines onto one of an other
 * object's reference lines, considering only matches within `threshold`.
 * `delta` is how far to nudge the moving object; `line` is the coordinate the
 * aligned reference lines share (where the guide is drawn). Null when nothing
 * is close enough. Ties resolve to the first candidate seen, so the result is
 * deterministic for a given input ordering.
 */
function closestAlignment(
  movingRefs: number[],
  others: Rect[],
  refsOf: (r: Rect) => number[],
  threshold: number,
): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null;
  for (const other of others) {
    for (const otherRef of refsOf(other)) {
      for (const movingRef of movingRefs) {
        const delta = otherRef - movingRef;
        if (
          Math.abs(delta) <= threshold &&
          (best === null || Math.abs(delta) < Math.abs(best.delta))
        ) {
          best = { delta, line: otherRef };
        }
      }
    }
  }
  return best;
}

export function snapAnnotation(
  moving: Rect,
  others: Rect[],
  thresholds: SnapThresholds,
): SnapResult {
  // The two axes are resolved independently, so an object can snap (and show a
  // guide) on one, both, or neither.
  const bestX = closestAlignment(xRefs(moving), others, xRefs, thresholds.x);
  const bestY = closestAlignment(yRefs(moving), others, yRefs, thresholds.y);

  const guideLines: GuideLine[] = [];
  if (bestX) guideLines.push({ orientation: "vertical", position: bestX.line });
  if (bestY) guideLines.push({ orientation: "horizontal", position: bestY.line });

  return {
    snappedPosition: {
      left: moving.left + (bestX ? bestX.delta : 0),
      top: moving.top + (bestY ? bestY.delta : 0),
    },
    guideLines,
  };
}
