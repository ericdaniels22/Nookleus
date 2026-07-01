// Issue #890 — mutate a placed Room. The full-screen editor's inspector renames a
// Room and overrides its ceiling height; dragging it on the canvas moves it. This
// is the single write path for all three, as a partial patch: it touches only the
// columns that changed. A move writes just `origin` (ADR 0026: position-invariant,
// so the footprint and the cached measurements are never disturbed); changing the
// ceiling height re-derives the six cached measurements from the stored footprint,
// keeping the app the single writer of the cache (migration-build88/89).

import type { SupabaseClient } from "@supabase/supabase-js";

import { type Point } from "./footprint";
import { measureFootprint } from "./measure-room";
import type { RoomRow } from "./create-room";

export interface UpdateSketchRoomInput {
  roomId: string;
  /** Present → move the Room to this position on the Floor (ADR 0026). */
  origin?: Point;
  /** Present → rename the Room. */
  name?: string;
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

  // Changing the ceiling height re-measures the Room: read the stored footprint
  // and its Floor's default height, resolve the effective height (override ??
  // default), and recompute the whole cache. The footprint is position-
  // invariant, so origin never enters the measurements and is left untouched.
  if (input.ceilingHeightOverride !== undefined) {
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("footprint, floor_id")
      .eq("id", input.roomId)
      .maybeSingle<{ footprint: Point[]; floor_id: string }>();
    if (roomError) throw new Error(roomError.message);
    if (!room) throw new Error("Room not found");

    const { data: floor, error: floorError } = await supabase
      .from("floors")
      .select("default_ceiling_height")
      .eq("id", room.floor_id)
      .maybeSingle<{ default_ceiling_height: number | string }>();
    if (floorError) throw new Error(floorError.message);
    if (!floor) throw new Error("Floor not found");

    const ceilingHeight =
      input.ceilingHeightOverride ?? Number(floor.default_ceiling_height);
    const m = measureFootprint({ footprint: room.footprint, ceilingHeight });

    patch.ceiling_height_override = input.ceilingHeightOverride;
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
