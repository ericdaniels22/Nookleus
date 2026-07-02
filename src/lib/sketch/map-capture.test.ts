// Issue #871 — Sketch S12, M11: the RoomPlan → Sketch mapper.
//
// M11 turns Apple RoomPlan's CapturedRoom (walls/doors/windows/openings/objects,
// in metres, with column-major 4×4 transforms) into the parametric Room the 2D
// editor reviews and corrects (ADR 0025 — a scan fills the one Sketch; it never
// becomes a parallel artifact). These tests drive that pure transform through its
// public entry point, mapCapturedRoom, on hand-built fixtures.

import { describe, expect, it } from "vitest";

import { mapCapturedRoom, FEET_PER_METRE } from "./map-capture";
import { boundingBox, polygonArea } from "./footprint";
import type {
  CapturedObject,
  CapturedRoom,
  CapturedSurface,
} from "@/lib/mobile/roomplan-capture";
import type { SketchOpening, SketchPoint } from "@/lib/types";

// --- Fixture builders --------------------------------------------------------
// RoomPlan reports each surface as dimensions [width, height, thickness] (metres)
// plus a column-major 4×4 model transform: column 0 is the surface's local X axis
// (its length direction) in world space, column 3 is its centre. The floor plane
// is world XZ (Y is up). These builders write real transforms so the mapper's
// transform-decoding is genuinely exercised, not bypassed.

/** A wall/door/window/opening surface centred at (cx,cz) on the floor plane. */
function surface({
  length,
  height,
  cx,
  cz,
  alongZ = false,
  thickness = 0.1,
  confidence = "high",
}: {
  length: number;
  height: number;
  cx: number;
  cz: number;
  alongZ?: boolean;
  thickness?: number;
  confidence?: "low" | "medium" | "high";
}): CapturedSurface {
  // Local X (the length direction) points along world +X, or world +Z when the
  // surface runs the other way. Only column 0 and the translation are read.
  const col0 = alongZ ? [0, 0, 1] : [1, 0, 0];
  const col1 = [0, 1, 0];
  const col2 = alongZ ? [1, 0, 0] : [0, 0, 1];
  return {
    identifier: `s-${cx}-${cz}-${alongZ ? "z" : "x"}`,
    dimensions: [length, height, thickness],
    transform: [
      col0[0], col0[1], col0[2], 0,
      col1[0], col1[1], col1[2], 0,
      col2[0], col2[1], col2[2], 0,
      cx, height / 2, cz, 1,
    ],
    confidence,
  };
}

/** The four walls of a width(X) × depth(Z) rectangle centred at the world origin. */
function rectangleWalls(width: number, depth: number, height = 2.4): CapturedSurface[] {
  const hx = width / 2;
  const hz = depth / 2;
  return [
    surface({ length: width, height, cx: 0, cz: +hz }), // north
    surface({ length: width, height, cx: 0, cz: -hz }), // south
    surface({ length: depth, height, cx: +hx, cz: 0, alongZ: true }), // east
    surface({ length: depth, height, cx: -hx, cz: 0, alongZ: true }), // west
  ];
}

/** A detected object of a RoomPlan category, centred at (cx,cz) on the floor. */
function object({
  category,
  cx,
  cz,
  alongZ = false,
  length = 0.6,
  height = 0.9,
}: {
  category: string;
  cx: number;
  cz: number;
  alongZ?: boolean;
  length?: number;
  height?: number;
}): CapturedObject {
  return { ...surface({ length, height, cx, cz, alongZ }), category };
}

/** An empty CapturedRoom, filled in per test. */
function emptyRoom(): CapturedRoom {
  return { walls: [], doors: [], windows: [], openings: [], objects: [] };
}

