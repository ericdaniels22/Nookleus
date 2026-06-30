import { describe, expect, it } from "vitest";

import { LABEL_GAP, labelAnchorPoint, readableTextColor } from "./label-pill";

describe("labelAnchorPoint — where a Label pill anchors beneath its host", () => {
  it("sits the pill just below an unrotated object, horizontally centred", () => {
    const anchor = labelAnchorPoint({
      centerX: 100,
      centerY: 100,
      width: 40,
      height: 60,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
    });

    expect(anchor.x).toBeCloseTo(100, 5);
    expect(anchor.y).toBeCloseTo(100 + 30 + LABEL_GAP, 5);
  });

  it("measures the offset from the scaled height, not the raw height", () => {
    const anchor = labelAnchorPoint({
      centerX: 100,
      centerY: 100,
      width: 40,
      height: 60,
      scaleX: 1,
      scaleY: 2,
      angle: 0,
    });

    // scaled half-height = 60 * 2 / 2 = 60, plus the gap
    expect(anchor.x).toBeCloseTo(100, 5);
    expect(anchor.y).toBeCloseTo(100 + 60 + LABEL_GAP, 5);
  });

  it("tracks the object's centre when it is moved", () => {
    const anchor = labelAnchorPoint({
      centerX: 250,
      centerY: 80,
      width: 40,
      height: 60,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
    });

    expect(anchor.x).toBeCloseTo(250, 5);
    expect(anchor.y).toBeCloseTo(80 + 30 + LABEL_GAP, 5);
  });

  it("swings the anchor a quarter-turn when the object is rotated 90°", () => {
    const anchor = labelAnchorPoint({
      centerX: 100,
      centerY: 100,
      width: 40,
      height: 60,
      scaleX: 1,
      scaleY: 1,
      angle: 90,
    });

    // straight-down offset (0, 42) rotated 90° clockwise points left
    const offset = 30 + LABEL_GAP;
    expect(anchor.x).toBeCloseTo(100 - offset, 5);
    expect(anchor.y).toBeCloseTo(100, 5);
  });

  it("places the anchor above the centre when the object is rotated 180°", () => {
    const anchor = labelAnchorPoint({
      centerX: 100,
      centerY: 100,
      width: 40,
      height: 60,
      scaleX: 1,
      scaleY: 1,
      angle: 180,
    });

    const offset = 30 + LABEL_GAP;
    expect(anchor.x).toBeCloseTo(100, 5);
    expect(anchor.y).toBeCloseTo(100 - offset, 5);
  });
});

describe("readableTextColor — legible pill text against the fill", () => {
  it("uses near-black text on the light palette fills", () => {
    // Yellow and White are the light pill fills in the annotator palette.
    expect(readableTextColor("#F59E0B")).toBe("#1A1A1A");
    expect(readableTextColor("#FFFFFF")).toBe("#1A1A1A");
  });

  it("uses white text on the dark palette fills", () => {
    expect(readableTextColor("#C41E2A")).toBe("#FFFFFF"); // Red
    expect(readableTextColor("#2B5EA7")).toBe("#FFFFFF"); // Blue
    expect(readableTextColor("#0F6E56")).toBe("#FFFFFF"); // Green
    expect(readableTextColor("#1A1A1A")).toBe("#FFFFFF"); // Black
  });

  it("tolerates a 3-digit hex and a missing leading hash", () => {
    expect(readableTextColor("#fff")).toBe("#1A1A1A");
    expect(readableTextColor("000")).toBe("#FFFFFF");
  });
});
