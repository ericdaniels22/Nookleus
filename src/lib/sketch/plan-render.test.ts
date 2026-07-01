// Issue #868 — Sketch S8, the dimensioned-plan render model for a Photo Report.
//
// ADR 0026 §"On-canvas labels are owned here" makes the Photo-Report plan page a
// *separate render* from the interactive Fabric editor: this pure module turns a
// Floor's placed Rooms into a self-contained, PDF-agnostic plan model (a padded
// viewBox in feet, each Room's placed wall polygon, its name + area label, and a
// per-wall dimension label at every edge midpoint) so the @react-pdf page stays
// dumb. It mirrors the editor's own label conventions (plan-canvas.tsx): area as
// "N sq ft", walls as "N'", both via one-decimal-trimmed feet.

import { describe, expect, it } from "vitest";

import { buildSketchPlanRender } from "./plan-render";

describe("buildSketchPlanRender", () => {
  it("renders a single rectangular Room at the floor origin (tracer bullet)", () => {
    const render = buildSketchPlanRender({
      floorName: "Ground Floor",
      rooms: [
        {
          name: "Bedroom",
          // Normalized 12 × 10 rectangle at the floor origin.
          footprint: [
            { x: 0, y: 0 },
            { x: 12, y: 0 },
            { x: 12, y: 10 },
            { x: 0, y: 10 },
          ],
          origin: { x: 0, y: 0 },
          floorArea: 120,
        },
      ],
    });

    expect(render.floorName).toBe("Ground Floor");

    // The viewBox is the room's envelope padded by 1 ft on every side, expressed
    // as a (0,0)-based box so the PDF's <Svg viewBox="0 0 W H"> is trivial.
    expect(render.viewBox).toEqual({ width: 14, height: 12 });

    expect(render.rooms).toHaveLength(1);
    const room = render.rooms[0];

    // The placed polygon is shifted by the padding so the min corner sits at
    // (1, 1), leaving a 1 ft margin from the page edge.
    expect(room.polygon).toEqual([
      { x: 1, y: 1 },
      { x: 13, y: 1 },
      { x: 13, y: 11 },
      { x: 1, y: 11 },
    ]);

    // Name + area label, centered on the footprint's bounding box.
    expect(room.name).toBe("Bedroom");
    expect(room.areaLabel).toBe("120 sq ft");
    expect(room.labelAt).toEqual({ x: 7, y: 6 });

    // A dimension label at every wall's midpoint, walked corner-to-corner and
    // closing the loop: 12', 10', 12', 10'.
    expect(room.wallLabels).toEqual([
      { x: 7, y: 1, text: "12'" },
      { x: 13, y: 6, text: "10'" },
      { x: 7, y: 11, text: "12'" },
      { x: 1, y: 6, text: "10'" },
    ]);
  });

  it("places multiple Rooms in shared floor space and spans them in one viewBox", () => {
    // Two Rooms placed side by side: a 10×8 Kitchen at the origin and a 4×6 Hall
    // shifted 10 ft along x. Each is normalized to its own (0,0) corner, so only
    // the origin distinguishes their placement (ADR 0026). The viewBox must span
    // the whole Floor — 14 ft wide, 8 ft tall — plus the 1 ft margin all round.
    const render = buildSketchPlanRender({
      floorName: "Ground Floor",
      rooms: [
        {
          name: "Kitchen",
          footprint: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 8 },
            { x: 0, y: 8 },
          ],
          origin: { x: 0, y: 0 },
          floorArea: 80,
        },
        {
          name: "Hall",
          footprint: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 6 },
            { x: 0, y: 6 },
          ],
          origin: { x: 10, y: 0 },
          floorArea: 24,
        },
      ],
    });

    expect(render.viewBox).toEqual({ width: 16, height: 10 });
    expect(render.rooms).toHaveLength(2);

    // The Kitchen keeps the min corner at (1,1); the Hall is shifted right by its
    // origin so it butts up against the Kitchen at x = 11.
    expect(render.rooms[0].polygon).toEqual([
      { x: 1, y: 1 },
      { x: 11, y: 1 },
      { x: 11, y: 9 },
      { x: 1, y: 9 },
    ]);
    expect(render.rooms[1].polygon).toEqual([
      { x: 11, y: 1 },
      { x: 15, y: 1 },
      { x: 15, y: 7 },
      { x: 11, y: 7 },
    ]);
  });

  it("skips a half-drawn Room of fewer than three corners", () => {
    // A Room the user is still tapping out (a single wall) has no enclosed shape
    // to render, so it is dropped rather than drawn as a degenerate sliver.
    const render = buildSketchPlanRender({
      floorName: "Ground Floor",
      rooms: [
        {
          name: "Started",
          footprint: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
          origin: { x: 0, y: 0 },
          floorArea: 0,
        },
      ],
    });

    expect(render.rooms).toHaveLength(0);
  });

  it("collapses an empty Floor to a bare padded viewBox", () => {
    // A Floor with no Rooms still yields a valid, drawable page: a 2×2 ft box
    // (padding on each side) with nothing inside.
    const render = buildSketchPlanRender({ floorName: "Empty", rooms: [] });

    expect(render.viewBox).toEqual({ width: 2, height: 2 });
    expect(render.rooms).toEqual([]);
  });
});
