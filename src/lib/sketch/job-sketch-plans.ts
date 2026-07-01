// Issue #868 — Sketch S8, the bridge from a Job's loaded Sketch to the
// Photo-Report plan pages.
//
// The generator loads a Job's Floors and Rooms, then hands them here to turn
// each Floor into a dimensioned {@link PlanRender} (via the pure geometry in
// plan-render.ts). This keeps the generator's supabase I/O separate from the
// per-Floor mapping, and keeps the mapping unit-testable without a database.

import { buildSketchPlanRender, type PlanRender } from "./plan-render";
import type { Point } from "./footprint";

/** The Floor fields a plan page needs — its identity and display name. */
export interface SketchPlanFloor {
  id: string;
  name: string;
}

/** The Room fields a plan page needs — placement + shape + cached area. */
export interface SketchPlanRoom {
  floor_id: string;
  name: string;
  footprint: Point[];
  origin: Point;
  floor_area: number;
}

/**
 * Turn a Job's loaded Floors + Rooms into one {@link PlanRender} per Floor that
 * has something to draw. Rooms are grouped by `floor_id` in the order given, so
 * the caller's Floor and Room ordering carries through to the pages. A Floor
 * whose Rooms are all absent or still being drawn (fewer than three corners)
 * yields no renderable rooms and is skipped — the report shows no blank plan
 * page for it.
 */
export function buildJobSketchPlans(
  floors: SketchPlanFloor[],
  rooms: SketchPlanRoom[],
): PlanRender[] {
  const plans: PlanRender[] = [];
  for (const floor of floors) {
    const floorRooms = rooms
      .filter((room) => room.floor_id === floor.id)
      .map((room) => ({
        name: room.name,
        footprint: room.footprint,
        origin: room.origin,
        floorArea: room.floor_area,
      }));
    const plan = buildSketchPlanRender({ floorName: floor.name, rooms: floorRooms });
    if (plan.rooms.length > 0) plans.push(plan);
  }
  return plans;
}
