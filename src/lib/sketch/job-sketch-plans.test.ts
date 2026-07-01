import { describe, expect, it } from "vitest";

import { buildJobSketchPlans } from "./job-sketch-plans";
import type { Point } from "./footprint";

// A width × length rectangle walked from the origin — the 4-point footprint a
// simple Room stores (normalized, min corner at 0,0).
const rect = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

describe("buildJobSketchPlans", () => {
  it("builds one plan per Floor, grouping Rooms by floor and labeling area from floor_area", () => {
    const floors = [
      { id: "f1", name: "Ground Floor" },
      { id: "f2", name: "Second Floor" },
    ];
    const rooms = [
      {
        floor_id: "f1",
        name: "Bedroom",
        footprint: rect(12, 10),
        origin: { x: 0, y: 0 },
        floor_area: 120,
      },
      {
        floor_id: "f2",
        name: "Office",
        footprint: rect(8, 8),
        origin: { x: 0, y: 0 },
        floor_area: 64,
      },
    ];

    const plans = buildJobSketchPlans(floors, rooms);

    expect(plans.map((p) => p.floorName)).toEqual([
      "Ground Floor",
      "Second Floor",
    ]);
    expect(plans[0].rooms[0].name).toBe("Bedroom");
    expect(plans[0].rooms[0].areaLabel).toBe("120 sq ft");
    expect(plans[1].rooms[0].name).toBe("Office");
    expect(plans[1].rooms[0].areaLabel).toBe("64 sq ft");
  });

  it("skips a Floor whose Rooms are absent or still being drawn (no blank plan page)", () => {
    const floors = [
      { id: "f1", name: "Ground Floor" },
      { id: "f2", name: "Attic" }, // no Rooms at all
      { id: "f3", name: "Basement" }, // only a half-drawn 2-point Room
    ];
    const rooms = [
      {
        floor_id: "f1",
        name: "Bedroom",
        footprint: rect(12, 10),
        origin: { x: 0, y: 0 },
        floor_area: 120,
      },
      {
        floor_id: "f3",
        name: "WIP",
        footprint: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        origin: { x: 0, y: 0 },
        floor_area: 0,
      },
    ];

    const plans = buildJobSketchPlans(floors, rooms);

    // Only the Floor with a fully drawn Room becomes a page.
    expect(plans.map((p) => p.floorName)).toEqual(["Ground Floor"]);
  });

  it("returns no plans when the Sketch has no Floors", () => {
    expect(buildJobSketchPlans([], [])).toEqual([]);
  });
});
