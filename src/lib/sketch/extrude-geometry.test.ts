import { describe, expect, it } from "vitest";
import type { Floor, Room, SketchPoint } from "../types";
import { polygonArea, polygonPerimeter, rectangleFootprint } from "./footprint";
import {
  type ExtrudedMesh,
  extrudeRoom,
  extrudeRoomFromModel,
} from "./extrude-geometry";

/** Every Y (the up-axis) coordinate in a flat [x,y,z, ...] position buffer. */
function heights(positions: number[]): number[] {
  const ys: number[] = [];
  for (let i = 1; i < positions.length; i += 3) ys.push(positions[i]);
  return ys;
}

/** The vertex at index `n` as an [x, y, z] tuple. */
function vertex(positions: number[], n: number): [number, number, number] {
  return [positions[3 * n], positions[3 * n + 1], positions[3 * n + 2]];
}

/**
 * Total surface area of the wall triangles in a mesh — every triangle that
 * rises above the floor (a floor triangle sits entirely at y = 0). Measured off
 * the mesh, not the inputs, so it proves what the geometry actually contains.
 */
function triangleArea(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return Math.hypot(cross[0], cross[1], cross[2]) / 2;
}

/**
 * Total surface area of the wall triangles in a mesh — every triangle that
 * rises above the floor (a floor triangle sits entirely at y = 0). Measured off
 * the mesh, not the inputs, so it proves what the geometry actually contains.
 */
function meshWallArea(mesh: ExtrudedMesh): number {
  const { positions, indices } = mesh;
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = vertex(positions, indices[t]);
    const b = vertex(positions, indices[t + 1]);
    const c = vertex(positions, indices[t + 2]);
    if (a[1] === 0 && b[1] === 0 && c[1] === 0) continue; // a floor triangle
    area += triangleArea(a, b, c);
  }
  return area;
}

/** Total surface area of the floor triangles (those lying entirely at y = 0). */
function meshFloorArea(mesh: ExtrudedMesh): number {
  const { positions, indices } = mesh;
  let area = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = vertex(positions, indices[t]);
    const b = vertex(positions, indices[t + 1]);
    const c = vertex(positions, indices[t + 2]);
    if (a[1] === 0 && b[1] === 0 && c[1] === 0) area += triangleArea(a, b, c);
  }
  return area;
}

