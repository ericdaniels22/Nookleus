// Issue #879 — Sketch S2, the hand-drawn Room footprint geometry.
//
// A Room's footprint is an ordered list of corner points on a scaled grid
// (1 grid square = 1 ft); the walls are the edges between consecutive points on
// a closed loop (CONTEXT.md "Room"; ADR 0024). This is the pure geometry the
// measurement calculator (M1) and the drawing surface both build on — no Fabric,
// no I/O — so the "how big is this shape" rule lives in one unit-tested spot and
// generalizes #860's rectangle to any polygon (L-rooms, bays). A rectangle is
// just 4 points, so #860's numbers fall straight out of these formulas.

export interface Point {
  /** Distance along the grid's x-axis, in feet. */
  x: number;
  /** Distance along the grid's y-axis, in feet. */
  y: number;
}

/**
 * The four corners of a width × length rectangle, walked from the origin. The
 * bridge from #860's form to the polygon model: a rectangle is just 4 points,
 * so every measurement a rectangle produced is preserved.
 */
export function rectangleFootprint(width: number, length: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: length },
    { x: 0, y: length },
  ];
}

/**
 * Footprint area via the shoelace formula. Independent of winding direction
 * (the absolute value), and zero for a degenerate footprint of under three
 * points so a half-drawn Room reads as 0 rather than NaN.
 */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Footprint perimeter — the sum of every wall on the closed loop, including the
 * edge that closes the last corner back to the first. Zero for under three
 * points, where there is no enclosed loop to walk.
 */
export function polygonPerimeter(points: Point[]): number {
  if (points.length < 3) return 0;

  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * The axis-aligned envelope a footprint lives inside. Still feeds the legacy
 * width/length columns, so an L-shape reports the full rectangle it spans.
 */
export function boundingBox(points: Point[]): { width: number; length: number } {
  if (points.length === 0) return { width: 0, length: 0 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { width: maxX - minX, length: maxY - minY };
}
