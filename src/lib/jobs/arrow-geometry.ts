// Issue #809 / #849 — the one pure place that computes an Arrow's tip and tail.
// `createArrow` maps a tap point plus the Photo's dimensions onto a
// standard-size, up-and-to-the-right (↗) Arrow centered on the tap; `dragTip`
// and `dragTail` recompute the endpoints when one handle is dragged, clamping
// the dragged endpoint to a minimum tip-to-tail distance so a drag can never
// collapse the Arrow to zero length. Kept free of Fabric/DOM/React so the
// geometry lives in exactly one tested place — the annotator's tap-to-drop
// handler calls `createArrow` and its tip/tail handle handlers call `dragTip` /
// `dragTail` directly (no duplicated inline endpoint math).

export interface Point {
  x: number;
  y: number;
}

export interface PhotoDimensions {
  width: number;
  height: number;
}

export interface ArrowEndpoints {
  /** The arrowhead end — by default to the right of and above the tail. */
  tip: Point;
  /** The anchored end. */
  tail: Point;
}

/**
 * A standard Arrow's tip-to-tail length as a fraction of the Photo's diagonal.
 * Chosen so the dropped Arrow occupies a consistent slice of the image whether
 * the Photo is small or large.
 */
export const STANDARD_ARROW_LENGTH_FRACTION = 0.2;

/** The standard Arrow length for a Photo of the given dimensions. */
export function standardArrowLength(photo: PhotoDimensions): number {
  return (
    Math.hypot(photo.width, photo.height) * STANDARD_ARROW_LENGTH_FRACTION
  );
}

/**
 * Drop a standard ↗ Arrow centered on `tapPoint`, sized to the Photo so it
 * reads the same relative size on a small or a large Photo.
 */
export function createArrow(
  tapPoint: Point,
  photo: PhotoDimensions
): ArrowEndpoints {
  // Half the length projected onto a 45° diagonal: tip gains x and loses y.
  const offset = standardArrowLength(photo) / 2 / Math.SQRT2;
  return {
    tip: { x: tapPoint.x + offset, y: tapPoint.y - offset },
    tail: { x: tapPoint.x - offset, y: tapPoint.y + offset },
  };
}

/**
 * The shortest tip-to-tail distance a drag may produce, in the Photo's
 * coordinate space. Small enough never to fight a deliberately short Arrow, but
 * non-zero so dragging one handle onto the other can't collapse the shaft into
 * a degenerate, headless dot (#809's "impossible to produce a zero-length or
 * malformed Arrow" — #849).
 */
export const MIN_ARROW_LENGTH = 12;

/**
 * Keep `moving` at least `minLength` away from the anchored `anchor`. If the
 * dragged point lands closer than that, push it back out to exactly `minLength`
 * along the Arrow's existing axis (anchor → the endpoint's pre-drag position),
 * so a collapsed drag keeps the shaft's current orientation instead of snapping
 * to an arbitrary one.
 */
function clampOutToMinLength(
  anchor: Point,
  axisRef: Point,
  moving: Point,
  minLength: number
): Point {
  if (Math.hypot(moving.x - anchor.x, moving.y - anchor.y) >= minLength) {
    return moving;
  }
  const axisLen = Math.hypot(axisRef.x - anchor.x, axisRef.y - anchor.y);
  // The production Arrow is never zero-length (createArrow seeds a standard
  // length and this clamp keeps it ≥ minLength), so axisLen > 0; guard the
  // division anyway so a degenerate input degrades to a horizontal nudge.
  if (axisLen === 0) return { x: anchor.x + minLength, y: anchor.y };
  const scale = minLength / axisLen;
  return {
    x: anchor.x + (axisRef.x - anchor.x) * scale,
    y: anchor.y + (axisRef.y - anchor.y) * scale,
  };
}

/** Reposition only the tip; the tail stays anchored. */
export function dragTip(
  arrow: ArrowEndpoints,
  newTip: Point,
  minLength: number = MIN_ARROW_LENGTH
): ArrowEndpoints {
  return {
    tip: clampOutToMinLength(arrow.tail, arrow.tip, newTip, minLength),
    tail: arrow.tail,
  };
}

/** Reposition only the tail; the tip stays anchored. */
export function dragTail(
  arrow: ArrowEndpoints,
  newTail: Point,
  minLength: number = MIN_ARROW_LENGTH
): ArrowEndpoints {
  return {
    tip: arrow.tip,
    tail: clampOutToMinLength(arrow.tip, arrow.tail, newTail, minLength),
  };
}
