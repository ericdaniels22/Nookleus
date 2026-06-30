import { describe, expect, it } from "vitest";

import { screenToSceneLength, viewportPoint, viewportScale } from "./viewport";

describe("viewportScale — the on-screen zoom factor of a viewport transform", () => {
  it("reports unit scale for the identity transform", () => {
    expect(viewportScale([1, 0, 0, 1, 0, 0])).toBe(1);
  });

  it("reads the magnification factor when zoomed in, ignoring pan", () => {
    // Zoom 3×, panned by (150, -40): the scale is independent of the translation.
    expect(viewportScale([3, 0, 0, 3, 150, -40])).toBe(3);
  });

  it("handles a fractional zoom for a partly zoomed-out view", () => {
    expect(viewportScale([0.5, 0, 0, 0.5, 0, 0])).toBe(0.5);
  });

  it("falls back to unit scale when no transform exists yet", () => {
    // Fabric reports no viewportTransform until the canvas is initialised; chrome
    // sizes are divided by the result, so it must never be null or zero.
    expect(viewportScale(null)).toBe(1);
    expect(viewportScale(undefined)).toBe(1);
  });

  it("falls back to unit scale for a degenerate zero scale", () => {
    expect(viewportScale([0, 0, 0, 0, 0, 0])).toBe(1);
  });
});

describe("viewportPoint — mapping a scene point to its on-screen position", () => {
  it("maps through zoom and pan: screen = zoom·scene + pan", () => {
    // Zoom 2×, panned by (100, 50). A scene point (30, 40) lands at
    // (2·30 + 100, 2·40 + 50) on the canvas surface.
    expect(viewportPoint([2, 0, 0, 2, 100, 50], 30, 40)).toEqual({
      x: 160,
      y: 130,
    });
  });

  it("is the identity at fit-zoom so anchoring is unchanged at 1:1", () => {
    // The whole no-regression guarantee: at the identity transform a scene
    // point is its own screen point, so callers behave exactly as before.
    expect(viewportPoint([1, 0, 0, 1, 0, 0], 30, 40)).toEqual({ x: 30, y: 40 });
  });

  it("treats a missing transform as the identity", () => {
    // Fabric has no viewportTransform until the canvas initialises; callers
    // must still get a usable point rather than NaN.
    expect(viewportPoint(null, 30, 40)).toEqual({ x: 30, y: 40 });
    expect(viewportPoint(undefined, 30, 40)).toEqual({ x: 30, y: 40 });
  });
});

describe("screenToSceneLength — a constant on-screen distance in scene units", () => {
  it("shrinks the scene length when zoomed in so the on-screen feel is constant", () => {
    // 8 screen px is only 4 scene px when magnified 2×.
    expect(screenToSceneLength(8, [2, 0, 0, 2, 0, 0])).toBe(4);
  });

  it("grows the scene length when zoomed out", () => {
    // 8 screen px is 16 scene px at half zoom — so snapping stays reachable.
    expect(screenToSceneLength(8, [0.5, 0, 0, 0.5, 0, 0])).toBe(16);
  });

  it("returns the length unchanged at fit-zoom (and when no transform exists)", () => {
    expect(screenToSceneLength(8, [1, 0, 0, 1, 0, 0])).toBe(8);
    expect(screenToSceneLength(8, null)).toBe(8);
  });
});
