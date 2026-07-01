// Issue #890 — mutating a placed Room. The full-screen editor moves a Room (drag
// → new origin), renames it, and overrides its ceiling height from the inspector.
// updateSketchRoom is the single write path for all three: a partial patch that
// touches ONLY what changed, recomputing the cached measurements exactly when the
// ceiling height (and nothing else) requires it. Moving is position-only, so it
// must never disturb the footprint or the measurement cache (ADR 0026). The pure
// geometry is M1's own test; here a chainable Supabase stub asserts the exact
// update payload.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { updateSketchRoom } from "./update-room";
import { rectangleFootprint } from "./footprint";
import { measureFootprint } from "./measure-room";

// A chainable stub over the `rooms` (read + update) and `floors` (read) tables.
//   - `.update(payload)` captures the payload into `updates.rooms` and `.single()`
//     echoes it back as the updated row.
//   - `.maybeSingle()` resolves the seeded room/floor read (for the recompute
//     path). default_ceiling_height is a STRING, mirroring PostgREST's numerics.
function fakeSupabase(opts: {
  room?: Record<string, unknown> | null;
  floor?: { default_ceiling_height: string } | null;
}) {
  const updates: Record<string, Record<string, unknown>> = {};
  function from(table: string) {
    let captured: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      update: (payload: Record<string, unknown>) => {
        updates[table] = payload;
        captured = payload;
        return builder;
      },
      maybeSingle: async () => ({
        data: table === "rooms" ? opts.room ?? null : opts.floor ?? null,
        error: null,
      }),
      single: async () => ({ data: { id: "room-1", ...captured }, error: null }),
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, updates };
}

describe("updateSketchRoom", () => {
  it("moves a Room by writing only its origin, leaving the shape and cache untouched", async () => {
    // ADR 0026: a move is position-only. The patch carries the new origin and
    // NOTHING else — no footprint, no measurement columns.
    const { client, updates } = fakeSupabase({});

    await updateSketchRoom(client, { roomId: "room-1", origin: { x: 5, y: 7 } });

    expect(updates.rooms).toEqual({ origin: { x: 5, y: 7 } });
  });

  it("renames a Room without touching its geometry or cache", async () => {
    const { client, updates } = fakeSupabase({});

    await updateSketchRoom(client, { roomId: "room-1", name: "Primary Bedroom" });

    expect(updates.rooms).toEqual({ name: "Primary Bedroom" });
  });

  it("recomputes the six cached measurements when the ceiling-height override changes", async () => {
    // migration-build88 / ADR 0024: the app is the single writer of the cache.
    // Changing the effective ceiling height re-derives all six measurements from
    // the STORED footprint — position-invariant, so origin never enters — while
    // leaving the footprint and origin untouched. The override value is stored
    // alongside so a later read knows the height was pinned, not inherited.
    const footprint = rectangleFootprint(3, 4);
    const { client, updates } = fakeSupabase({
      room: { id: "room-1", footprint, floor_id: "floor-1" },
      floor: { default_ceiling_height: "8" },
    });

    await updateSketchRoom(client, {
      roomId: "room-1",
      ceilingHeightOverride: 10,
    });

    // The override (10), not the Floor default (8), drives wall area + volume.
    const expected = measureFootprint({ footprint, ceilingHeight: 10 });
    expect(updates.rooms).toEqual({
      ceiling_height_override: 10,
      floor_area: expected.floorArea,
      ceiling_area: expected.ceilingArea,
      perimeter: expected.perimeter,
      gross_wall_area: expected.grossWallArea, // 140, not 112
      net_wall_area: expected.netWallArea,
      volume: expected.volume, // 120, not 96
    });
  });

  it("clears the override, re-measuring at the Floor's default ceiling height", async () => {
    // Passing null drops the pin: the Room inherits the Floor default (8), and
    // the cache is recomputed at that height. The stored override becomes null.
    const footprint = rectangleFootprint(3, 4);
    const { client, updates } = fakeSupabase({
      room: { id: "room-1", footprint, floor_id: "floor-1" },
      floor: { default_ceiling_height: "8" },
    });

    await updateSketchRoom(client, {
      roomId: "room-1",
      ceilingHeightOverride: null,
    });

    const expected = measureFootprint({ footprint, ceilingHeight: 8 });
    expect(updates.rooms).toEqual({
      ceiling_height_override: null,
      floor_area: expected.floorArea,
      ceiling_area: expected.ceilingArea,
      perimeter: expected.perimeter,
      gross_wall_area: expected.grossWallArea, // 112 at the default height
      net_wall_area: expected.netWallArea,
      volume: expected.volume, // 96
    });
  });
});
