import { describe, expect, it } from "vitest";

import SketchPlanPage from "./sketch-plan-page";
import { collectText, expandTree, findAll } from "./test-helpers";
import type { PlanRender } from "@/lib/sketch/plan-render";

function makePlan(overrides: Partial<PlanRender> = {}): PlanRender {
  return {
    floorName: "Ground Floor",
    viewBox: { width: 14, height: 12 },
    rooms: [
      {
        polygon: [
          { x: 1, y: 1 },
          { x: 13, y: 1 },
          { x: 13, y: 11 },
          { x: 1, y: 11 },
        ],
        name: "Bedroom",
        areaLabel: "120 sq ft",
        labelAt: { x: 7, y: 6 },
        wallLabels: [
          { x: 7, y: 1, text: "12'" },
          { x: 13, y: 6, text: "10'" },
          { x: 7, y: 11, text: "12'" },
          { x: 1, y: 6, text: "10'" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("SketchPlanPage", () => {
  it("renders the Floor name and each Room's name and area label (AC2)", () => {
    // The plan page names the Floor and, for every placed Room, prints its name
    // and dimensioned area — the identifying text a reader scans first.
    const tree = expandTree(<SketchPlanPage plan={makePlan()} />);
    const text = collectText(tree);

    expect(text).toContain("Ground Floor");
    expect(text).toContain("Bedroom");
    expect(text).toContain("120 sq ft");
  });

  it("draws one wall polygon per Room and a dimension label at every wall (AC2)", () => {
    const plan = makePlan({
      viewBox: { width: 16, height: 10 },
      rooms: [
        {
          polygon: [
            { x: 1, y: 1 },
            { x: 11, y: 1 },
            { x: 11, y: 9 },
            { x: 1, y: 9 },
          ],
          name: "Kitchen",
          areaLabel: "80 sq ft",
          labelAt: { x: 6, y: 5 },
          wallLabels: [
            { x: 6, y: 1, text: "10'" },
            { x: 11, y: 5, text: "8'" },
            { x: 6, y: 9, text: "10'" },
            { x: 1, y: 5, text: "8'" },
          ],
        },
        {
          polygon: [
            { x: 11, y: 1 },
            { x: 15, y: 1 },
            { x: 15, y: 7 },
            { x: 11, y: 7 },
          ],
          name: "Hall",
          areaLabel: "24 sq ft",
          labelAt: { x: 13, y: 4 },
          wallLabels: [
            { x: 13, y: 1, text: "4'" },
            { x: 15, y: 4, text: "6'" },
            { x: 13, y: 7, text: "4'" },
            { x: 11, y: 4, text: "6'" },
          ],
        },
      ],
    });

    const tree = expandTree(<SketchPlanPage plan={plan} />);

    // One closed polygon per placed Room.
    const polygons = findAll(tree, (n) => n.type === "POLYGON");
    expect(polygons).toHaveLength(2);
    // The first Room's polygon carries its placed corners as an SVG points list.
    expect(polygons[0].props.points).toBe("1,1 11,1 11,9 1,9");

    // Every wall's dimension label is drawn (both Rooms, all four walls each).
    const text = collectText(tree);
    for (const dim of ["10'", "8'", "4'", "6'"]) {
      expect(text).toContain(dim);
    }
    expect(text).toContain("Kitchen");
    expect(text).toContain("Hall");
  });

  it("carries the plan's viewBox onto the Svg so the drawing scales to the Floor", () => {
    const tree = expandTree(
      <SketchPlanPage plan={makePlan({ viewBox: { width: 14, height: 12 } })} />,
    );

    const svgs = findAll(tree, (n) => n.type === "SVG");
    expect(svgs).toHaveLength(1);
    expect(svgs[0].props.viewBox).toBe("0 0 14 12");
  });

  it("renders an empty Floor as a plan page — Floor name, no room polygons", () => {
    // A Floor with no placed Rooms (all still being drawn) still composes as a
    // page: it names the Floor and shows an empty-state note, drawing no polygon.
    const tree = expandTree(
      <SketchPlanPage
        plan={makePlan({ viewBox: { width: 2, height: 2 }, rooms: [] })}
      />,
    );

    expect(collectText(tree)).toContain("Ground Floor");
    expect(findAll(tree, (n) => n.type === "POLYGON")).toHaveLength(0);
  });
});
