// Issue #867 — S7: remove a placed object from a Room (M5 write path). The plan
// editor's inspector deletes the selected object; this is the single write path.
// An object owns nothing downstream, so removal is a plain row delete. It is
// scoped to the object's id and — because the caller passes an RLS-bound client —
// to an object the caller is allowed to see.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DeleteSketchObjectInput {
  objectId: string;
}

export async function deleteSketchObject(
  supabase: SupabaseClient,
  input: DeleteSketchObjectInput,
): Promise<void> {
  const { error } = await supabase
    .from("room_objects")
    .delete()
    .eq("id", input.objectId);
  if (error) throw new Error(error.message);
}
