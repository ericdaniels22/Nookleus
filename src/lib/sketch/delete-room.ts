// Issue #890 — remove a placed Room. The full-screen editor's inspector deletes
// the selected Room; this is the single write path. A Room owns nothing
// downstream yet (doors/windows land in #866, fixtures in #867), so removal is a
// plain row delete. It is scoped to the Room's id and — because the caller
// passes an RLS-bound client — to a Room the caller is allowed to see.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DeleteSketchRoomInput {
  roomId: string;
}

export async function deleteSketchRoom(
  supabase: SupabaseClient,
  input: DeleteSketchRoomInput,
): Promise<void> {
  const { error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", input.roomId);
  if (error) throw new Error(error.message);
}