describe("mapCapturedRoom — footprint", () => {
  it("chains a rectangular scan's walls into a normalized 4-corner footprint at the scanned height", () => {
    // A 4 m × 3 m room, 2.4 m walls, centred at the world origin. The four walls
    // arrive in no particular winding order — the mapper must chain them into a
    // single closed loop and lift it to a min corner at (0,0) (ADR 0026), the
    // same normalized shape a hand-drawn Room stores.
    const room = { ...emptyRoom(), walls: rectangleWalls(4, 3) };

    const mapped = mapCapturedRoom(room);
    if (!mapped) throw new Error("expected a mapped room");

    // Four corners, in feet, forming the 4 m × 3 m rectangle.
    expect(mapped.footprint).toHaveLength(4);
    const bbox = boundingBox(mapped.footprint);
    expect(bbox.width).toBeCloseTo(4 * FEET_PER_METRE, 3); // 13.123 ft
    expect(bbox.length).toBeCloseTo(3 * FEET_PER_METRE, 3); // 9.843 ft
    expect(polygonArea(mapped.footprint)).toBeCloseTo(12 * FEET_PER_METRE ** 2, 2);

    // Normalized: the min corner sits at (0,0).
    const minX = Math.min(...mapped.footprint.map((p) => p.x));
    const minY = Math.min(...mapped.footprint.map((p) => p.y));
    expect(minX).toBeCloseTo(0, 6);
    expect(minY).toBeCloseTo(0, 6);

    // Ceiling height comes from the scanned wall height, in feet.
    expect(mapped.ceilingHeightOverride).toBeCloseTo(2.4 * FEET_PER_METRE, 3);
  });

  it("returns null for an empty capture — no walls means no enclosable room", () => {
    // AC: an empty capture yields an empty-but-valid Sketch. The mapper produces
    // no Room; the orchestrator still ensures the Sketch (and its Floor) exist.
    expect(mapCapturedRoom(emptyRoom())).toBeNull();
  });

  it("returns null when too few walls chain into a closed loop", () => {
    // Two disconnected walls can't enclose a footprint (< 3 corners) — the editor
    // would start from scratch, so there's nothing to hand it.
    const room = {
      ...emptyRoom(),
      walls: [
        surface({ length: 4, height: 2.4, cx: 0, cz: 1.5 }),
        surface({ length: 4, height: 2.4, cx: 0, cz: -1.5 }),
      ],
    };
    expect(mapCapturedRoom(room)).toBeNull();
  });
});

describe("mapCapturedRoom — openings", () => {
  // Reconstruct an opening's centre in the normalized footprint frame from where
  // the mapper placed it (wall + offset + width). Recovering the right point
  // validates wall_index, offset, and width together, without depending on the
  // chaining's winding direction.
  function openingCentre(footprint: SketchPoint[], o: SketchOpening): SketchPoint {
    const start = footprint[o.wall_index];
    const end = footprint[(o.wall_index + 1) % footprint.length];
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    const along = o.offset + o.width / 2;
    return {
      x: start.x + ((end.x - start.x) / len) * along,
      y: start.y + ((end.y - start.y) / len) * along,
    };
  }

  it("places a door and a window on their walls, sized in feet", () => {
    // Rectangle as before; a 1.2 × 1.0 m window off-centre on the north wall and a
    // 0.9 × 2.1 m door on the west wall. The room's raw min corner is (-2,-1.5) m,
    // so the normalized frame subtracts that.
    const room: CapturedRoom = {
      ...emptyRoom(),
      walls: rectangleWalls(4, 3),
      windows: [surface({ length: 1.2, height: 1.0, cx: 0.5, cz: 1.5 })],
      doors: [surface({ length: 0.9, height: 2.1, cx: -2, cz: -0.5, alongZ: true })],
    };

    const mapped = mapCapturedRoom(room);
    if (!mapped) throw new Error("expected a mapped room");

    expect(mapped.openings).toHaveLength(2);
    const window = mapped.openings.find((o) => o.type === "window");
    const door = mapped.openings.find((o) => o.type === "door");
    if (!window || !door) throw new Error("expected one door and one window");

    // Sizes convert metres → feet.
    expect(window.width).toBeCloseTo(1.2 * FEET_PER_METRE, 3);
    expect(window.height).toBeCloseTo(1.0 * FEET_PER_METRE, 3);
    expect(door.width).toBeCloseTo(0.9 * FEET_PER_METRE, 3);
    expect(door.height).toBeCloseTo(2.1 * FEET_PER_METRE, 3);

    // The window's centre is world (0.5, 1.5) → normalized (2.5, 3.0) m → feet.
    const w = openingCentre(mapped.footprint, window);
    expect(w.x).toBeCloseTo(2.5 * FEET_PER_METRE, 2);
    expect(w.y).toBeCloseTo(3.0 * FEET_PER_METRE, 2);
    // The door's centre is world (-2, -0.5) → normalized (0, 1.0) m → feet.
    const d = openingCentre(mapped.footprint, door);
    expect(d.x).toBeCloseTo(0 * FEET_PER_METRE, 2);
    expect(d.y).toBeCloseTo(1.0 * FEET_PER_METRE, 2);

    // Offsets stay non-negative — an opening never starts before its wall.
    expect(window.offset).toBeGreaterThanOrEqual(0);
    expect(door.offset).toBeGreaterThanOrEqual(0);
  });

  it("maps a doorless passage (RoomPlan 'openings') as a door-type opening", () => {
    // RoomPlan reports doorless wall gaps in its own `openings` array. The Sketch
    // opening model has only door/window, and a passage is a hole in the wall like
    // a doorway — so it maps to a door: counted, and its area deducted from walls.
    const room: CapturedRoom = {
      ...emptyRoom(),
      walls: rectangleWalls(4, 3),
      openings: [surface({ length: 1.0, height: 2.0, cx: 2, cz: 0, alongZ: true })],
    };

    const mapped = mapCapturedRoom(room);
    if (!mapped) throw new Error("expected a mapped room");

    expect(mapped.openings).toHaveLength(1);
    expect(mapped.openings[0].type).toBe("door");
    expect(mapped.openings[0].width).toBeCloseTo(1.0 * FEET_PER_METRE, 3);
    expect(mapped.openings[0].height).toBeCloseTo(2.0 * FEET_PER_METRE, 3);
  });
});

