// Issue #860 — the create-or-load step behind a Job's Sketch surface. Opening a
// Job's Sketch must establish the 1:1-with-Job model on first visit (one sketches
// row + one floors row carrying the level defaults a Room inherits) and load the
// existing one on every visit after — never a second Sketch for the same Job.
//
// This pins that logic in isolation. The persistence itself (real tables, RLS,
// the UNIQUE(job_id) backstop) is covered against an embedded Postgres in
// tests/integration/sketch-floor-room.pg.test.ts; here a chainable Supabase stub
// branches on table so we can assert exactly what the function writes.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getOrCreateJobSketch } from "./job-sketch";

// A Supabase stub covering the two tables this function touches:
//   - sketches: the load read (`.eq("job_id").maybeSingle()`) resolves to
//     `existingSketch`; an insert captures its payload and `.single()` echoes it
//     back as the new row with a generated id.
//   - floors: an insert captures its payload and resolves with no error.
// `inserts` exposes the captured payload per table so a test asserts precisely
// what was written (and that nothing was written on the load path).
function fakeSupabase(opts: { existingSketch: { id: string } | null }) {
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
      maybeSingle: async () => ({
        data: table === "sketches" ? opts.existingSketch : null,
        error: null,
      }),
      single: async () => ({
        data: { id: `${table.slice(0, -1)}-new`, ...captured },
        error: null,
      }),
      then: (resolve: (v: { data: null; error: null }) => unknown) =>
        resolve({ data: null, error: null }),
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, inserts };
}

describe("getOrCreateJobSketch", () => {
  it("establishes a Sketch and its first Floor when the Job has none", async () => {
    const { client, inserts } = fakeSupabase({ existingSketch: null });

    const result = await getOrCreateJobSketch(client, {
      organizationId: "org-1",
      jobId: "job-1",
    });

    expect(result.created).toBe(true);
    // The Sketch is org-scoped and bound to this Job (the 1:1 anchor).
    expect(inserts.sketches).toMatchObject({
      organization_id: "org-1",
      job_id: "job-1",
    });
    // Its first Floor carries the level defaults a Room inherits (CONTEXT.md
    // "Floor": ceiling height + interior/exterior wall thickness).
    expect(inserts.floors).toMatchObject({
      organization_id: "org-1",
      sketch_id: result.sketchId,
      name: "Ground Floor",
      default_ceiling_height: 8,
      interior_wall_thickness: 0.33,
      exterior_wall_thickness: 0.5,
    });
  });

  it("loads the existing Sketch without creating a second (1:1)", async () => {
    const { client, inserts } = fakeSupabase({
      existingSketch: { id: "sketch-1" },
    });

    const result = await getOrCreateJobSketch(client, {
      organizationId: "org-1",
      jobId: "job-1",
    });

    expect(result).toEqual({ sketchId: "sketch-1", created: false });
    // Nothing was written — no duplicate Sketch, no extra Floor.
    expect(inserts.sketches).toBeUndefined();
    expect(inserts.floors).toBeUndefined();
  });
});
