// Issue #867 — Sketch S7: the pure Room object inventory.
//
// A Room carries a list of placed known objects (cabinets, appliances, fixtures);
// this module is the single source of truth for "what's in this space, by
// category" (CONTEXT.md "Room": a Room carries its detected objects). Objects are
// an inventory and COUNT source only — never billed for footage or area — so the
// engine here reduces a Room's objects to per-category counts. Pure: no
// persistence, no I/O — so the count rule lives in one unit-tested spot, reused
// by the object_count Estimate pull (M3) and the editor's inventory readout.

/**
 * The known object categories a Room can hold, as stable snake_case identifiers.
 * These are the persisted, wire-facing names (they land on a `room_objects` row,
 * in the `object_category` a pull is scoped by, and in the picker). The later
 * LiDAR mapper (Apple RoomPlan) writes its detected objects into these same
 * categories, so this list is the target that capture path maps onto.
 */
export const OBJECT_CATEGORIES = [
  "cabinets",
  "refrigerator",
  "stove",
  "oven",
  "dishwasher",
  "washer_dryer",
  "sink",
  "toilet",
  "bathtub",
  "furniture",
] as const;

export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number];

/**
 * Human-readable labels for the object categories — the vocabulary the picker
 * dropdown and the source badge render, kept beside the wire names so the two
 * never drift (mirrors ROOM_MEASUREMENT_KIND_LABELS). "Washer / Dryer" pairs the
 * laundry unit; the rest read as their plain trade names.
 */
export const OBJECT_CATEGORY_LABELS: Record<ObjectCategory, string> = {
  cabinets: "Cabinets",
  refrigerator: "Refrigerator",
  stove: "Stove",
  oven: "Oven",
  dishwasher: "Dishwasher",
  washer_dryer: "Washer / Dryer",
  sink: "Sink",
  toilet: "Toilet",
  bathtub: "Bathtub",
  furniture: "Furniture",
};

/** One placed object, reduced to what the count cares about: its category. */
export interface HasCategory {
  category: ObjectCategory;
}

/** A Room / Floor / Sketch object inventory: a count per known category. */
export type ObjectInventory = Record<ObjectCategory, number>;

/** A zero inventory — every known category at 0. The empty-Room answer. */
function zeroInventory(): ObjectInventory {
  const out = {} as ObjectInventory;
  for (const category of OBJECT_CATEGORIES) out[category] = 0;
  return out;
}

/**
 * Reduce a Room's placed objects to per-category counts. Every known category is
 * present (0 when the Room has none), so a reader can look up any category
 * without a missing-key branch.
 */
export function objectInventory(objects: HasCategory[]): ObjectInventory {
  const inventory = zeroInventory();
  for (const object of objects) inventory[object.category] += 1;
  return inventory;
}

/**
 * Roll a set of Room inventories up into a Floor / Sketch inventory: the
 * per-category sum of its parts (CONTEXT.md "Floor": a Floor's totals aggregate
 * its Rooms). The same monoid at every tier — a Sketch inventory sums its Floors'
 * inventories, which sum their Rooms' — so this one addition serves both roll-ups.
 * `sumInventories([])` is the identity (all zeros): the empty-Floor answer.
 */
export function sumInventories(parts: ObjectInventory[]): ObjectInventory {
  const total = zeroInventory();
  for (const part of parts) {
    for (const category of OBJECT_CATEGORIES) total[category] += part[category];
  }
  return total;
}

/**
 * Read one category's count out of an inventory — the number an `object_count`
 * pull freezes onto a line item (#867). Guards an unknown category (a bad value
 * off the wire) with a RangeError rather than letting `undefined` flow onward as
 * a NaN quantity, mirroring `roomMeasurementValue`'s guard on an unknown kind.
 */
export function objectCountValue(
  inventory: ObjectInventory,
  category: ObjectCategory,
): number {
  if (!(OBJECT_CATEGORIES as readonly string[]).includes(category)) {
    throw new RangeError(`objectCountValue: unknown category "${category}"`);
  }
  return inventory[category];
}
