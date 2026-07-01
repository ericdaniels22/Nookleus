// Issue #867 — Sketch S7: the pure Room object inventory.
//
// A Room carries a list of placed known objects (cabinets, appliances, fixtures);
// this module is the single source of truth for "what's in this space, by
// category" (CONTEXT.md "Room": a Room carries its detected objects). Objects are
// an inventory and COUNT source only — never billed for footage or area — so the
// engine here reduces a Room's objects to per-category counts, rolls those counts
// up across Floors/Sketch, and reads the count for one category (the number an
// `object_count` pull freezes). Pure: no persistence, no I/O.

import { describe, expect, it } from "vitest";

import {
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_LABELS,
  objectCountValue,
  objectInventory,
  sumInventories,
} from "./object-inventory";

describe("objectInventory", () => {
  it("counts a Room's objects by category", () => {
    // Two base cabinets and a fridge in a kitchen: the inventory reports 2
    // cabinets and 1 refrigerator, the count each `object_count` pull reads.
    const inventory = objectInventory([
      { category: "cabinets" },
      { category: "cabinets" },
      { category: "refrigerator" },
    ]);

    expect(inventory.cabinets).toBe(2);
    expect(inventory.refrigerator).toBe(1);
  });

  it("reports 0 for every category of an empty Room", () => {
    // A Room with no objects yet still answers for every known category, so a
    // reader (a pull, the editor readout) never hits a missing key.
    const inventory = objectInventory([]);
    for (const category of OBJECT_CATEGORIES) {
      expect(inventory[category]).toBe(0);
    }
  });
});

describe("objectCountValue", () => {
  it("reads the count for the chosen category — the number an object_count pull freezes", () => {
    // The `object_count` pull is scoped BY category (#867): a detach-&-reset line
    // priced per appliance reads only its own category's count, not the Room's
    // total. Here three appliances of different kinds each read as 1, and an
    // absent category reads as 0 — never undefined.
    const inventory = objectInventory([
      { category: "refrigerator" },
      { category: "stove" },
      { category: "dishwasher" },
    ]);

    expect(objectCountValue(inventory, "refrigerator")).toBe(1);
    expect(objectCountValue(inventory, "stove")).toBe(1);
    expect(objectCountValue(inventory, "dishwasher")).toBe(1);
    expect(objectCountValue(inventory, "toilet")).toBe(0);
  });

  it("rejects an unknown category instead of returning undefined", () => {
    // A bad category from the wire must surface as an error, not flow onward as an
    // `undefined` quantity that later reads as NaN in an Estimate total (mirrors
    // roomMeasurementValue's guard on an unknown kind).
    expect(() =>
      objectCountValue(objectInventory([]), "microwave" as never),
    ).toThrow();
  });
});

describe("sumInventories", () => {
  it("rolls Room inventories up into a Floor/Sketch inventory, per category", () => {
    // A Floor's object counts are the per-category sum of its Rooms (mirrors the
    // measurement roll-up): a kitchen with cabinets+fridge and a bath with a
    // toilet+sink report, at the Floor, the union of both — the same monoid that
    // lets a Sketch total sum its Floors' totals.
    const kitchen = objectInventory([
      { category: "cabinets" },
      { category: "cabinets" },
      { category: "refrigerator" },
    ]);
    const bath = objectInventory([
      { category: "toilet" },
      { category: "sink" },
    ]);

    const floor = sumInventories([kitchen, bath]);

    expect(floor.cabinets).toBe(2);
    expect(floor.refrigerator).toBe(1);
    expect(floor.toilet).toBe(1);
    expect(floor.sink).toBe(1);
    expect(floor.stove).toBe(0);
  });

  it("sums to all-zeros for an empty Floor/Sketch", () => {
    // No Rooms (an empty Floor, or a Sketch with no Floors) still answers for
    // every known category — the identity of the roll-up.
    const empty = sumInventories([]);
    for (const category of OBJECT_CATEGORIES) {
      expect(empty[category]).toBe(0);
    }
  });
});

describe("OBJECT_CATEGORY_LABELS", () => {
  it("labels every known category — the picker/badge never renders a raw wire name", () => {
    // The picker dropdown and the source badge render these; every category must
    // carry a non-empty human label so no snake_case identifier leaks to the UI
    // (mirrors ROOM_MEASUREMENT_KIND_LABELS covering every kind).
    for (const category of OBJECT_CATEGORIES) {
      expect(OBJECT_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});
