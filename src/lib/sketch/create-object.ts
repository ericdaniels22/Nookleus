// Issue #867 — S7: persist one known object into a Room (M5 write path).
//
// A Room carries an inventory of placed known objects — cabinets, appliances,
// fixtures (CONTEXT.md "Room"). This is the single server-side place the plan
// editor drops one in. Objects are a COUNT source only, so the row stores WHICH
// category and WHERE it sits (placement, never billed) — no area/length. Reading
// the Room first scopes the write to a Room the caller can see under RLS, and the
// category is checked against the known vocabulary before it reaches the DB so a
// bad value off the wire fails as a clear RangeError rather than a CHECK violation.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Point } from "./footprint";
import { OBJECT_CATEGORIES, type ObjectCategory } from "./object-inventory";

export interface CreateSketchObjectInput {
  organizationId: string;
  roomId: string;
  category: ObjectCategory;
  /** Where the object sits in the Room's normalized space; defaults to (0,0). */
  position?: Point;
  /** Orientation of the placed glyph, in degrees; defaults to 0. */
  rotation?: number;
}

/** The persisted room_objects row (migration-build92). */
export interface RoomObjectRow {
  id: string;
  room_id: string;
  category: ObjectCategory;
  position: Point;
  rotation: number | string;
  sort_order: number;
}

export async function createSketchObject(
  supabase: SupabaseClient,
  input: CreateSketchObjectInput,
): Promise<RoomObjectRow> {
  if (!(OBJECT_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new RangeError(
      `createSketchObject: unknown category "${input.category}"`,
    );
  }

  // Scope the write to a Room the caller can see under RLS: a cross-org or
  // nonexistent id resolves to no row.
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id")
    .eq("id", input.roomId)
    .maybeSingle<{ id: string }>();
  if (roomError) throw new Error(roomError.message);
  if (!room) throw new Error("Room not found");

  const { data: object, error } = await supabase
    .from("room_objects")
    .insert({
      organization_id: input.organizationId,
      room_id: input.roomId,
      category: input.category,
      position: input.position ?? { x: 0, y: 0 },
      rotation: input.rotation ?? 0,
    })
    .select("*")
    .single<RoomObjectRow>();
  if (error || !object) {
    throw new Error(error?.message ?? "Object insert returned no row");
  }
  return object;
}
