// Issue #865 — Sketch S5, M2: the Floor / Sketch measurement aggregator.
//
// The pure roll-up above M1 (measure-room). A Floor's totals sum its Rooms; a
// Sketch's totals sum its Floors (CONTEXT.md "Floor": a Floor's totals — surface
// area, volume, room/door/window counts — aggregate its Rooms). No persistence,
// no I/O — just addition — so the "how big is this level / whole plan" rule lives
// in one unit-tested spot, feeding both the Statistics panel and the
// Floor/Sketch-scoped Estimate pull (#865).

import type { RoomMeasurements } from "./measure-room";

/**
 * The room / door / window tallies a Floor or Sketch reports. Doors and windows
 * are 0 until openings are modeled (S5 acceptance criteria); `rooms` counts the
 * Rooms rolled into this total.
 */
export interface SketchCounts {
  rooms: number;
  doors: number;
  windows: number;
}

/**
 * A Floor's or Sketch's totals: the summed M1 measurements plus the counts. Both
 * levels share one shape because a Sketch total is just the sum of Floor totals,
 * which are the sum of Room totals — the same monoid at every tier.
 */
export interface SketchAggregate {
  measurements: RoomMeasurements;
  counts: SketchCounts;
}

/**
 * One Room's contribution to its Floor: its M1 measurements and, once modeled,
 * its opening counts. `doors`/`windows` default to 0 — no Room carries openings
 * yet, so a Floor's opening counts stay 0 until they do.
 */
export interface RoomContribution {
  measurements: RoomMeasurements;
  doors?: number;
  windows?: number;
}

// A Floor total is the sum of its Rooms; a Sketch total is the sum of its
// Floors. Both are the same operation — add two totals field by field, starting
// from zero — so the addition lives once here and both public roll-ups reduce
// over it. `sumAggregates([])` is the identity (all zeros), which is exactly the
// empty-Floor / empty-Sketch answer.
function zeroAggregate(): SketchAggregate {
  return {
    measurements: {
      floorArea: 0,
      ceilingArea: 0,
      perimeter: 0,
      grossWallArea: 0,
      netWallArea: 0,
      volume: 0,
    },
    counts: { rooms: 0, doors: 0, windows: 0 },
  };
}

function addInto(acc: SketchAggregate, part: SketchAggregate): SketchAggregate {
  acc.measurements.floorArea += part.measurements.floorArea;
  acc.measurements.ceilingArea += part.measurements.ceilingArea;
  acc.measurements.perimeter += part.measurements.perimeter;
  acc.measurements.grossWallArea += part.measurements.grossWallArea;
  acc.measurements.netWallArea += part.measurements.netWallArea;
  acc.measurements.volume += part.measurements.volume;
  acc.counts.rooms += part.counts.rooms;
  acc.counts.doors += part.counts.doors;
  acc.counts.windows += part.counts.windows;
  return acc;
}

function sumAggregates(parts: SketchAggregate[]): SketchAggregate {
  // Reduce into a fresh zero — `addInto` only reads each `part`, so the caller's
  // Floor/Room totals are never mutated by being summed.
  return parts.reduce(addInto, zeroAggregate());
}

/** One Room seen as a single-Room total: its measurements, and a Room count of 1. */
function roomAggregate(room: RoomContribution): SketchAggregate {
  return {
    measurements: room.measurements,
    counts: { rooms: 1, doors: room.doors ?? 0, windows: room.windows ?? 0 },
  };
}

/**
 * Sum a Floor's Rooms into the Floor's totals. The Room count is the number of
 * contributions; door/window counts sum their per-Room tallies (0 until openings
 * exist). An empty Floor sums to zeros.
 */
export function aggregateFloor(rooms: RoomContribution[]): SketchAggregate {
  return sumAggregates(rooms.map(roomAggregate));
}

/**
 * Sum a Sketch's Floors into whole-Sketch totals. A detached structure is modeled
 * as its own Floor (CONTEXT.md "Floor"), so passing every Floor — including a
 * "Detached Garage" — rolls it into the Sketch total like any other. An empty
 * Sketch sums to zeros.
 */
export function aggregateSketch(floors: SketchAggregate[]): SketchAggregate {
  return sumAggregates(floors);
}
