// Issue #865 — Sketch S5: persist one new Floor under a Sketch.
//
// A Sketch grows from its bootstrap Floor (getOrCreateJobSketch) into many:
// authoring multiple Floors, and modeling a detached structure as its own Floor
// (CONTEXT.md "Floor"). This is the single place a Floor is added after
// bootstrap. It writes only identity + name and lets the `floors` table defaults
// (migration-build88) supply the level defaults — ceiling height and the two wall
// thicknesses — so a Floor added through the app is indistinguishable from the
// one getOrCreateJobSketch seeds. Ordering falls out of `created_at` (the page
// sorts by sort_order then created_at, and every Floor shares the default
// sort_order), so newly-added Floors append after the first.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Floor } from "@/lib/types";

export interface CreateSketchFloorInput {
  organizationId: string;
  sketchId: string;
  /** The Floor's name — e.g. "Second Floor" or "Detached Garage". */
  name: string;
}

export async function createSketchFloor(
  supabase: SupabaseClient,
  input: CreateSketchFloorInput,
): Promise<Floor> {
  const { data: floor, error } = await supabase
    .from("floors")
    .insert({
      organization_id: input.organizationId,
      sketch_id: input.sketchId,
      name: input.name,
    })
    .select("*")
    .single<Floor>();
  if (error || !floor) {
    throw new Error(error?.message ?? "Floor insert returned no row");
  }
  return floor;
}
