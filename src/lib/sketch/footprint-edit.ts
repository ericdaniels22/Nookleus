// Issue #862 — Sketch S4, the pure footprint-editing operations.
//
// Once a Room's footprint is drawn (#879's tracer, or the M4 snap rules in
// footprint-draw.ts), the user reworks it: drag a corner, delete a wall or a
// corner, or type a wall's exact length. Each edit is a pure Point[] → Point[]
// transform, kept here away from Fabric so the "what does this edit do to the
// shape" rule is unit-testable in one spot; the canvas layer just renders the
// corners these return and the measurement engine (M1, `measureFootprint`)
// recomputes off them live. This mirrors the pure-core / thin-Fabric split the
// drawing rules already use, and keeps the actual editor UI — which lands on the
// full-screen plan-editor shell (#890) — a thin renderer over tested geometry.

import { type Point } from "./footprint";

/** A fresh, fully decoupled copy of a footprint — every edit returns one so a
 * caller's array is never mutated in place. */
function clonePoints(points: Point[]): Point[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

/** Guard a corner index against the footprint, naming the operation that failed. */
function assertVertexIndex(op: string, points: Point[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= points.length) {
    throw new RangeError(
      `${op}: corner index ${index} is out of range for a ${points.length}-corner footprint`,
    );
  }
}

/** Guard a wall index. A closed footprint has one wall per corner (the last
 * closes the loop), so the valid range mirrors the corner count. */
function assertWallIndex(op: string, points: Point[], wallIndex: number): void {
  if (
    !Number.isInteger(wallIndex) ||
    wallIndex < 0 ||
    wallIndex >= points.length
  ) {
    throw new RangeError(
      `${op}: wall index ${wallIndex} is out of range for a ${points.length}-wall footprint`,
    );
  }
}

/**
 * Drag a single corner to a new spot, leaving every other corner where it was —
 * the grab-and-drag edit. Returns a fresh footprint; the two walls meeting at
 * the moved corner follow it, and the measurement engine recomputes off the
 * result. Throws if the corner index is not a real corner of this footprint.
 */
export function moveVertex(points: Point[], index: number, to: Point): Point[] {
  assertVertexIndex("moveVertex", points, index);

  const next = clonePoints(points);
  next[index] = { x: to.x, y: to.y };
  return next;
}

/**
 * Delete a corner. The two walls that met there join into one running straight
 * between its former neighbours (n corners → n − 1). Returns a fresh footprint;
 * deleting past three corners is allowed and simply reads as a degenerate,
 * zero-area Room downstream (M1 returns zeros, never NaN), the same way a
 * half-drawn footprint does. Throws if the corner index is not real.
 */
export function deleteVertex(points: Point[], index: number): Point[] {
  assertVertexIndex("deleteVertex", points, index);

  return clonePoints(points.filter((_, i) => i !== index));
}

/**
 * Delete a wall. Its two end corners pull together to the wall's midpoint, so
 * the neighbouring walls join there and the loop stays closed (n corners →
 * n − 1). Walls are indexed like the corners they start at, and wall n − 1 is
 * the closing edge from the last corner back to the first. Throws for a wall
 * index that is not real, or a footprint of fewer than three corners — which has
 * no enclosed loop of walls to collapse.
 */
export function deleteWall(points: Point[], wallIndex: number): Point[] {
  const n = points.length;
  if (n < 3) {
    throw new RangeError(
      `deleteWall: a ${n}-corner footprint is not a closed Room with walls to delete`,
    );
  }
  assertWallIndex("deleteWall", points, wallIndex);

  const a = points[wallIndex];
  const b = points[(wallIndex + 1) % n];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  // The closing wall (last → first) drops both the first and last corner and
  // seats the midpoint at the front; every other wall splices its midpoint in
  // where its two end corners were.
  const next =
    wallIndex === n - 1
      ? [mid, ...points.slice(1, n - 1)]
      : [...points.slice(0, wallIndex), mid, ...points.slice(wallIndex + 2)];

  return clonePoints(next);
}

/**
 * Type a wall's exact length off the tape measure. The wall's start corner is
 * the anchor; its far corner slides in or out along the *current* wall
 * direction until the wall is exactly `targetLength` feet — the length changes,
 * the bearing does not, so a slanted wall stays slanted rather than snapping to
 * an axis. Walls are indexed by their start corner, and wall n − 1 closes the
 * loop, so its far corner is the first one. Throws for a negative length, a wall
 * with no direction to set a length along (its two corners coincide), or a wall
 * index that is not real.
 */
export function setWallLength(
  points: Point[],
  wallIndex: number,
  targetLength: number,
): Point[] {
  const n = points.length;
  assertWallIndex("setWallLength", points, wallIndex);
  if (targetLength < 0) {
    throw new RangeError(
      `setWallLength: length must be non-negative (got ${targetLength})`,
    );
  }

  const farIndex = (wallIndex + 1) % n;
  const anchor = points[wallIndex];
  const far = points[farIndex];
  const currentLength = Math.hypot(far.x - anchor.x, far.y - anchor.y);
  if (currentLength === 0) {
    throw new RangeError(
      "setWallLength: a zero-length wall has no direction to set a length along",
    );
  }

  const scale = targetLength / currentLength;
  const next = clonePoints(points);
  next[farIndex] = {
    x: anchor.x + (far.x - anchor.x) * scale,
    y: anchor.y + (far.y - anchor.y) * scale,
  };
  return next;
}