describe("mapCapturedRoom — objects", () => {
  it("places a detected object with its category, normalized position, and rotation", () => {
    // A refrigerator at world (-1.5, 1.0), axis-aligned. The room's raw min corner
    // is (-2,-1.5) m, so the object's normalized position is (0.5, 2.5) m → feet.
    const room: CapturedRoom = {
      ...emptyRoom(),
      walls: rectangleWalls(4, 3),
      objects: [object({ category: "refrigerator", cx: -1.5, cz: 1.0 })],
    };

    const mapped = mapCapturedRoom(room);
    if (!mapped) throw new Error("expected a mapped room");

    expect(mapped.objects).toHaveLength(1);
    const fridge = mapped.objects[0];
    expect(fridge.category).toBe("refrigerator");
    expect(fridge.position.x).toBeCloseTo(0.5 * FEET_PER_METRE, 3);
    expect(fridge.position.y).toBeCloseTo(2.5 * FEET_PER_METRE, 3);
    // Axis-aligned object → no yaw.
    expect(fridge.rotation).toBeCloseTo(0, 6);
  });

  it("renames fixtures, folds soft furnishings into furniture, and drops the rest", () => {
    // A mix that exercises every branch of the category table: a rename
    // (storage→cabinets, washerDryer→washer_dryer), two soft furnishings that
    // collapse to furniture (sofa, bed), and three we can't count (a fireplace, a
    // staircase, and an unknown category from a newer OS) that drop out entirely.
    const room: CapturedRoom = {
      ...emptyRoom(),
      walls: rectangleWalls(6, 5),
      objects: [
        object({ category: "storage", cx: -2, cz: 2 }),
        object({ category: "washerDryer", cx: -2, cz: -2 }),
        object({ category: "sofa", cx: 2, cz: 2 }),
        object({ category: "bed", cx: 2, cz: -2 }),
        object({ category: "fireplace", cx: 0, cz: 2 }),
        object({ category: "stairs", cx: 0, cz: -2 }),
        object({ category: "houseplant", cx: 0, cz: 0 }),
      ],
    };

    const mapped = mapCapturedRoom(room);
    if (!mapped) throw new Error("expected a mapped room");

    expect(mapped.objects.map((o) => o.category)).toEqual([
      "cabinets",
      "washer_dryer",
      "furniture",
      "furniture",
    ]);
  });
});
