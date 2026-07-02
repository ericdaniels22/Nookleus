import { describe, expect, it } from "vitest";

import type { ChartPalette } from "@/lib/charts/palette";
import { buildInsightLineChart } from "./insight-chart";

// A palette whose values are unmistakable sentinels, so a test can prove a
// color came from the palette (not a hex literal baked into the chart config).
const PALETTE: ChartPalette = {
  series: ["S0", "S1", "S2", "S3", "S4"],
  grid: "GRID",
  axis: "AXIS",
  tooltip: "TOOLTIP",
};

describe("buildInsightLineChart", () => {
  it("colors each series from the palette, cycling once past the five slots", () => {
    // Six metrics: the sixth wraps back to the first palette slot.
    const datasets = Array.from({ length: 6 }, (_, i) => ({
      label: `metric-${i}`,
      data: [i],
    }));

    const { data } = buildInsightLineChart({
      labels: ["Jun 24"],
      datasets,
      palette: PALETTE,
    });

    const borders = data.datasets.map((d) => d.borderColor);
    expect(borders).toEqual(["S0", "S1", "S2", "S3", "S4", "S0"]);
    // The point/fill color tracks the line color for each series.
    expect(data.datasets.map((d) => d.backgroundColor)).toEqual(borders);
  });

  it("draws the grid lines and axis ticks in the palette's grid/axis colors", () => {
    const { options } = buildInsightLineChart({
      labels: ["Jun 24"],
      datasets: [{ label: "calls", data: [9] }],
      palette: PALETTE,
    });

    const scales = options.scales!;
    for (const axis of ["x", "y"] as const) {
      // @ts-expect-error Chart.js scale option unions don't narrow by key here.
      expect(scales[axis]!.grid.color).toBe("GRID");
      // @ts-expect-error same union-narrowing limitation on ticks.
      expect(scales[axis]!.ticks.color).toBe("AXIS");
    }
  });

  it("paints the tooltip surface in the palette's tooltip color", () => {
    const { options } = buildInsightLineChart({
      labels: ["Jun 24"],
      datasets: [{ label: "calls", data: [9] }],
      palette: PALETTE,
    });

    expect(options.plugins!.tooltip!.backgroundColor).toBe("TOOLTIP");
  });
});
