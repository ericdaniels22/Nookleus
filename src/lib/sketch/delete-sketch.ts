// Issue #869 (S9) — deleting a Job's Sketch (the Sketch surface's "start over").
//
// A Sketch owns its Floors and Rooms (and, when they land, openings/objects)
// through ON DELETE CASCADE (migration-build88), so removing the whole plan is a
// plain row delete on `sketches`: the DB cascades the rest and the stored mesh
// (carried on the row's `mesh_ref`) goes with it. Line items sourced from the
// Sketch are decoupled by design — `estimate_line_items.sketch_source` is a
// frozen jsonb snapshot with no FK (ADR 0004) — so their quantities survive.
//
// The delete is scoped to the Sketch's id and, because the caller passes an
// RLS-bound client, to a Sketch the caller may see. Mirrors deleteSketchRoom.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DeleteSketchInput {
  sketchId: string;
}

export async function deleteSketch(
  supabase: SupabaseClient,
  input: DeleteSketchInput,
): Promise<void> {
  const { error } = await supabase
    .from("sketches")
    .delete()
    .eq("id", input.sketchId);

  if (error) throw new Error(error.message);
}
