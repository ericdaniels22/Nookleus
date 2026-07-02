// Issue #871 — Sketch S12, M11: the RoomPlan → Sketch mapper.
//
// A pure module: given the CapturedRoom Apple RoomPlan reports (walls, doors,
// windows, openings, objects — in metres, each with a column-major 4×4 transform),
// derive the parametric Room the 2D editor reviews and corrects. ADR 0025 is the
// spine: a scan is an INPUT that fills the Job's one Sketch, never a parallel
// artifact, and it comes out imperfect — so this maps geometry as faithfully as it
// can and leaves the corrections to the mandatory editor pass. No persistence, no
// I/O — just the transform — so the rule lives in one unit-tested spot, reused by
// the scan-apply orchestrator.
//
// RoomPlan's coordinate frame: the floor plane is world XZ, Y is up. A surface's
// transform column 0 is its local X axis (its length direction) in world space and
// column 3 is its centre; dimensions are [width, height, thickness] in metres. We
// project every surface onto the floor plane (world X → Sketch x, world Z → Sketch
// y) and convert metres to feet, the Sketch's linear unit.

import { normalizeFootprint, type Point } from "./footprint";
import type {
  CapturedObject,
  CapturedRoom,
  CapturedSurface,
} from "@/lib/mobile/roomplan-capture";
import type { SketchOpening, SketchPoint } from "@/lib/types";
import type { ObjectCategory } from "./object-inventory";

/** Metres → feet. RoomPlan reports SI units; the Sketch grid is 1 unit = 1 ft. */
export const FEET_PER_METRE = 3.28084;

/**
 * Corner-snap tolerance (feet) when chaining walls into a loop. RoomPlan's wall
 * endpoints meet only approximately at a corner; two ends within this distance are
 * treated as the same corner. ~0.5 ft is comfortably below a real wall's length
 * yet above the scan's corner jitter.
 */
const CORNER_TOLERANCE_FT = 0.5;

/** A known object mapped out of a scan: its category and where its glyph sits. */
export interface MappedObject {
  category: ObjectCategory;
  /** Position in the Room's normalized footprint frame (feet). */
  position: SketchPoint;
  /** Glyph orientation in degrees, from the object's yaw about vertical. */
  rotation: number;
}

/**
 * One scanned room mapped onto the Sketch model — the pieces the scan-apply
 * orchestrator writes as a Room plus its objects. The footprint is normalized
 * (min corner at (0,0), ADR 0026); openings and object positions are expressed in
 * that same normalized frame, so the room drops onto the Floor at the origin.
 */
export interface MappedRoom {
  name: string;
  /** Normalized footprint (min corner at (0,0)), in feet. */
  footprint: SketchPoint[];
  /** Ceiling height from the scanned wall height, in feet. */
  ceilingHeightOverride: number;
  openings: SketchOpening[];
  objects: MappedObject[];
}

/** Distance between two floor-plane points (feet). */
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The two floor-plane endpoints of a surface (feet). The centre is transform
 * column 3; the half-length runs ± along the local X axis (column 0) projected to
 * the floor plane. Walls are vertical, so that projected axis is the wall's
 * ground line.
 */
function surfaceEndpoints(surface: CapturedSurface): { a: Point; b: Point } {
  const t = surface.transform;
  const half = surface.dimensions[0] / 2;
  const dirX = t[0];
  const dirZ = t[2];
  const centreX = t[12];
  const centreZ = t[14];
  return {
    a: {
      x: (centreX - half * dirX) * FEET_PER_METRE,
      y: (centreZ - half * dirZ) * FEET_PER_METRE,
    },
    b: {
      x: (centreX + half * dirX) * FEET_PER_METRE,
      y: (centreZ + half * dirZ) * FEET_PER_METRE,
    },
  };
}

/**
 * Chain the walls into an ordered closed loop of corners (feet, floor coords).
 * Greedy: start with one wall, then repeatedly append the wall whose nearest
 * endpoint meets the open end of the chain, walking the loop until it closes or a
 * gap wider than the corner tolerance breaks it (an imperfect scan the editor
 * fixes). The closing corner — the last point back at the start — is dropped so a
 * clean rectangle yields exactly four corners.
 */
function chainWalls(walls: CapturedSurface[]): Point[] {
  if (walls.length === 0) return [];

  const remaining = walls.map(surfaceEndpoints);
  const first = remaining.shift()!;
  const loop: Point[] = [first.a, first.b];

  while (remaining.length > 0) {
    const tail = loop[loop.length - 1];
    let bestIndex = -1;
    let bestDistance = Infinity;
    let nextCorner: Point | null = null;
    for (let i = 0; i < remaining.length; i++) {
      const seg = remaining[i];
      const dA = distance(tail, seg.a);
      if (dA < bestDistance) {
        bestDistance = dA;
        bestIndex = i;
        nextCorner = seg.b;
      }
      const dB = distance(tail, seg.b);
      if (dB < bestDistance) {
        bestDistance = dB;
        bestIndex = i;
        nextCorner = seg.a;
      }
    }
    if (bestIndex === -1 || bestDistance > CORNER_TOLERANCE_FT) break;
    remaining.splice(bestIndex, 1);
    loop.push(nextCorner!);
  }

  if (loop.length > 1 && distance(loop[0], loop[loop.length - 1]) <= CORNER_TOLERANCE_FT) {
    loop.pop();
  }
  return loop;
}

