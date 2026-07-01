// Issue #861 — M3, the Room-measurement pull resolver.
//
// A pure module between M1 (measure-room, "how big is this space") and the
// Estimate: given a Room's measurements and a chosen measurement kind, it
// returns the single number a line item freezes into its `quantity` (CONTEXT.md
// "Room"; ADR 0025 — a line item pulls its quantity from a Room measurement as a
// re-pullable snapshot). No persistence, no I/O — the mapping and the freeze
// live in one testable spot, reused identically by the pull API route.

import type { RoomMeasurements } from "./measure-room";

/**
 * The measurements a Room can be pulled for, as stable snake_case identifiers.
 * These are the persisted, wire-facing names (they land in `sketch_source` and
 * in the picker); the map below is the only place they meet M1's camelCase
 * fields. Net wall area is the default wall measurement for a pull (#861), but
 * gross is offered too.
 */
export const ROOM_MEASUREMENT_KINDS = [
  "floor_area",
  "ceiling_area",
  "wall_area_net",
  "wall_area_gross",
  "perimeter",
  "volume",
] as const;

export type RoomMeasurementKind = (typeof ROOM_MEASUREMENT_KINDS)[number];

/**
 * Human-readable labels for the pull kinds — the vocabulary the picker dropdown
 * and the source badge both render, kept beside the wire names so the two never
 * drift. "Net wall area" is the default wall measurement (#861); "Gross wall
 * area" is offered alongside it.
 */
export const ROOM_MEASUREMENT_KIND_LABELS: Record<RoomMeasurementKind, string> = {
  floor_area: "Floor area",
  ceiling_area: "Ceiling area",
  wall_area_net: "Net wall area",
  wall_area_gross: "Gross wall area",
  perimeter: "Perimeter",
  volume: "Volume",
};

/** The one place snake_case pull kinds meet M1's camelCase measurement fields. */
const KIND_TO_FIELD: Record<RoomMeasurementKind, keyof RoomMeasurements> = {
  floor_area: "floorArea",
  ceiling_area: "ceilingArea",
  wall_area_net: "netWallArea",
  wall_area_gross: "grossWallArea",
  perimeter: "perimeter",
  volume: "volume",
};

/**
 * Resolve one Room measurement to the number a line item freezes into its
 * `quantity`. Pure: no rounding, no I/O — just the kind→field lookup.
 */
export function roomMeasurementValue(
  measurements: RoomMeasurements,
  kind: RoomMeasurementKind,
): number {
  const field = KIND_TO_FIELD[kind];
  if (!field) {
    throw new RangeError(`roomMeasurementValue: unknown kind "${kind}"`);
  }
  return measurements[field];
}

/**
 * The breadcrumb a line item stores in its nullable `sketch_source` column when
 * its `quantity` was pulled from a Room. It is a *snapshot*, not a live link
 * (ADR 0004): the `value` frozen here is what the line item shows and bills, and
 * the ids/`room_name` are soft breadcrumbs for the badge — editing or deleting
 * the Sketch afterward never changes the frozen value. `room_name` is captured
 * at pull time so the badge reads correctly even if the Room is later renamed.
 */
export interface SketchSource {
  /** Room scope only for #861; the field leaves room for Floor/Sketch scope. */
  scope: "room";
  sketch_id: string;
  floor_id: string;
  room_id: string;
  /** Room name as it read at pull time — a display snapshot for the badge. */
  room_name: string;
  kind: RoomMeasurementKind;
  /** The frozen pulled number — equals the line item's `quantity`. */
  value: number;
  /** ISO timestamp of the pull (injected — this module does no I/O). */
  pulled_at: string;
}

/**
 * One Room as the "Pull from Sketch" picker sees it: identity, its Floor's name
 * for grouping, and its six measurements already keyed by pull kind so the
 * picker can preview `measurements[kind]` before freezing it. This is the shape
 * the `GET /api/estimates/[id]/sketch/rooms` feed returns and the editor picker
 * consumes — kept beside the kinds so feed and UI can't drift.
 */
export interface SketchRoomOption {
  id: string;
  name: string;
  floor_id: string;
  floor_name: string;
  measurements: Record<RoomMeasurementKind, number>;
}

export interface ResolveRoomPullInput {
  measurements: RoomMeasurements;
  kind: RoomMeasurementKind;
  sketchId: string;
  floorId: string;
  roomId: string;
  roomName: string;
  /** ISO pull timestamp — injected so the resolver stays pure/deterministic. */
  pulledAt: string;
}

export interface RoomPull {
  /** The number to freeze into the line item's `quantity`. */
  value: number;
  /** The breadcrumb to store in the line item's `sketch_source`. */
  source: SketchSource;
}

/**
 * Resolve a Room measurement and package the freeze: the returned `value` is
 * copied into both the line item's `quantity` and the `source.value` snapshot,
 * so the two can never disagree and the pull is frozen the moment it is taken.
 */
export function resolveRoomPull(input: ResolveRoomPullInput): RoomPull {
  const value = roomMeasurementValue(input.measurements, input.kind);
  return {
    value,
    source: {
      scope: "room",
      sketch_id: input.sketchId,
      floor_id: input.floorId,
      room_id: input.roomId,
      room_name: input.roomName,
      kind: input.kind,
      value,
      pulled_at: input.pulledAt,
    },
  };
}
