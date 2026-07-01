// Issue #870 — Sketch S10, the pure extrusion that turns a parametric Room into
// a read-only 3D "dollhouse" mesh (M9).
//
// A Room is 2.5D: a footprint polygon + a ceiling height (ADR 0025). Standing
// that footprint up gives the dollhouse — a floor slab with walls rising to the
// ceiling, no roof, so an orbiting camera looks down into the room. Like
// footprint.ts this is pure geometry (no `three`, no I/O), so the extrusion rule
// lives in one unit-tested spot and the viewer (M10) is just a renderer of it.
//
// Convention: Y is the up-axis. A footprint point (x, y) maps to world
// (x, ·, y) with the ceiling height along +Y, so the viewer drops the plan
// straight in with no rotation. Walls follow ADR 0026's 2D choice — a
// centerline plane per footprint edge, not a thickness-aware solid (wall
// thickness is stored on the Floor but not yet given 3D volume).

import type { Floor, Room } from "../types";
import { type Point, translateFootprint } from "./footprint";

/** A triangle mesh ready to hand to a three.js BufferGeometry. */
export interface ExtrudedMesh {
  /** Flat vertex buffer [x, y, z, ...], 3 numbers per vertex, Y-up. */
  positions: number[];
  /** Flat triangle-index buffer, 3 indices per face. */
  indices: number[];
}

/**
 * Extrude a Room's footprint into its dollhouse mesh: one vertical wall quad per
 * edge of the closed loop, rising from the floor (y = 0) to `height`.
 */
export function extrudeRoom({
  footprint,
  height,
}: {
  footprint: Point[];
  height: number;
}): ExtrudedMesh {
  const positions: number[] = [];
  const indices: number[] = [];

  // A half-drawn Room (under three corners) encloses no shape — extrude nothing,
  // matching footprint.ts where such a polygon has zero area and perimeter.
  if (footprint.length < 3) return { positions, indices };

  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % footprint.length];
    const base = positions.length / 3;
    // The wall's four corners: the edge a→b at the floor, then b→a at the
    // ceiling — a quad split into two triangles.
    positions.push(
      a.x, 0, a.y,
      b.x, 0, b.y,
      b.x, height, b.y,
      a.x, height, a.y,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // The floor slab: the footprint laid flat at y = 0. Ear-clipping triangulates
  // any simple polygon — a rectangle falls out as two triangles, and concave
  // footprints (L-rooms, bays) are covered exactly, with no triangle spilling
  // past a reflex corner the way a naive fan would.
  const floorBase = positions.length / 3;
  for (const { x, y } of footprint) {
    positions.push(x, 0, y);
  }
  for (const [i, j, k] of triangulate(footprint)) {
    indices.push(floorBase + i, floorBase + j, floorBase + k);
  }

  return { positions, indices };
}

/** Twice the signed area of a polygon; positive when wound counter-clockwise. */
function signedArea2(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Is p inside triangle abc? (barycentric sign test, edges inclusive.) */
function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const cross = (u: Point, v: Point, w: Point) =>
    (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Triangulate a simple polygon by ear clipping, returning triangles as index
 * triples into `points`. Works on any non-self-intersecting footprint (convex
 * or concave); output triangles are wound counter-clockwise.
 */
function triangulate(points: Point[]): [number, number, number][] {
  const n = points.length;
  if (n < 3) return [];

  // Walk the ring counter-clockwise so ears test as convex the same way.
  const ring: number[] =
    signedArea2(points) < 0
      ? Array.from({ length: n }, (_, i) => n - 1 - i)
      : Array.from({ length: n }, (_, i) => i);

  const triangles: [number, number, number][] = [];
  let guard = 2 * ring.length; // a bad polygon can't loop forever
  while (ring.length > 3 && guard-- > 0) {
    for (let i = 0; i < ring.length; i++) {
      const iPrev = ring[(i - 1 + ring.length) % ring.length];
      const iCurr = ring[i];
      const iNext = ring[(i + 1) % ring.length];
      const a = points[iPrev];
      const b = points[iCurr];
      const c = points[iNext];

      // Convex corner? (left turn for a CCW ring.)
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) <= 0) continue;

      // No other vertex may sit inside the candidate ear.
      const clean = ring.every((idx) =>
        idx === iPrev ||
        idx === iCurr ||
        idx === iNext ||
        !pointInTriangle(points[idx], a, b, c),
      );
      if (!clean) continue;

      triangles.push([iPrev, iCurr, iNext]);
      ring.splice(i, 1);
      guard = 2 * ring.length;
      break;
    }
  }
  if (ring.length === 3) {
    triangles.push([ring[0], ring[1], ring[2]]);
  }
  return triangles;
}

/**
 * Extrude a stored Room into its dollhouse mesh — the bridge from the DB model
 * to {@link extrudeRoom}. Resolves the two things the pure primitive needs:
 * the footprint in floor space (normalized footprint + `origin`, ADR 0026) and
 * the ceiling height (the Room's override, else its Floor's default).
 */
export function extrudeRoomFromModel(room: Room, floor: Floor): ExtrudedMesh {
  return extrudeRoom({
    footprint: translateFootprint(room.footprint, room.origin),
    height: room.ceiling_height_override ?? floor.default_ceiling_height,
  });
}
