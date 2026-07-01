// Issue #879 / #862 — the pure drawing rules behind the footprint canvas: M4.
//
// PRD story 8: each new wall snaps to a right angle and a clean foot, and a tap
// back near the first corner closes the loop. That logic is pure and lives here,
// away from Fabric, so it is unit-testable in one spot; the canvas layer only
// renders the points these functions return (mirrors the photo annotator's
// pure-core / thin-Fabric split).
//
// S4 (#862) grows this from #879's snap-and-close start into the full M4 module
// the PRD asks for by adding `mergeCollinear` — the clean-up rule that folds a
// straightened run of corners back into one wall. The complementary *editing*
// operations a user drives after drawing (drag a corner, delete a wall, type an
// exact length) are their own pure module, `footprint-edit.ts`.

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

/**
 * The perpendicular distance, in feet, of corner `b` from the straight line
 * through its neighbours `a` and `c` — how far the corner bulges off the wall it
 * sits on. Zero means the three corners are dead collinear. A degenerate base
 * (`a` and `c` coincide) makes `b` a spur off a single point, which reads as a
 * zero-distance (removable) fold.
 */
function cornerDeviation(a: Point, b: Point, c: Point): number {
  const base = Math.hypot(c.x - a.x, c.y - a.y);
  if (base === 0) return 0;
  // |cross product| = twice the triangle area = base × height, so height (the
  // perpendicular deviation) is the cross magnitude over the base length.
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(cross) / base;
}

/**
 * M4's collinear merge: fold any corner that no longer bends the footprint back
 * into its wall. After a corner is dragged (or a wall deleted) onto the straight
 * line through its neighbours, the two segments meeting there are really one
 * wall — MagicPlan collapses the seam, and so do we, so the measurement engine
 * and shared-wall assembly (#865) never see a phantom zero-turn corner.
 *
 * A corner is dropped when its perpendicular deviation from the line through its
 * two neighbours is within `tolerance` feet (default: effectively exact, for the
 * axis-aligned corners `snapWall` produces). The loop is closed, so the check
 * wraps — the first and last corners are folded on the same rule. A footprint of
 * fewer than four corners is returned untouched: three corners are the smallest
 * real Room, so there is nothing redundant to remove.
 */
export function mergeCollinear(
  points: Point[],
  tolerance = 1e-9,
): Point[] {
  const result = points.map((p) => ({ x: p.x, y: p.y }));

  // Re-scan from the top after every removal: dropping one corner can leave its
  // neighbours newly collinear (a whole straightened run collapses this way).
  // Stop at three corners — the smallest polygon — so we never strand an edge.
  let i = 0;
  while (result.length > 3 && i < result.length) {
    const prev = result[(i - 1 + result.length) % result.length];
    const curr = result[i];
    const next = result[(i + 1) % result.length];
    if (cornerDeviation(prev, curr, next) <= tolerance) {
      result.splice(i, 1);
      i = 0; // a removal shifts indices; restart the scan
    } else {
      i++;
    }
  }
  return result;
}
