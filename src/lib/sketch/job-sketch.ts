// Issue #860 — the create-or-load step behind a Job's Sketch surface.
//
// A Sketch is 1:1 with its Job (CONTEXT.md "Sketch"): opening the surface
// establishes the model on first visit and loads it on every visit after. This
// is the single place that bootstrap happens, so the API route and the builder
// page agree on what a brand-new Sketch looks like — one Floor carrying the level
// defaults a Room inherits. Persistence, RLS, and the UNIQUE(job_id) backstop
// live in migration-build88; this just orchestrates the supabase-js calls.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The level defaults a brand-new Sketch's first Floor carries (CONTEXT.md
 * "Floor"). Kept in lockstep with migration-build88's `floors` column defaults
 * so a Sketch created through the app is indistinguishable from one seeded by the
 * DB defaults. Lengths are in the Sketch's linear unit (feet).
 */
export const DEFAULT_FLOOR = {
  name: "Ground Floor",
  defaultCeilingHeight: 8,
  interiorWallThickness: 0.33,
  exteriorWallThickness: 0.5,
} as const;

export interface GetOrCreateJobSketchInput {
  organizationId: string;
  jobId: string;
}

export interface JobSketchResult {
  sketchId: string;
  /** True when this call established the Sketch; false when it loaded one. */
  created: boolean;
}

/**
 * Create-or-load a Job's single Sketch. Returns the existing Sketch's id when one
 * is present; otherwise inserts a Sketch plus its first Floor (with the level
 * defaults) in the caller's org and returns the new id. Idempotent: a second call
 * for the same Job loads rather than duplicating — and UNIQUE(job_id) is the
 * backstop if two opens race.
 */
export async function getOrCreateJobSketch(
  supabase: SupabaseClient,
  input: GetOrCreateJobSketchInput,
): Promise<JobSketchResult> {
  const { data: existing, error: loadError } = await supabase
    .from("sketches")
    .select("id")
    .eq("job_id", input.jobId)
    .maybeSingle<{ id: string }>();
  if (loadError) throw new Error(loadError.message);
  if (existing) return { sketchId: existing.id, created: false };

  const { data: sketch, error: sketchError } = await supabase
    .from("sketches")
    .insert({ organization_id: input.organizationId, job_id: input.jobId })
    .select("id")
    .single<{ id: string }>();
  if (sketchError || !sketch) {
    throw new Error(sketchError?.message ?? "Sketch insert returned no row");
  }

  const { error: floorError } = await supabase.from("floors").insert({
    organization_id: input.organizationId,
    sketch_id: sketch.id,
    name: DEFAULT_FLOOR.name,
    default_ceiling_height: DEFAULT_FLOOR.defaultCeilingHeight,
    interior_wall_thickness: DEFAULT_FLOOR.interiorWallThickness,
    exterior_wall_thickness: DEFAULT_FLOOR.exteriorWallThickness,
  });
  if (floorError) throw new Error(floorError.message);

  return { sketchId: sketch.id, created: true };
}
