// Issue #860 / #879 — persist one Room under a Floor from its drawn footprint.
//
// The cached measurement columns on `rooms` (migration-build88) are a snapshot of
// M1's output. The app is their single writer, so this is the one server-side
// place they're computed: it resolves the Room's EFFECTIVE ceiling height (the
// Floor default unless the Room overrides it), measures the footprint, and writes
// the geometry and the cache together — they can never disagree. S2 (#879) makes
// the footprint a hand-drawn polygon (migration-build89); the bounding box still
// backfills the legacy width/length columns so existing readers keep working.
// Reading the Floor first also scopes the write to a Floor the caller can see
// under RLS.

import type { SupabaseClient } from "@supabase/supabase-js";

import { boundingBox, type Point } from "./footprint";
import { measureFootprint } from "./measure-room";

export interface CreateSketchRoomInput {
  organizationId: string;
  floorId: string;
  name: string;
  /** The drawn footprint — ordered corners of a closed loop (#879). */
  footprint: Point[];
  /** null → inherit the Floor's default ceiling height; a value overrides it. */
  ceilingHeightOverride: number | null;
}

/** The persisted Room row: footprint + dimensions + cached measurements. */
export interface RoomRow {
  id: string;
  floor_id: string;
  name: string;
  footprint: Point[];
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
  const m = measureFootprint({ footprint: input.footprint, ceilingHeight });
  // The bounding box backfills the legacy width/length columns; the footprint
  // jsonb is the real source of shape.
  const bbox = boundingBox(input.footprint);

  const { data: room, error } = await supabase
    .from("rooms")
    .insert({
      organization_id: input.organizationId,
      floor_id: input.floorId,
      name: input.name,
      footprint: input.footprint,
      width: bbox.width,
      length: bbox.length,
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
