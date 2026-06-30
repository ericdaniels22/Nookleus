// Issue #860 — persist one rectangular Room under a Floor.
//
// The cached measurement columns on `rooms` (migration-build88) are a snapshot of
// M1's output. The app is their single writer, so this is the one server-side
// place they're computed: it resolves the Room's EFFECTIVE ceiling height (the
// Floor default unless the Room overrides it), runs measureRoom, and writes the
// dimensions and the cache together — they can never disagree. Reading the Floor
// first also scopes the write to a Floor the caller can actually see under RLS.

import type { SupabaseClient } from "@supabase/supabase-js";

import { measureRoom } from "./measure-room";

export interface CreateSketchRoomInput {
  organizationId: string;
  floorId: string;
  name: string;
  width: number;
  length: number;
  /** null → inherit the Floor's default ceiling height; a value overrides it. */
  ceilingHeightOverride: number | null;
}

/** The persisted Room row, dimensions + cached measurements (all numeric). */
export interface RoomRow {
  id: string;
  floor_id: string;
  name: string;
  width: number | string;
  length: number | string;
  ceiling_height_override: number | string | null;
  floor_area: number | string;
  ceiling_area: number | string;
  perimeter: number | string;
  gross_wall_area: number | string;
  net_wall_area: number | string;
  volume: number | string;
}

export async function createSketchRoom(
  supabase: SupabaseClient,
  input: CreateSketchRoomInput,
): Promise<RoomRow> {
  // The Floor supplies the inherited ceiling height. PostgREST returns numeric
  // columns as strings, so coerce before doing arithmetic with it.
  const { data: floor, error: floorError } = await supabase
    .from("floors")
    .select("id, default_ceiling_height")
    .eq("id", input.floorId)
    .maybeSingle<{ id: string; default_ceiling_height: number | string }>();
  if (floorError) throw new Error(floorError.message);
  if (!floor) throw new Error("Floor not found");

  const ceilingHeight =
    input.ceilingHeightOverride ?? Number(floor.default_ceiling_height);
  const m = measureRoom({
    width: input.width,
    length: input.length,
    ceilingHeight,
  });

  const { data: room, error } = await supabase
    .from("rooms")
    .insert({
      organization_id: input.organizationId,
      floor_id: input.floorId,
      name: input.name,
      width: input.width,
      length: input.length,
      ceiling_height_override: input.ceilingHeightOverride,
      floor_area: m.floorArea,
      ceiling_area: m.ceilingArea,
      perimeter: m.perimeter,
      gross_wall_area: m.grossWallArea,
      net_wall_area: m.netWallArea,
      volume: m.volume,
    })
    .select("*")
    .single<RoomRow>();
  if (error || !room) {
    throw new Error(error?.message ?? "Room insert returned no row");
  }
  return room;
}
