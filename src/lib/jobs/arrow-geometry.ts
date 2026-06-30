// Issue #809 — the one pure place that computes a tap-dropped Arrow's tip and
// tail. `createArrow` maps a tap point plus the Photo's dimensions onto a
// standard-size, up-and-to-the-right (↗) Arrow centered on the tap; `dragTip`
// and `dragTail` recompute the endpoints when one handle is dragged. Kept free
// of Fabric/DOM/React so the geometry lives in exactly one tested place — the
// annotator's tap-to-drop and tip/tail handlers read these.

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

/** Reposition only the tip; the tail stays anchored. */
export function dragTip(arrow: ArrowEndpoints, newTip: Point): ArrowEndpoints {
  return { tip: newTip, tail: arrow.tail };
}

/** Reposition only the tail; the tip stays anchored. */
export function dragTail(
  arrow: ArrowEndpoints,
  newTail: Point
): ArrowEndpoints {
  return { tip: arrow.tip, tail: newTail };
}
