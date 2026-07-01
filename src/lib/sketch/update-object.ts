// Issue #867 — S7: mutate a placed object (M5 write path). The plan editor drags
// an object to a new spot, rotates it, or swaps its category. This is the single
// write path for all three, as a partial patch touching ONLY the changed columns.
//
// Objects are a COUNT source only, so — unlike a Room — a move or rotate never
// re-derives a cached measurement; there is nothing to keep in lockstep, so the
// patch is just the placement/category columns. A sent category is checked against
// the known vocabulary first, so a bad value fails as a clear RangeError rather
// than a CHECK violation. The `.update(...).eq("id")` is RLS-bound: an object the
// caller can't see resolves to no row and surfaces as an error.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Point } from "./footprint";
import { OBJECT_CATEGORIES, type ObjectCategory } from "./object-inventory";
import type { RoomObjectRow } from "./create-object";

export interface UpdateSketchObjectInput {
  objectId: string;
  /** Present → swap the object's category (a fridge becomes a stove). */
  category?: ObjectCategory;
  /** Present → move the object to this spot in the Room's normalized space. */
  position?: Point;
  /** Present → re-orient the placed glyph, in degrees. */
  rotation?: number;
}

export async function updateSketchObject(
  supabase: SupabaseClient,
  input: UpdateSketchObjectInput,
): Promise<RoomObjectRow> {
  if (
    input.category !== undefined &&
    !(OBJECT_CATEGORIES as readonly string[]).includes(input.category)
  ) {
    throw new RangeError(
      `updateSketchObject: unknown category "${input.category}"`,
    );
  }

  const patch: Record<string, unknown> = {};
  if (input.category !== undefined) patch.category = input.category;
  if (input.position !== undefined) patch.position = input.position;
  if (input.rotation !== undefined) patch.rotation = input.rotation;

  const { data: object, error } = await supabase
    .from("room_objects")
    .update(patch)
    .eq("id", input.objectId)
    .select("*")
    .single<RoomObjectRow>();
  if (error || !object) {
    throw new Error(error?.message ?? "Object update returned no row");
  }
  return object;
}
