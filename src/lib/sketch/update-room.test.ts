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

import type { SketchOpening } from "@/lib/types";
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

  it("reshapes a Room from a new footprint — re-normalizing its position and recomputing the cache", async () => {
    // Issue #862: editing walls/corners sends the reworked footprint back in
    // PLACED floor coordinates. Persisting mirrors create-room (ADR 0026): split
    // the placed shape into a normalized footprint (min corner → 0,0) plus the
    // origin it was drawn at, backfill width/length from the bounding box, and
    // recompute all six measurements from the new shape at the effective ceiling
    // height. Here the Room has no override, so it inherits the Floor default (8).
    const placed = [
      { x: 2, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 9 },
      { x: 2, y: 9 },
    ];
    const { client, updates } = fakeSupabase({
      room: {
        id: "room-1",
        footprint: rectangleFootprint(3, 4),
        floor_id: "floor-1",
        ceiling_height_override: null,
      },
      floor: { default_ceiling_height: "8" },
    });

    await updateSketchRoom(client, { roomId: "room-1", footprint: placed });

    // The placed 5×6 rectangle normalizes to the origin, lifting (2,3) into origin.
    const expected = measureFootprint({
      footprint: rectangleFootprint(5, 6),
      ceilingHeight: 8,
    });
    expect(updates.rooms).toEqual({
      footprint: rectangleFootprint(5, 6),
      origin: { x: 2, y: 3 },
      width: 5,
      length: 6,
      floor_area: expected.floorArea,
      ceiling_area: expected.ceilingArea,
      perimeter: expected.perimeter,
      gross_wall_area: expected.grossWallArea,
      net_wall_area: expected.netWallArea,
      volume: expected.volume,
    });
  });

  it("reshapes a Room that pins its ceiling, measuring the new shape at the pinned height", async () => {
    // A footprint edit carries no ceiling change, so the effective height is the
    // Room's own stored override (10) — NOT the Floor default (8). Wall area and
    // volume must reflect the pinned height, and the override is left as-is.
    const placed = rectangleFootprint(5, 6);
    const { client, updates } = fakeSupabase({
      room: {
        id: "room-1",
        footprint: rectangleFootprint(3, 4),
        floor_id: "floor-1",
        ceiling_height_override: "10",
      },
      floor: { default_ceiling_height: "8" },
    });

    await updateSketchRoom(client, { roomId: "room-1", footprint: placed });

    const expected = measureFootprint({
      footprint: rectangleFootprint(5, 6),
      ceilingHeight: 10,
    });
    // No ceiling_height_override key — the pin is untouched by a reshape.
    expect(updates.rooms).toEqual({
      footprint: rectangleFootprint(5, 6),
      origin: { x: 0, y: 0 },
      width: 5,
      length: 6,
      floor_area: expected.floorArea,
      ceiling_area: expected.ceilingArea,
      perimeter: expected.perimeter,
      gross_wall_area: expected.grossWallArea,
      net_wall_area: expected.netWallArea,
      volume: expected.volume,
    });
  });

  it("edits a Room's openings — storing them and deducting their area from net wall area (#866)", async () => {
    // #866: adding/removing doors and windows re-derives the cache (the app is the
    // single writer of net wall area). An openings-only edit measures the STORED
    // footprint at the STORED effective height, deducts the NEW openings, and
    // stores them — it does not touch the footprint, origin, or ceiling override.
    const footprint = rectangleFootprint(3, 4);
    const openings: SketchOpening[] = [
      { type: "door", width: 3, height: 7, wall_index: 0, offset: 1 },
      { type: "window", width: 3, height: 5, wall_index: 1, offset: 1 },
    ];
    const { client, updates } = fakeSupabase({
      room: { id: "room-1", footprint, floor_id: "floor-1", openings: [] },
      floor: { default_ceiling_height: "8" },
    });

    await updateSketchRoom(client, { roomId: "room-1", openings });

    const expected = measureFootprint({ footprint, ceilingHeight: 8, openings });
    expect(updates.rooms).toEqual({
      openings,
      floor_area: expected.floorArea,
      ceiling_area: expected.ceilingArea,
      perimeter: expected.perimeter,
      gross_wall_area: expected.grossWallArea, // 112
      net_wall_area: expected.netWallArea, // 76 = 112 − 21 − 15
      volume: expected.volume,
    });
  });

  it("preserves a Room's stored openings deduction when only the ceiling height changes (#866)", async () => {
    // The single-writer invariant across edits: a ceiling-only change re-measures,
    // but the Room's EXISTING openings must still be deducted — net wall area must
    // not silently reset to gross. Room already has a 3×7 door (21) stored; raising
    // the ceiling to 10 lifts gross to 140, and net is 140 − 21 = 119.
    const footprint = rectangleFootprint(3, 4);
    const stored: SketchOpening[] = [
      { type: "door", width: 3, height: 7, wall_index: 0, offset: 1 },
    ];
    const { client, updates } = fakeSupabase({
      room: { id: "room-1", footprint, floor_id: "floor-1", openings: stored },
      floor: { default_ceiling_height: "8" },
    });

    await updateSketchRoom(client, { roomId: "room-1", ceilingHeightOverride: 10 });

    const expected = measureFootprint({
      footprint,
      ceilingHeight: 10,
      openings: stored,
    });
    // No `openings` key — a ceiling-only edit doesn't rewrite the openings list,
    // but the recomputed net must still reflect the stored door.
    expect(updates.rooms).toEqual({
      ceiling_height_override: 10,
      floor_area: expected.floorArea,
      ceiling_area: expected.ceilingArea,
      perimeter: expected.perimeter,
      gross_wall_area: expected.grossWallArea, // 140
      net_wall_area: expected.netWallArea, // 119 = 140 − 21
      volume: expected.volume,
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
