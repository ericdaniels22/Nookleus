import { describe, expect, it } from "vitest";

import { placeLabelPill } from "./label-pill-placement";

describe("placeLabelPill — edge-aware Label pill placement within the canvas", () => {
  it("leaves a non-edge pill hanging below its host, unchanged", () => {
    // Pill comfortably inside an 800×600 canvas: top-centre at (100, 200),
    // 80 wide, 30 tall. Nothing to flip or clamp.
    const placed = placeLabelPill(
      { x: 100, y: 200 }, // belowAnchor — pill top-centre
      { x: 100, y: 150 }, // aboveAnchor — pill bottom-centre (unused here)
      { width: 80, height: 30 },
      { width: 800, height: 600 }
    );

    expect(placed.x).toBeCloseTo(100 - 80 / 2, 5); // top-left x = centre − halfW
    expect(placed.y).toBeCloseTo(200, 5); // top-left y = belowAnchor.y
  });

  it("flips the pill above its host when hanging below would spill off the bottom", () => {
    // Host sits low: below-anchor at y=590 in a 600-tall canvas, so a 30-tall
    // pill (bottom at 620) overflows. It must flip to hang above, with its
    // bottom-centre at the above-anchor.
    const placed = placeLabelPill(
      { x: 100, y: 590 }, // belowAnchor — would put the pill at 590..620
      { x: 100, y: 500 }, // aboveAnchor — pill bottom-centre when flipped above
      { width: 80, height: 30 },
      { width: 800, height: 600 }
    );

    expect(placed.x).toBeCloseTo(100 - 80 / 2, 5);
    expect(placed.y).toBeCloseTo(500 - 30, 5); // top = aboveAnchor.y − height
  });

  it("clamps a wide pill near the right edge so its right side isn't clipped", () => {
    // Centre at x=780 with a 100-wide pill would run to x=830, past the 800
    // canvas edge. Clamp so the pill's right edge sits exactly on the canvas.
    const placed = placeLabelPill(
      { x: 780, y: 200 },
      { x: 780, y: 150 },
      { width: 100, height: 30 },
      { width: 800, height: 600 }
    );

    expect(placed.x).toBeCloseTo(800 - 100, 5); // right edge == canvas width
    expect(placed.y).toBeCloseTo(200, 5);
  });

  it("clamps a pill near the left edge so its left side isn't clipped", () => {
    // Centre at x=10 with a 100-wide pill would run to x=−40. Pin it to 0.
    const placed = placeLabelPill(
      { x: 10, y: 200 },
      { x: 10, y: 150 },
      { width: 100, height: 30 },
      { width: 800, height: 600 }
    );

    expect(placed.x).toBeCloseTo(0, 5); // left edge == 0
    expect(placed.y).toBeCloseTo(200, 5);
  });

  it("clamps y so a flipped pill on a tall edge host isn't clipped at the top", () => {
    // Host fills the frame: below (y=595) overflows the bottom so it flips, but
    // the above-anchor (y=20) would put the pill's top at −10. Pin it to 0.
    const placed = placeLabelPill(
      { x: 100, y: 595 },
      { x: 100, y: 20 },
      { width: 80, height: 30 },
      { width: 800, height: 600 }
    );

    expect(placed.y).toBeCloseTo(0, 5); // top edge == 0
  });
});
