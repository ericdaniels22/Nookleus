// Issue #865 — Sketch S5: the adapter that feeds the editor's saved Rooms into
// the M2 aggregator for the Statistics panel.
//
// The editor's `Room` (src/lib/types.ts) carries its cached M1 measurements in
// snake_case wire fields (`floor_area`, `gross_wall_area`…); the pure M2
// aggregator speaks M1's camelCase `RoomMeasurements`. This thin, pure layer
// bridges the two and rolls a Floor's Rooms — and a Sketch's Floors — into the
// totals the panel renders, so the mapping lives in one unit-tested spot.

import { describe, expect, it } from "vitest";

import type { Room } from "@/lib/types";
import { floorStatistics, roomContribution, sketchStatistics } from "./room-stats";

// A Room fixture with only its measurement fields that matter here set; every
// other column is filled with an inert default so the test reads as measurements.
function makeRoom(measurements: {
  floor_area: number;
  ceiling_area: number;
  perimeter: number;
  gross_wall_area: number;
  net_wall_area: number;
  volume: number;
}): Room {
  return {
    id: "rm",
    organization_id: "org",
    floor_id: "fl",
    name: "Room",
    footprint: [],
    origin: { x: 0, y: 0 },
    width: 0,
    length: 0,
    ceiling_height_override: null,
    sort_order: 0,
    created_at: "2026-06-30T00:00:00.000Z",
    updated_at: "2026-06-30T00:00:00.000Z",
    ...measurements,
  };
}

describe("floorStatistics", () => {
  it("rolls the Floor's saved Rooms into its totals and counts them", () => {
    // Two Rooms with distinct cached measurements so a dropped or crossed term
    // shows up: a 3×4×8 Room (floor 12, gross wall 112, volume 96) and a 5×6×8
    // Room (floor 30, gross wall 176, volume 240).
    const floor = floorStatistics([
      makeRoom({
        floor_area: 12,
        ceiling_area: 12,
        perimeter: 14,
        gross_wall_area: 112,
        net_wall_area: 112,
        volume: 96,
      }),
      makeRoom({
        floor_area: 30,
        ceiling_area: 30,
        perimeter: 22,
        gross_wall_area: 176,
        net_wall_area: 176,
        volume: 240,
      }),
    ]);

    expect(floor.measurements.floorArea).toBe(42); // 12 + 30
    expect(floor.measurements.grossWallArea).toBe(288); // 112 + 176
    expect(floor.measurements.volume).toBe(336); // 96 + 240
    expect(floor.counts.rooms).toBe(2);
    // Openings aren't modeled, so a saved Room contributes zero of each.
    expect(floor.counts.doors).toBe(0);
    expect(floor.counts.windows).toBe(0);
  });
});

describe("sketchStatistics", () => {
  it("sums every Floor's Rooms into whole-Sketch totals, empty Floors included", () => {
    // A three-Floor Sketch: a house Floor (one 10×10×8 Room → floor 100, volume
    // 800), an empty Floor just added (no Rooms → zeros), and a detached-garage
    // Floor (one 20×20×8 Room → floor 400, volume 3200). The whole-Sketch total
    // folds all three — the empty Floor adds nothing, the detached one is not
    // dropped.
    const house = [
      makeRoom({
        floor_area: 100,
        ceiling_area: 100,
        perimeter: 40,
        gross_wall_area: 320,
        net_wall_area: 320,
        volume: 800,
      }),
    ];
    const emptyFloor: Room[] = [];
    const detachedGarage = [
      makeRoom({
        floor_area: 400,
        ceiling_area: 400,
        perimeter: 80,
        gross_wall_area: 640,
        net_wall_area: 640,
        volume: 3200,
      }),
    ];

    const sketch = sketchStatistics([house, emptyFloor, detachedGarage]);

    expect(sketch.measurements.floorArea).toBe(500); // 100 + 0 + 400
    expect(sketch.measurements.volume).toBe(4000); // 800 + 0 + 3200
    expect(sketch.counts.rooms).toBe(2); // the empty Floor adds no Room
  });
});

describe("roomContribution", () => {
  it("maps a Room's snake_case cache to the aggregator's camelCase measurements", () => {
    // The one crossing point between the wire Room and M1's field names — each
    // distinct value proves its field maps to the right camelCase key.
    const contribution = roomContribution(
      makeRoom({
        floor_area: 12,
        ceiling_area: 13,
        perimeter: 14,
        gross_wall_area: 112,
        net_wall_area: 100,
        volume: 96,
      }),
    );

    expect(contribution.measurements).toEqual({
      floorArea: 12,
      ceilingArea: 13,
      perimeter: 14,
      grossWallArea: 112,
      netWallArea: 100,
      volume: 96,
    });
  });
});
