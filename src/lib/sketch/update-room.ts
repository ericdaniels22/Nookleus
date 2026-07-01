// Issue #890 — mutate a placed Room. The full-screen editor's inspector renames a
// Room and overrides its ceiling height; dragging it on the canvas moves it. This
// is the single write path for all three, as a partial patch: it touches only the
// columns that changed. A move writes just `origin` (ADR 0026: position-invariant,
// so the footprint and the cached measurements are never disturbed); changing the
// ceiling height re-derives the six cached measurements from the stored footprint,
// keeping the app the single writer of the cache (migration-build88/89).

import type { SupabaseClient } from "@supabase/supabase-js";

import { boundingBox, normalizeFootprint, type Point } from "./footprint";
import { measureFootprint } from "./measure-room";
import type { RoomRow } from "./create-room";

export interface UpdateSketchRoomInput {
  roomId: string;
  /** Present → move the Room to this position on the Floor (ADR 0026). */
  origin?: Point;
  /** Present → rename the Room. */
  name?: string;
  /**
   * Present → reshape the Room to this footprint (#862: a corner dragged, a wall
   * deleted, a wall length typed). The corners arrive in PLACED floor
   * coordinates and are re-split (ADR 0026) into a normalized footprint (min
   * corner → 0,0) plus the `origin` they were drawn at, so a reshape that also
   * shifts the shape still lands where the user left it. width/length backfill
   * from the bounding box and the six cached measurements are recomputed from
   * the new shape (migration-build88: single writer).
   */
  footprint?: Point[];
  /**
   * Present → change the Room's ceiling-height override. A number pins the
   * height; `null` clears the override so the Room inherits the Floor default.
   * Either way the six cached measurements are re-derived from the stored
   * footprint at the new effective height (migration-build88: single writer).
   */
  ceilingHeightOverride?: number | null;
}

export async function updateSketchRoom(
  supabase: SupabaseClient,
  input: UpdateSketchRoomInput,
): Promise<RoomRow> {
  const patch: Record<string, unknown> = {};
  if (input.origin !== undefined) patch.origin = input.origin;
  if (input.name !== undefined) patch.name = input.name;

  // Reshaping the Room OR changing its ceiling height both re-measure it, and
  // share one read-measure-write: read the stored footprint, its Floor's default
  // height and its current override; measure the effective shape at the effective
  // height; write the recomputed cache. A move (origin only) or rename skips all
  // of this, since measurements are position- and name-invariant (ADR 0026).
  if (input.footprint !== undefined || input.ceilingHeightOverride !== undefined) {
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("footprint, floor_id, ceiling_height_override")
      .eq("id", input.roomId)
      .maybeSingle<{
        footprint: Point[];
        floor_id: string;
        ceiling_height_override: number | string | null;
      }>();
    if (roomError) throw new Error(roomError.message);
    if (!room) throw new Error("Room not found");

    const { data: floor, error: floorError } = await supabase
      .from("floors")
      .select("default_ceiling_height")
      .eq("id", room.floor_id)
      .maybeSingle<{ default_ceiling_height: number | string }>();
    if (floorError) throw new Error(floorError.message);
    if (!floor) throw new Error("Floor not found");

    // A reshape sends placed corners: re-split into a normalized footprint plus
    // the origin it was drawn at (ADR 0026), and backfill width/length. Absent a
    // reshape we re-measure the STORED footprint (a ceiling-only change).
    let footprint = room.footprint;
    if (input.footprint !== undefined) {
      const split = normalizeFootprint(input.footprint);
      footprint = split.footprint;
      const bbox = boundingBox(footprint);
      patch.footprint = footprint;
      patch.origin = split.origin;
      patch.width = bbox.width;
      patch.length = bbox.length;
    }

    // Effective height: a sent override wins; otherwise the Room's stored
    // override; otherwise the Floor default. A footprint-only edit therefore
    // measures at whatever height the Room is already pinned to (or inherits).
    const effectiveOverride =
      input.ceilingHeightOverride !== undefined
        ? input.ceilingHeightOverride
        : room.ceiling_height_override;
    const ceilingHeight =
      effectiveOverride != null
        ? Number(effectiveOverride)
        : Number(floor.default_ceiling_height);
    const m = measureFootprint({ footprint, ceilingHeight });

    if (input.ceilingHeightOverride !== undefined) {
      patch.ceiling_height_override = input.ceilingHeightOverride;
    }
    patch.floor_area = m.floorArea;
    patch.ceiling_area = m.ceilingArea;
    patch.perimeter = m.perimeter;
    patch.gross_wall_area = m.grossWallArea;
    patch.net_wall_area = m.netWallArea;
    patch.volume = m.volume;
  }

  const { data: room, error } = await supabase
    .from("rooms")
    .update(patch)
    .eq("id", input.roomId)
    .select("*")
    .single<RoomRow>();
  if (error || !room) {
    throw new Error(error?.message ?? "Room update returned no row");
  }
  return room;
}
