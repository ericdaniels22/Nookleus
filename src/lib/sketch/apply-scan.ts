// Issue #871 — Sketch S12: apply a RoomPlan scan to a Job's Sketch.
//
// The orchestrator behind the editor's "Scan room" button. ADR 0025: a scan is an
// INPUT that fills the Job's ONE Sketch, not a parallel artifact — so this composes
// the existing single-writer pieces rather than inventing a scan entity. It
//   1. create-or-loads the Job's Sketch (getOrCreateJobSketch — 1:1 with the Job),
//   2. maps the capture onto the Sketch model (M11, map-capture),
//   3. writes the mapped Room and its known objects through the same create-room /
//      create-object paths a hand-drawn Room uses (so the measurement cache and RLS
//      scoping are identical).
// A scan comes out imperfect; the mandatory editor pass is where it's corrected. An
// empty capture maps to no Room, but the Sketch (and its bootstrap Floor) are still
// ensured — the editor opens on a blank Sketch to draw from scratch.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CapturedRoom } from "@/lib/mobile/roomplan-capture";
import { mapCapturedRoom } from "./map-capture";
import { getOrCreateJobSketch } from "./job-sketch";
import { createSketchRoom, type RoomRow } from "./create-room";
import { createSketchObject, type RoomObjectRow } from "./create-object";

export interface ApplyRoomScanInput {
  organizationId: string;
  jobId: string;
  /** The room Apple RoomPlan captured, as reported to the app (roomplan-capture). */
  room: CapturedRoom;
}

export interface ApplyRoomScanResult {
  /** The Job's Sketch — created on this call or loaded if it already existed. */
  sketchId: string;
  /** The Room the scan drew, or null when the capture had no enclosable footprint. */
  room: RoomRow | null;
  /** The known objects written into that Room (empty when there's no Room). */
  objects: RoomObjectRow[];
}

export async function applyRoomScan(
  supabase: SupabaseClient,
  input: ApplyRoomScanInput,
): Promise<ApplyRoomScanResult> {
  // The Sketch is ensured first and unconditionally: even an empty capture must
  // leave the Job with an empty-but-valid Sketch to open in the editor.
  const { sketchId } = await getOrCreateJobSketch(supabase, {
    organizationId: input.organizationId,
    jobId: input.jobId,
  });

  const mapped = mapCapturedRoom(input.room);
  if (!mapped) return { sketchId, room: null, objects: [] };

  // Place the scan on the Sketch's first Floor — the switcher's default level,
  // ordered the same way the builder page reads it (sort_order, then created_at).
  const { data: floor, error: floorError } = await supabase
    .from("floors")
    .select("id")
    .eq("sketch_id", sketchId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (floorError) throw new Error(floorError.message);
  if (!floor) throw new Error("Sketch has no Floor to place the scan on");

  const room = await createSketchRoom(supabase, {
    organizationId: input.organizationId,
    floorId: floor.id,
    name: mapped.name,
    footprint: mapped.footprint,
    ceilingHeightOverride: mapped.ceilingHeightOverride,
    openings: mapped.openings,
  });

  // One row per mapped known object, bound to the new Room. Sequential (not
  // parallel) so sort_order follows detection order and a failure surfaces cleanly.
  const objects: RoomObjectRow[] = [];
  for (const object of mapped.objects) {
    objects.push(
      await createSketchObject(supabase, {
        organizationId: input.organizationId,
        roomId: room.id,
        category: object.category,
        position: object.position,
        rotation: object.rotation,
      }),
    );
  }

  return { sketchId, room, objects };
}
