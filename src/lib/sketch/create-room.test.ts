// Issue #860 — persisting a Room. The app is the single writer of a Room's cached
// measurement columns (migration-build88): it computes them server-side from M1
// so the cache can never drift from the dimensions. This pins that the write path
//   - feeds measureRoom the EFFECTIVE ceiling height (the Floor default unless the
//     Room overrides it), and
//   - refuses to write against a Floor the caller can't see.
// The pure geometry is M1's own test; the round-trip against real tables is the
// pg test. Here a chainable Supabase stub lets us assert the exact insert payload.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSketchRoom } from "./create-room";
import { measureRoom } from "./measure-room";

// Stub covering the two tables createSketchRoom touches:
//   - floors: `.eq("id").maybeSingle()` resolves to `opts.floor`. Its
//     default_ceiling_height is seeded as a STRING to mirror PostgREST, which
//     returns numeric columns as strings — the code must coerce it.
//   - rooms: an insert captures the payload and `.single()` echoes it back.
// `inserts.rooms` exposes the captured payload for assertions.
function fakeSupabase(opts: {
  floor: { id: string; default_ceiling_height: string } | null;
}) {
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
        data: table === "floors" ? opts.floor : null,
        error: null,
      }),
      single: async () => ({ data: { id: "room-new", ...captured }, error: null }),
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, inserts };
}

describe("createSketchRoom", () => {
  it("caches M1's measurements using the Floor's default ceiling height when not overridden", async () => {
    const { client, inserts } = fakeSupabase({
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });

    await createSketchRoom(client, {
      organizationId: "org-1",
      floorId: "floor-1",
      name: "Living Room",
      width: 3,
      length: 4,
      ceilingHeightOverride: null,
    });

    const expected = measureRoom({ width: 3, length: 4, ceilingHeight: 8 });
    expect(inserts.rooms).toMatchObject({
      organization_id: "org-1",
      floor_id: "floor-1",
      name: "Living Room",
      width: 3,
      length: 4,
      ceiling_height_override: null,
      floor_area: expected.floorArea,
      ceiling_area: expected.ceilingArea,
      perimeter: expected.perimeter,
      gross_wall_area: expected.grossWallArea,
      net_wall_area: expected.netWallArea,
      volume: expected.volume,
    });
  });

  it("uses the Room's ceiling-height override instead of the Floor default", async () => {
    const { client, inserts } = fakeSupabase({
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });

    await createSketchRoom(client, {
      organizationId: "org-1",
      floorId: "floor-1",
      name: "Tall Room",
      width: 3,
      length: 4,
      ceilingHeightOverride: 10,
    });

    // The override (10), not the Floor default (8), drives wall area + volume.
    const expected = measureRoom({ width: 3, length: 4, ceilingHeight: 10 });
    expect(inserts.rooms).toMatchObject({
      ceiling_height_override: 10,
      gross_wall_area: expected.grossWallArea, // 140, not 112
      volume: expected.volume, // 120, not 96
    });
  });

  it("refuses to write when the Floor is not visible to the caller", async () => {
    const { client } = fakeSupabase({ floor: null });

    await expect(
      createSketchRoom(client, {
        organizationId: "org-1",
        floorId: "ghost-floor",
        name: "Nowhere",
        width: 3,
        length: 4,
        ceilingHeightOverride: null,
      }),
    ).rejects.toThrow(/floor not found/i);
  });
});
