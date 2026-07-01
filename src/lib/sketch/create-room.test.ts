// Issue #860 / #879 — persisting a Room. The app is the single writer of a
// Room's cached measurement columns (migration-build88): it computes them
// server-side from M1 so the cache can never drift from the geometry. S2 (#879)
// makes the input a drawn polygon footprint instead of width × length; the
// bounding box still backfills the legacy width/length columns. This pins that
// the write path
//   - measures the FOOTPRINT at the EFFECTIVE ceiling height (the Floor default
//     unless the Room overrides it),
//   - persists the footprint and its bounding-box dimensions together, and
//   - refuses to write against a Floor the caller can't see.
// The pure geometry is M1's own test; the round-trip against real tables is the
// pg test. Here a chainable Supabase stub lets us assert the exact insert payload.

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SketchOpening } from "@/lib/types";
import { createSketchRoom } from "./create-room";
import { boundingBox, rectangleFootprint, type Point } from "./footprint";
import { measureFootprint } from "./measure-room";

// An L-shaped footprint the rectangle model could not express: a 4×4 square with
// a 2×2 bite removed — area 12, bounding box 4 × 4.
const L_SHAPE: Point[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 2 },
  { x: 2, y: 2 },
  { x: 2, y: 4 },
  { x: 0, y: 4 },
];

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
    const footprint = rectangleFootprint(3, 4);

    await createSketchRoom(client, {
      organizationId: "org-1",
      floorId: "floor-1",
      name: "Living Room",
      footprint,
      ceilingHeightOverride: null,
    });

    const expected = measureFootprint({ footprint, ceilingHeight: 8 });
    expect(inserts.rooms).toMatchObject({
      organization_id: "org-1",
      floor_id: "floor-1",
      name: "Living Room",
      footprint,
      width: 3, // bounding box of the rectangle
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
    const footprint = rectangleFootprint(3, 4);

    await createSketchRoom(client, {
      organizationId: "org-1",
      floorId: "floor-1",
      name: "Tall Room",
      footprint,
      ceilingHeightOverride: 10,
    });

    // The override (10), not the Floor default (8), drives wall area + volume.
    const expected = measureFootprint({ footprint, ceilingHeight: 10 });
    expect(inserts.rooms).toMatchObject({
      ceiling_height_override: 10,
      gross_wall_area: expected.grossWallArea, // 140, not 112
      volume: expected.volume, // 120, not 96
    });
  });

  it("measures an arbitrary footprint and backfills width/length from its bounding box", async () => {
    const { client, inserts } = fakeSupabase({
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });

    await createSketchRoom(client, {
      organizationId: "org-1",
      floorId: "floor-1",
      name: "L Room",
      footprint: L_SHAPE,
      ceilingHeightOverride: null,
    });

    const expected = measureFootprint({ footprint: L_SHAPE, ceilingHeight: 8 });
    const bbox = boundingBox(L_SHAPE);
    expect(inserts.rooms).toMatchObject({
      footprint: L_SHAPE,
      width: bbox.width, // 4 — the envelope, not a wall
      length: bbox.length, // 4
      floor_area: expected.floorArea, // 12, the true polygon area (not 16)
      perimeter: expected.perimeter, // 16
    });
  });

  it("normalizes an off-origin drawn footprint, storing the shape at (0,0) and its origin", async () => {
    // ADR 0026: a Room is drawn in floor coordinates, but its footprint is stored
    // NORMALIZED (min corner at 0,0) with the drawn position lifted into `origin`.
    // The measurements are position-invariant, so they match either way.
    const { client, inserts } = fakeSupabase({
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });
    // A 3×4 rectangle drawn at (10, 20) — its min corner is not the origin.
    const drawn: Point[] = [
      { x: 10, y: 20 },
      { x: 13, y: 20 },
      { x: 13, y: 24 },
      { x: 10, y: 24 },
    ];

    await createSketchRoom(client, {
      organizationId: "org-1",
      floorId: "floor-1",
      name: "Placed Room",
      footprint: drawn,
      ceilingHeightOverride: null,
    });

    const expected = measureFootprint({ footprint: drawn, ceilingHeight: 8 });
    expect(inserts.rooms).toMatchObject({
      // Stored normalized, not where it was drawn.
      footprint: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
        { x: 0, y: 4 },
      ],
      origin: { x: 10, y: 20 },
      width: 3,
      length: 4,
      floor_area: expected.floorArea, // 12 — unchanged by the move
      perimeter: expected.perimeter, // 14
    });
  });

  it("stores a (0,0) origin for a footprint already drawn at the origin", async () => {
    const { client, inserts } = fakeSupabase({
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });

    await createSketchRoom(client, {
      organizationId: "org-1",
      floorId: "floor-1",
      name: "At Origin",
      footprint: rectangleFootprint(3, 4),
      ceilingHeightOverride: null,
    });

    expect(inserts.rooms).toMatchObject({ origin: { x: 0, y: 0 } });
  });

  it("stores the Room's openings and deducts their area from net wall area (#866)", async () => {
    // #866 — a Room's doors/windows are persisted alongside the geometry and the
    // cache is the SINGLE writer: net wall area is gross minus the openings, so
    // the stored net can never drift from the stored openings. A 3×4 Room at 8ft
    // has gross wall 112; a 3×7 door (21) and a 3×5 window (15) net it to 76.
    const { client, inserts } = fakeSupabase({
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });
    const footprint = rectangleFootprint(3, 4);
    const openings: SketchOpening[] = [
      { type: "door", width: 3, height: 7, wall_index: 0, offset: 1 },
      { type: "window", width: 3, height: 5, wall_index: 1, offset: 1 },
    ];

    await createSketchRoom(client, {
      organizationId: "org-1",
      floorId: "floor-1",
      name: "Room With Openings",
      footprint,
      ceilingHeightOverride: null,
      openings,
    });

    const expected = measureFootprint({ footprint, ceilingHeight: 8, openings });
    expect(inserts.rooms).toMatchObject({
      openings,
      gross_wall_area: expected.grossWallArea, // 112
      net_wall_area: expected.netWallArea, // 76 = 112 − 21 − 15
    });
  });

  it("stores no openings as an empty list when the Room has none (#866)", async () => {
    const { client, inserts } = fakeSupabase({
      floor: { id: "floor-1", default_ceiling_height: "8" },
    });

    await createSketchRoom(client, {
      organizationId: "org-1",
      floorId: "floor-1",
      name: "No Openings",
      footprint: rectangleFootprint(3, 4),
      ceilingHeightOverride: null,
    });

    // Net equals gross when there are no openings, and the column is [] not null.
    expect(inserts.rooms).toMatchObject({
      openings: [],
      gross_wall_area: 112,
      net_wall_area: 112,
    });
  });

  it("refuses to write when the Floor is not visible to the caller", async () => {
    const { client } = fakeSupabase({ floor: null });

    await expect(
      createSketchRoom(client, {
        organizationId: "org-1",
        floorId: "ghost-floor",
        name: "Nowhere",
        footprint: rectangleFootprint(3, 4),
        ceilingHeightOverride: null,
      }),
    ).rejects.toThrow(/floor not found/i);
  });
});
