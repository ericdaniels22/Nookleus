// Issue #861 — M3, the Room-measurement pull resolver.
//
// A pure module between M1 (measure-room, "how big is this space") and the
// Estimate: given a Room's measurements and a chosen measurement kind, it
// returns the single number a line item freezes into its `quantity` (CONTEXT.md
// "Room"; ADR 0025 — a line item pulls its quantity from a Room measurement as a
// re-pullable snapshot). No persistence, no I/O — the mapping and the freeze
// live in one testable spot, reused identically by the pull API route.

import { round2 } from "../format";
import type { RoomMeasurements } from "./measure-room";
import {
  objectCountValue,
  type ObjectCategory,
  type ObjectInventory,
} from "./object-inventory";

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
 * What a line item's `quantity` can be pulled from, as stable wire names: one of
 * the six Room measurements, or `object_count` — a count of one object category
 * (#867). Widening the kind (rather than adding a new scope) lets object counts
 * ride the SAME room/floor/sketch scope union: an object_count pull also names a
 * Room, Floor, or the whole Sketch, and additionally carries an `object_category`
 * (below). `object_count` is a count, never billed for footage/area.
 */
export type PullKind = RoomMeasurementKind | "object_count";

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
 * The fields every `sketch_source` breadcrumb carries, whatever its scope. It is
 * a *snapshot*, not a live link (ADR 0004): the `value` frozen here is what the
 * line item shows and bills, and editing or deleting the Sketch afterward never
 * changes it. The scope-specific breadcrumbs (ids, names) that follow are soft —
 * captured at pull time so the badge reads correctly even after a later rename.
 */
interface SketchSourceBase {
  sketch_id: string;
  kind: PullKind;
  /** The frozen pulled number — equals the line item's `quantity`. */
  value: number;
  /** ISO timestamp of the pull (injected — this module does no I/O). */
  pulled_at: string;
  /**
   * The object category this pull counted — present ONLY when `kind` is
   * `object_count` (#867). An object_count pull is scoped by category, so the
   * breadcrumb must record WHICH category's count was frozen (so the badge reads
   * "3 Cabinets", and a re-pick knows what to re-count); a measurement pull omits
   * it entirely.
   */
  object_category?: ObjectCategory;
}

/** A quantity pulled from a single Room's measurement. */
export interface RoomSketchSource extends SketchSourceBase {
  scope: "room";
  floor_id: string;
  room_id: string;
  /** Room name as it read at pull time — a display snapshot for the badge. */
  room_name: string;
}

/** A quantity pulled from a Floor's aggregate total (M2 sums the Floor's Rooms). */
export interface FloorSketchSource extends SketchSourceBase {
  scope: "floor";
  floor_id: string;
  /** Floor name as it read at pull time — a display snapshot for the badge. */
  floor_name: string;
}

/** A quantity pulled from the whole-Sketch total (M2 sums every Floor). */
export interface WholeSketchSource extends SketchSourceBase {
  scope: "sketch";
}

/**
 * The breadcrumb a line item stores in its nullable `sketch_source` column when
 * its `quantity` was pulled from a Sketch. A discriminated union on `scope`: a
 * pull is taken from one Room, one Floor's total, or the whole Sketch's total
 * (ADR 0026 — the Estimate pull supports Floor and whole-Sketch scope alongside
 * room scope). `scope` is the discriminant the badge switches on.
 */
export type SketchSource =
  | RoomSketchSource
  | FloorSketchSource
  | WholeSketchSource;

/**
 * The display name a source badge shows for a pulled line item, per scope: the
 * Room's name, the Floor's name, or "Whole Sketch". Kept here beside the union so
 * the badge switches on `scope` in one place and can't miss a variant.
 */
export function sketchSourceLabel(source: SketchSource): string {
  switch (source.scope) {
    case "room":
      return source.room_name;
    case "floor":
      return source.floor_name;
    case "sketch":
      return "Whole Sketch";
  }
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
  /**
   * The Room's count-only object inventory (M1 `objectInventory(...)`), every
   * known category present (0 when absent), so the picker can preview
   * `objects[category]` before an object_count pull freezes it (#867).
   */
  objects: ObjectInventory;
}

/**
 * One Floor as the picker sees it for a Floor-scoped pull: its identity and its
 * aggregate totals (M2 `aggregateFloor(...)`) keyed by pull kind, so the picker
 * previews `measurements[kind]` before freezing the Floor total.
 */
export interface SketchFloorOption {
  id: string;
  name: string;
  measurements: Record<RoomMeasurementKind, number>;
  /** The Floor's object inventory — its Rooms' summed (M1 `sumInventories`). */
  objects: ObjectInventory;
}

/**
 * The whole Sketch as the picker sees it for a Sketch-scoped pull: its identity
 * and its aggregate totals (M2 `aggregateSketch(...)`) keyed by pull kind. `null`
 * in the feed when the estimate's job has no Sketch (or an empty one) yet.
 */
export interface SketchTotalsOption {
  sketch_id: string;
  measurements: Record<RoomMeasurementKind, number>;
  /** The whole-Sketch object inventory — every Floor's summed (M1 `sumInventories`). */
  objects: ObjectInventory;
}

/**
 * The whole "Pull from Sketch" picker feed: the Rooms, each Floor's totals, and
 * the whole-Sketch total. One object because one GET (`/sketch/rooms`) returns
 * them together — the picker offers all three scopes off a single load. `sketch`
 * is null when the estimate's job has no Sketch (or an empty one) yet.
 */
export interface SketchPickerFeed {
  rooms: SketchRoomOption[];
  floors: SketchFloorOption[];
  sketch: SketchTotalsOption | null;
}

/**
 * What the picker hands back on Pull, discriminated by scope — the shape the
 * pull route accepts. Room and Floor carry their id; the whole-Sketch pull needs
 * none. Every scope names a measurement kind.
 */
export type SketchPullArgs =
  | { scope: "room"; roomId: string; kind: RoomMeasurementKind }
  | { scope: "floor"; floorId: string; kind: RoomMeasurementKind }
  | { scope: "sketch"; kind: RoomMeasurementKind };

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
  source: RoomSketchSource;
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

// ── Object-count pulls (#867, S7) ────────────────────────────────────────────
// The count half of M3: instead of a Room's *size*, an object_count pull freezes
// the *count* of one object category (M1 object-inventory) into a line item's
// quantity — a detach-&-reset line priced per appliance reads its category's
// count. Same freeze contract as a measurement pull (the resolved count is copied
// into both `quantity` and the snapshot), same room/floor/sketch scopes; the
// source additionally records the `object_category` counted, and its kind is the
// widened `object_count`.

export interface ResolveRoomObjectPullInput {
  /** The Room's object inventory (M1 `objectInventory(...)`). */
  inventory: ObjectInventory;
  /** Which category to count — the pull is scoped by it. */
  category: ObjectCategory;
  sketchId: string;
  floorId: string;
  roomId: string;
  roomName: string;
  /** ISO pull timestamp — injected so the resolver stays pure/deterministic. */
  pulledAt: string;
}

/**
 * Resolve a Room-scoped object_count pull: freeze the chosen category's count.
 * The count is read once and copied into both `value` (the line item's quantity)
 * and the snapshot, so a later re-count of the Room never moves the frozen number.
 * The breadcrumb records `object_category` so the badge and any re-pick know which
 * category was counted.
 */
export function resolveRoomObjectPull(
  input: ResolveRoomObjectPullInput,
): RoomPull {
  const value = objectCountValue(input.inventory, input.category);
  return {
    value,
    source: {
      scope: "room",
      sketch_id: input.sketchId,
      floor_id: input.floorId,
      room_id: input.roomId,
      room_name: input.roomName,
      kind: "object_count",
      object_category: input.category,
      value,
      pulled_at: input.pulledAt,
    },
  };
}

export interface ResolveFloorObjectPullInput {
  /** The Floor's rolled-up inventory (M1 `sumInventories` over its Rooms). */
  inventory: ObjectInventory;
  category: ObjectCategory;
  sketchId: string;
  floorId: string;
  floorName: string;
  /** ISO pull timestamp — injected so the resolver stays pure/deterministic. */
  pulledAt: string;
}

/**
 * Resolve a Floor-scoped object_count pull. The Floor's rolled-up inventory shares
 * the same `ObjectInventory` shape as a Room's, so the count reads identically;
 * the breadcrumb is Floor-scoped (a floor_name, no room ids) and records the
 * `object_category` counted.
 */
export function resolveFloorObjectPull(
  input: ResolveFloorObjectPullInput,
): FloorPull {
  const value = objectCountValue(input.inventory, input.category);
  return {
    value,
    source: {
      scope: "floor",
      sketch_id: input.sketchId,
      floor_id: input.floorId,
      floor_name: input.floorName,
      kind: "object_count",
      object_category: input.category,
      value,
      pulled_at: input.pulledAt,
    },
  };
}

export interface ResolveSketchObjectPullInput {
  /** The whole-Sketch rolled-up inventory (M1 `sumInventories` over every Floor). */
  inventory: ObjectInventory;
  category: ObjectCategory;
  sketchId: string;
  /** ISO pull timestamp — injected so the resolver stays pure/deterministic. */
  pulledAt: string;
}

/**
 * Resolve a whole-Sketch object_count pull. Same count + freeze as the Room and
 * Floor object resolvers, but the breadcrumb carries only the Sketch identity and
 * the `object_category`, since the count spans every Floor and Room.
 */
export function resolveSketchObjectPull(
  input: ResolveSketchObjectPullInput,
): WholeSketchPull {
  const value = objectCountValue(input.inventory, input.category);
  return {
    value,
    source: {
      scope: "sketch",
      sketch_id: input.sketchId,
      kind: "object_count",
      object_category: input.category,
      value,
      pulled_at: input.pulledAt,
    },
  };
}

// ── Re-pull (#864, S3) ───────────────────────────────────────────────────────
// The re-pull half of the snapshot contract (ADR 0025): a frozen Sketch-sourced
// line item can be refreshed from the live Sketch, but only on an explicit user
// action and only after they've seen old-vs-new. This pure step computes that
// diff (and packages the refreshed source) from the existing frozen `source` and
// the Room's *current* measurements — the route does the I/O of reading them.

export interface RepullOk {
  status: "ok";
  /**
   * The line item's *current* quantity — the "old" side of the diff, i.e. the
   * value the re-pull is about to replace. This is deliberately the live quantity
   * and NOT `source.value` (the last-pulled number): a quantity hand-edited since
   * the pull would otherwise be silently discarded behind a stale-looking diff.
   */
  oldValue: number;
  /** The value re-read from the live Room for the same kind — the "new" side. */
  newValue: number;
  /** Whether the quantity would actually change (`newValue !== oldValue`). */
  changed: boolean;
  /**
   * The source to persist on confirm: the frozen breadcrumb with only `value`
   * and `pulled_at` refreshed. Room identity/kind stay frozen — a re-pull
   * refreshes the same source, it doesn't re-point it. Re-pull is Room-scoped
   * (#864 predates the Floor/Sketch scope union), so this is always a
   * {@link RoomSketchSource}.
   */
  source: RoomSketchSource;
}

/**
 * The source Room (or its Floor/Sketch) no longer exists, so there is nothing
 * to re-pull from. Carries no `source`, so a caller can never accidentally write
 * a mutated breadcrumb down this path — the frozen quantity is left untouched
 * (#864 AC #4).
 */
export interface RepullSourceMissing {
  status: "source-missing";
}

export type RepullResolution = RepullOk | RepullSourceMissing;

/**
 * The old-vs-new preview the client shows before a re-pull is confirmed — the
 * wire shape of {@link RepullOk} minus the source, in the route's snake_case.
 */
export interface RepullPreview {
  old_value: number;
  new_value: number;
  changed: boolean;
}

export interface ResolveRoomRepullInput {
  /**
   * The line item's existing frozen `sketch_source` breadcrumb. Re-pull is
   * Room-scoped, so the caller must narrow to a {@link RoomSketchSource} before
   * resolving (Floor/Sketch-sourced lines re-pick through the pull picker).
   */
  source: RoomSketchSource;
  /**
   * The source Room's *current* measurements, or `null` when the Room (or its
   * Floor/Sketch) no longer exists — the re-pull's "deleted source" signal.
   */
  measurements: RoomMeasurements | null;
  /**
   * The line item's current `quantity` — the value the re-pull replaces, reported
   * as the diff's old side so the confirmation is truthful even when the quantity
   * was hand-edited away from `source.value` since the last pull.
   */
  currentQuantity: number;
  /** ISO timestamp of this re-pull (injected — this module does no I/O). */
  pulledAt: string;
}

/**
 * Re-pull the frozen source against the Room's current measurements. When the
 * Room is gone (`measurements === null`) the result is `source-missing` and no
 * refreshed source is produced — the caller must leave the line item alone.
 * Otherwise it reads the same `source.kind` off the live measurements as the new
 * value, reports the line's current quantity as the old value, and packages a
 * refreshed source (new `value` + `pulled_at`, everything else frozen) to persist
 * on confirm.
 */
export function resolveRoomRepull(input: ResolveRoomRepullInput): RepullResolution {
  if (input.measurements === null) {
    return { status: "source-missing" };
  }
  if (input.source.kind === "object_count") {
    // Re-pull refreshes a MEASUREMENT source against live measurements; an
    // object_count source has no measurement to re-read (object re-pull is not
    // part of #864's flow, and the route never offers it). Reject rather than
    // silently mis-resolve. Excluding the literal also narrows `kind` below to a
    // RoomMeasurementKind, so roomMeasurementValue's lookup stays total.
    throw new RangeError(
      "resolveRoomRepull: object_count sources are not re-pullable",
    );
  }
  const oldValue = input.currentQuantity;
  // Normalise the live measurement to the billed 2-decimal precision. A line
  // item's `quantity` is numeric(10,2) while Room measurements are numeric(14,3),
  // so a raw measurement like 250.567 was stored as 250.57. Comparing the raw
  // measurement against the current quantity would report an unchanged Sketch as
  // "changed" on every re-pull; rounding to the quantity's own precision makes the
  // diff (and the refreshed `value`) reflect what actually gets billed.
  const newValue = round2(roomMeasurementValue(input.measurements, input.source.kind));
  return {
    status: "ok",
    oldValue,
    newValue,
    changed: newValue !== oldValue,
    source: { ...input.source, value: newValue, pulled_at: input.pulledAt },
  };
}

export interface ResolveFloorPullInput {
  /** The Floor's aggregate totals (M2 `aggregateFloor(...).measurements`). */
  measurements: RoomMeasurements;
  kind: RoomMeasurementKind;
  sketchId: string;
  floorId: string;
  floorName: string;
  /** ISO pull timestamp — injected so the resolver stays pure/deterministic. */
  pulledAt: string;
}

export interface FloorPull {
  /** The number to freeze into the line item's `quantity`. */
  value: number;
  /** The breadcrumb to store in the line item's `sketch_source`. */
  source: FloorSketchSource;
}

/**
 * Resolve a Floor-scoped pull. The Floor's aggregate totals share M1's
 * `RoomMeasurements` shape, so the same kind→field lookup reads a Floor total
 * exactly as it reads a Room's — and the freeze works identically: the resolved
 * `value` is copied into both the quantity and the Floor-scoped snapshot.
 */
export function resolveFloorPull(input: ResolveFloorPullInput): FloorPull {
  const value = roomMeasurementValue(input.measurements, input.kind);
  return {
    value,
    source: {
      scope: "floor",
      sketch_id: input.sketchId,
      floor_id: input.floorId,
      floor_name: input.floorName,
      kind: input.kind,
      value,
      pulled_at: input.pulledAt,
    },
  };
}

export interface ResolveSketchPullInput {
  /** The whole-Sketch aggregate totals (M2 `aggregateSketch(...).measurements`). */
  measurements: RoomMeasurements;
  kind: RoomMeasurementKind;
  sketchId: string;
  /** ISO pull timestamp — injected so the resolver stays pure/deterministic. */
  pulledAt: string;
}

export interface WholeSketchPull {
  /** The number to freeze into the line item's `quantity`. */
  value: number;
  /** The breadcrumb to store in the line item's `sketch_source`. */
  source: WholeSketchSource;
}

/**
 * Resolve a whole-Sketch pull. Same kind→field lookup and freeze as the Room and
 * Floor resolvers — the Sketch's aggregate totals share M1's `RoomMeasurements`
 * shape — but the breadcrumb carries only the Sketch identity, since the total
 * spans every Floor and Room.
 */
export function resolveSketchPull(input: ResolveSketchPullInput): WholeSketchPull {
  const value = roomMeasurementValue(input.measurements, input.kind);
  return {
    value,
    source: {
      scope: "sketch",
      sketch_id: input.sketchId,
      kind: input.kind,
      value,
      pulled_at: input.pulledAt,
    },
  };
}
