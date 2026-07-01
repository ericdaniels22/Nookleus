// Issue #879 — Sketch S2, the pure drawing rules behind the footprint canvas.
//
// PRD story 8: each new wall snaps to a right angle and a clean foot, and a tap
// back near the first corner closes the loop. That logic is pure and lives here,
// away from Fabric, so it is unit-testable in one spot; the canvas layer only
// renders the points these functions return (mirrors the photo annotator's
// pure-core / thin-Fabric split). Per-wall exact-length editing and corner
// dragging are deferred to S3.

import { type Point } from "./footprint";

/**
 * Snap a freshly-tapped corner so the wall from `prev` is axis-aligned (a right
 * angle off the previous wall) and a whole number of feet long. The dominant
 * drag axis wins — a mostly-horizontal drag becomes a level wall, a
 * mostly-vertical one a plumb wall — and the cross-axis is pinned exactly to
 * `prev`, so adjacent walls always meet square. A 45° tie resolves to horizontal.
 */
export function snapWall(prev: Point, raw: Point): Point {
  const dx = raw.x - prev.x;
  const dy = raw.y - prev.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Level wall: round the run to whole feet, hold y at the previous corner.
    return { x: prev.x + Math.round(dx), y: prev.y };
  }
  // Plumb wall: round the rise to whole feet, hold x at the previous corner.
  return { x: prev.x, y: prev.y + Math.round(dy) };
}

/**
 * Whether a tap should close the footprint rather than add another corner —
 * true when at least three corners exist (an enclosable Room) and the tap lands
 * within `threshold` feet of the first corner. The boundary counts as closing.
 */
export function shouldClosePolygon(
  points: Point[],
  candidate: Point,
  threshold: number,
): boolean {
  if (points.length < 3) return false;

  const first = points[0];
  const distance = Math.hypot(candidate.x - first.x, candidate.y - first.y);
  return distance <= threshold;
}
