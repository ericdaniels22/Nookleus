// Issue #865 — Sketch S5: rename a Floor. The editor names each Floor so a plan
// can carry "Main House", "Second Floor", "Detached Garage". This is the single
// write path for a Floor's name — a partial patch touching only `name`, scoped by
// the RLS client to a Floor the caller can see. The level defaults and its Rooms
// are untouched.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Floor } from "@/lib/types";

export interface UpdateFloorInput {
  floorId: string;
  /** The Floor's new name. */
  name: string;
}

export async function updateFloor(
  supabase: SupabaseClient,
  input: UpdateFloorInput,
): Promise<Floor> {
  const { data: floor, error } = await supabase
    .from("floors")
    .update({ name: input.name })
    .eq("id", input.floorId)
    .select("*")
    .single<Floor>();
  if (error || !floor) {
    throw new Error(error?.message ?? "Floor update returned no row");
  }
  return floor;
}
