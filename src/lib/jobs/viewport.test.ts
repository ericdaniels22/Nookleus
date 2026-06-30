import { describe, expect, it } from "vitest";

import { viewportScale } from "./viewport";

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