/** A Floor with sane defaults; override only the fields a test cares about. */
function makeFloor(overrides: Partial<Floor> = {}): Floor {
  return {
    id: "floor-1",
    organization_id: "org-1",
    sketch_id: "sketch-1",
    name: "Ground Floor",
    default_ceiling_height: 8,
    interior_wall_thickness: 0.33,
    exterior_wall_thickness: 0.5,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** A Room with sane defaults; override only the fields a test cares about. */
function makeRoom(overrides: Partial<Room> = {}): Room {
  const footprint: SketchPoint[] = overrides.footprint ?? rectangleFootprint(2, 2);
  return {
    id: "room-1",
    organization_id: "org-1",
    floor_id: "floor-1",
    name: "Room 1",
    footprint,
    origin: { x: 0, y: 0 },
    width: 2,
    length: 2,
    ceiling_height_override: null,
    sort_order: 0,
    floor_area: 0,
    ceiling_area: 0,
    perimeter: 0,
    gross_wall_area: 0,
    net_wall_area: 0,
    volume: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("extrudeRoom", () => {
  it("stands a footprint's walls up to exactly the ceiling height", () => {
    // A 1 × 1 Room at an 8′ ceiling: the extruded mesh spans from the floor
    // (y = 0) up to the wall tops (y = 8) — nothing rises above the ceiling.
    // Y is the up-axis so the viewer can drop the plan straight in (no rotation).
    const mesh = extrudeRoom({ footprint: rectangleFootprint(1, 1), height: 8 });

    const ys = heights(mesh.positions);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(8);
  });

  it("builds a wall quad per edge plus a floor slab, with the expected counts", () => {
    // A rectangle has 4 edges → 4 wall quads (4 verts + 2 tris each) = 16 verts,
    // 8 tris. The floor slab is the rectangle itself = 4 verts, 2 tris. So the
    // dollhouse is 20 vertices and 10 faces — an open-top box: floor + 4 walls.
    const mesh = extrudeRoom({ footprint: rectangleFootprint(3, 4), height: 8 });

    expect(mesh.positions.length / 3).toBe(20);
    expect(mesh.indices.length / 3).toBe(10);
  });

  it("stands each wall on its footprint edge, mapping plan (x,y) to world (x,·,y)", () => {
    // rectangleFootprint(3,4) walks corners (0,0)→(3,0)→(3,4)→(0,4). The first
    // wall is the edge (0,0)→(3,0): its base sits on that edge at y=0 and its
    // top is the same edge at y=8. This pins the up-axis convention — plan y
    // becomes world z, ceiling height becomes world y — so the viewer needs no
    // rotation.
    const mesh = extrudeRoom({ footprint: rectangleFootprint(3, 4), height: 8 });

    const firstWall = mesh.positions.slice(0, 12); // 4 verts × 3 coords
    expect(firstWall).toEqual([
      0, 0, 0, // (0,0) at the floor
      3, 0, 0, // (3,0) at the floor
      3, 8, 0, // (3,0) at the ceiling
      0, 8, 0, // (0,0) at the ceiling
    ]);
  });

  it("walls the full perimeter at full height — openings are not cut", () => {
    // Opening behavior (documented): the Room model has no openings yet
    // (types.ts — "no openings yet"), and this read-only schematic does NOT cut
    // door/window gaps into walls. So the wall surface is continuous —
    // perimeter × height — mirroring the model's net_wall_area === gross_wall_area.
    const footprint = rectangleFootprint(3, 4); // perimeter = 14
    const mesh = extrudeRoom({ footprint, height: 8 });

    expect(meshWallArea(mesh)).toBeCloseTo(polygonPerimeter(footprint) * 8); // 112
  });

  it("extrudes a concave (L/U) footprint — one wall per edge, exact floor area", () => {
    // A U-shaped Room (a 6×4 block with a 2×3 notch), the kind of non-rectangular
    // footprint footprint.ts targets ("L-rooms, bays"). Eight edges → eight walls;
    // the floor slab must cover exactly the polygon (area 18), which a naive fan
    // from one corner gets wrong for a concave shape.
    const footprint = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ];
    const mesh = extrudeRoom({ footprint, height: 8 });

    // Eight edges, each a wall of 2 triangles → 16 wall triangles.
    const wallTriangles = 8 * 2;
    expect(mesh.indices.length / 3 - wallTriangles).toBe(footprint.length - 2); // floor fan-count
    expect(meshFloorArea(mesh)).toBeCloseTo(polygonArea(footprint)); // 18
    expect(meshWallArea(mesh)).toBeCloseTo(polygonPerimeter(footprint) * 8);
  });

  it("extrudes a degenerate footprint (under three corners) to nothing", () => {
    // Mirrors footprint.ts: a half-drawn Room (0, 1, or 2 points) encloses no
    // shape, so it extrudes to an empty mesh rather than NaN or stray geometry.
    const partials: SketchPoint[][] = [
      [],
      [{ x: 0, y: 0 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    ];
    for (const footprint of partials) {
      const mesh = extrudeRoom({ footprint, height: 8 });
      expect(mesh.positions).toEqual([]);
      expect(mesh.indices).toEqual([]);
    }
  });
});

describe("extrudeRoomFromModel", () => {
  it("places the Room's footprint at its origin on the Floor", () => {
    // ADR 0026: a Room stores a NORMALIZED footprint (min corner at 0,0) plus an
    // `origin` for where it sits on the Floor. The dollhouse must shift by the
    // origin so Rooms land in shared floor space. A 2×2 Room at origin (10,5):
    // its first wall base runs (0,0)→(2,0) shifted to (10,5)→(12,5).
    const room = makeRoom({
      footprint: rectangleFootprint(2, 2),
      origin: { x: 10, y: 5 },
    });
    const mesh = extrudeRoomFromModel(room, makeFloor());

    expect(mesh.positions.slice(0, 6)).toEqual([10, 0, 5, 12, 0, 5]);
  });

  it("raises walls to the Room's ceiling override, else the Floor default", () => {
    const floor = makeFloor({ default_ceiling_height: 8 });

    // An override wins: the walls rise to 10′, not the Floor's 8′.
    const overridden = extrudeRoomFromModel(
      makeRoom({ ceiling_height_override: 10 }),
      floor,
    );
    expect(Math.max(...heights(overridden.positions))).toBe(10);

    // A null override inherits: the walls rise to the Floor's 8′.
    const inherited = extrudeRoomFromModel(
      makeRoom({ ceiling_height_override: null }),
      floor,
    );
    expect(Math.max(...heights(inherited.positions))).toBe(8);
  });
});
