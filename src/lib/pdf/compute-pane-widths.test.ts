import { describe, it, expect } from "vitest";
import { computePaneWidths } from "./compute-pane-widths";

describe("computePaneWidths", () => {
  it("sizes the rail to about a quarter of a normal container width", () => {
    const { railWidth } = computePaneWidths(1000);

    expect(railWidth).toBeGreaterThan(0);
    expect(Math.abs(railWidth - 1000 / 4)).toBeLessThanOrEqual(1000 * 0.02);
  });

  it("subtracts the inter-pane gutter from the page width", () => {
    // rail + gutter + page exactly tile the container — the gutter is the gap
    // between the two panes, taken out of the page (not the rail).
    const { railWidth, pageWidth } = computePaneWidths(1000, { gutter: 24 });

    expect(railWidth + pageWidth).toBe(1000 - 24);
  });

  it("caps the rail width on very wide containers so it stays slim (max clamp)", () => {
    // A literal quarter of 4000 would be 1000px — far too wide for a thumbnail
    // rail. The max clamp keeps it slim.
    const { railWidth } = computePaneWidths(4000, { maxRailWidth: 280 });

    expect(railWidth).toBe(280);
  });

  it("floors the rail width just above the breakpoint so it stays usable (min clamp)", () => {
    // A quarter of 680 is 170px; the min clamp keeps the rail wide enough to be
    // a usable thumbnail column.
    const { railWidth } = computePaneWidths(680, {
      minRailWidth: 180,
      collapseBelow: 640,
    });

    expect(railWidth).toBe(180);
  });

  it("collapses the rail to zero below the narrow/mobile breakpoint", () => {
    const { railWidth, pageWidth } = computePaneWidths(500, {
      collapseBelow: 640,
    });

    expect(railWidth).toBe(0);
    // The document still gets a usable width (minus the gutter for breathing room).
    expect(pageWidth).toBe(500 - 16);
  });

  it("forces the rail closed at any width when explicitly collapsed", () => {
    // The manual collapse toggle and single-page documents both ask the rail to
    // close regardless of how wide the container is.
    const { railWidth, pageWidth } = computePaneWidths(1200, {
      collapsed: true,
    });

    expect(railWidth).toBe(0);
    expect(pageWidth).toBe(1200 - 16);
  });

  it("returns zero widths before the container has been measured", () => {
    expect(computePaneWidths(0)).toEqual({ railWidth: 0, pageWidth: 0 });
  });

  it("never reports a negative page width when a measured container is narrower than the gutter", () => {
    // A measured container thinner than the gutter would otherwise yield a
    // negative page width (8 - 16 = -8), which react-pdf turns into a negative
    // render scale. A measured container always renders at least 1px.
    const { railWidth, pageWidth } = computePaneWidths(8);

    expect(railWidth).toBe(0);
    expect(pageWidth).toBe(1);
  });
});
