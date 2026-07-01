// Issue #865 — Sketch S5: the adapter that feeds the editor's saved Rooms into
// the M2 aggregator for the Statistics panel.
//
// The editor's `Room` (src/lib/types.ts) carries its cached M1 measurements in
// snake_case wire fields; the pure M2 aggregator (`aggregate.ts`) speaks M1's
// camelCase `RoomMeasurements`. This thin, pure layer is the one place the two
// meet: it maps a Room to a `RoomContribution` and rolls a Floor's Rooms — and a
// Sketch's Floors — into the totals the panel renders. No I/O, so the panel's
// numbers are unit-testable without a canvas.

import type { Room } from "@/lib/types";
import {
  aggregateFloor,
  aggregateSketch,
  type RoomContribution,
  type SketchAggregate,
} from "./aggregate";

/**
 * One saved Room as an M2 contribution: its cached snake_case measurements mapped
 * to M1's camelCase shape, plus its door/window counts tallied from the Room's
 * openings by kind (#866). A Room with no openings contributes 0 of each.
 */
export function roomContribution(room: Room): RoomContribution {
  const openings = room.openings ?? [];
  return {
    measurements: {
      floorArea: room.floor_area,
      ceilingArea: room.ceiling_area,
      perimeter: room.perimeter,
      grossWallArea: room.gross_wall_area,
      netWallArea: room.net_wall_area,
      volume: room.volume,
    },
    doors: openings.filter((o) => o.type === "door").length,
    windows: openings.filter((o) => o.type === "window").length,
  };
}

/** A Floor's totals: sum its saved Rooms' cached measurements (M2). */
export function floorStatistics(rooms: Room[]): SketchAggregate {
  return aggregateFloor(rooms.map(roomContribution));
}

/**
 * The whole-Sketch totals: sum every Floor's totals (M2). Each entry is one
 * Floor's Rooms; a detached-structure Floor is just another entry and folds into
 * the total like any other (CONTEXT.md "Floor").
 */
export function sketchStatistics(roomsByFloor: Room[][]): SketchAggregate {
  return aggregateSketch(roomsByFloor.map(floorStatistics));
}