/** The ceiling height, in feet — the tallest scanned wall (its Y extent). */
function ceilingHeight(walls: CapturedSurface[]): number {
  let tallest = 0;
  for (const wall of walls) tallest = Math.max(tallest, wall.dimensions[1]);
  return tallest * FEET_PER_METRE;
}

/**
 * The footprint edge nearest a point, and how far along it (from the edge's start
 * corner) the point's foot lands. Openings are placed on a single wall — the edge
 * that starts at corner `wallIndex` — so this resolves which wall a scanned door
 * or window belongs to and where along it the opening centres.
 */
function nearestEdge(
  footprint: Point[],
  point: Point,
): { wallIndex: number; along: number } {
  let bestIndex = 0;
  let bestAlong = 0;
  let bestDistance = Infinity;
  const n = footprint.length;
  for (let i = 0; i < n; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const lengthSq = ex * ex + ey * ey;
    // Parameter of the closest foot on the segment, clamped to the wall's span.
    const raw = lengthSq === 0 ? 0 : ((point.x - a.x) * ex + (point.y - a.y) * ey) / lengthSq;
    const t = Math.max(0, Math.min(1, raw));
    const footX = a.x + t * ex;
    const footY = a.y + t * ey;
    const distance = Math.hypot(point.x - footX, point.y - footY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestAlong = t * Math.sqrt(lengthSq);
    }
  }
  return { wallIndex: bestIndex, along: bestAlong };
}

/**
 * Map one door/window/passage surface onto the wall it sits on. Its centre (feet,
 * normalized to the footprint frame) resolves the wall and the distance along it;
 * `offset` records where the opening STARTS (its centre less half its width),
 * clamped non-negative so it never begins before the wall.
 */
function mapOpening(
  surface: CapturedSurface,
  type: SketchOpening["type"],
  footprint: Point[],
  origin: Point,
): SketchOpening {
  const t = surface.transform;
  const centre: Point = {
    x: t[12] * FEET_PER_METRE - origin.x,
    y: t[14] * FEET_PER_METRE - origin.y,
  };
  const width = surface.dimensions[0] * FEET_PER_METRE;
  const height = surface.dimensions[1] * FEET_PER_METRE;
  const { wallIndex, along } = nearestEdge(footprint, centre);
  return {
    type,
    width,
    height,
    wall_index: wallIndex,
    offset: Math.max(0, along - width / 2),
  };
}

/**
 * RoomPlan object category → Sketch inventory category (object-inventory.ts). The
 * nine appliances/fixtures map 1:1 (storage is our "cabinets"); the soft
 * furnishings RoomPlan also detects collapse into the generic "furniture" count;
 * anything neither furniture nor a fixture we bill (a fireplace, a staircase) maps
 * to null and is dropped. An unknown category off a newer OS is dropped too.
 */
const CATEGORY_MAP: Record<string, ObjectCategory | null> = {
  storage: "cabinets",
  refrigerator: "refrigerator",
  stove: "stove",
  oven: "oven",
  dishwasher: "dishwasher",
  washerDryer: "washer_dryer",
  sink: "sink",
  toilet: "toilet",
  bathtub: "bathtub",
  bed: "furniture",
  chair: "furniture",
  sofa: "furniture",
  table: "furniture",
  television: "furniture",
  fireplace: null,
  stairs: null,
};

/** Map one detected object onto a Room object, or null to drop it (unmapped). */
function mapObject(object: CapturedObject, origin: Point): MappedObject | null {
  const category = CATEGORY_MAP[object.category] ?? null;
  if (!category) return null;
  const t = object.transform;
  return {
    category,
    position: {
      x: t[12] * FEET_PER_METRE - origin.x,
      y: t[14] * FEET_PER_METRE - origin.y,
    },
    // Yaw about vertical: the angle of the object's local X axis on the floor.
    rotation: Math.atan2(t[2], t[0]) * (180 / Math.PI),
  };
}

/**
 * Map one RoomPlan CapturedRoom onto the Sketch Room model. Returns null when the
 * capture has no enclosable footprint (fewer than three corners chain out of its
 * walls) — an empty capture yields no Room, only the empty-but-valid Sketch the
 * orchestrator still ensures exists.
 */
export function mapCapturedRoom(room: CapturedRoom): MappedRoom | null {
  const loop = chainWalls(room.walls);
  if (loop.length < 3) return null;

  const { footprint, origin } = normalizeFootprint(loop);

  // Doors and doorless passages both become door-type openings (a passage is a
  // hole in the wall like a doorway); windows become window-type. All three have
  // their area deducted from net wall area downstream (M1).
  const openings: SketchOpening[] = [
    ...room.doors.map((s) => mapOpening(s, "door", footprint, origin)),
    ...room.openings.map((s) => mapOpening(s, "door", footprint, origin)),
    ...room.windows.map((s) => mapOpening(s, "window", footprint, origin)),
  ];

  const objects = room.objects
    .map((object) => mapObject(object, origin))
    .filter((object): object is MappedObject => object !== null);

  return {
    name: "Scanned Room",
    footprint,
    ceilingHeightOverride: ceilingHeight(room.walls),
    openings,
    objects,
  };
}
