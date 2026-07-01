// Issue #865 — Sketch S5: adding a Floor to a Sketch. A Sketch grows from one
// Floor into many (author multiple Floors; a detached structure is just another
// Floor). This persists one new Floor under a Sketch the caller can see; the
// level defaults (ceiling height, wall thicknesses) come from the table defaults
// (migration-build88), so a Floor added through the app matches a DB-seeded one.
// A chainable Supabase stub lets us assert the exact insert payload without a DB.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSketchFloor } from "./create-floor";

// Stub the one table createSketchFloor touches: `floors`. An insert captures the
// payload; `.single()` echoes it back with an id, mirroring `.select("*")`.
// `inserts.floors` exposes the captured payload for assertions.
function fakeSupabase() {
  const inserts: Record<string, Record<string, unknown>> = {};
  function from(table: string) {
    let captured: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      insert: (payload: Record<string, unknown>) => {
        inserts[table] = payload;
        captured = payload;
        return builder;
      },
      single: async () => ({ data: { id: "floor-new", ...captured }, error: null }),
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, inserts };
}

describe("createSketchFloor", () => {
  it("inserts a named Floor under the Sketch in the caller's org", async () => {
    const { client, inserts } = fakeSupabase();

    const floor = await createSketchFloor(client, {
      organizationId: "org-1",
      sketchId: "sketch-1",
      name: "Second Floor",
    });

    // Only identity + name are written — the level defaults come from the table
    // defaults, so a Floor added through the app matches a DB-seeded one.
    expect(inserts.floors).toEqual({
      organization_id: "org-1",
      sketch_id: "sketch-1",
      name: "Second Floor",
    });
    // The echoed row is returned so the caller can place it in the plan.
    expect(floor.id).toBe("floor-new");
    expect(floor.name).toBe("Second Floor");
  });
});
