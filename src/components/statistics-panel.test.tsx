// Issue #865 — Sketch S5: the Statistics panel. It reads the M2 roll-up
// (aggregate.ts) and shows the active Floor's totals alongside the whole-Sketch
// totals — surface area (the summed floor area, the MagicPlan headline), volume,
// and the room / door / window counts. This is pure presentation over a
// `SketchAggregate`; the numbers themselves are unit-tested in the aggregator.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { StatisticsPanel } from "./statistics-panel";
import type { SketchAggregate } from "@/lib/sketch/aggregate";

function makeAggregate(over: {
  floorArea?: number;
  volume?: number;
  rooms?: number;
  doors?: number;
  windows?: number;
} = {}): SketchAggregate {
  return {
    measurements: {
      floorArea: over.floorArea ?? 0,
      ceilingArea: 0,
      perimeter: 0,
      grossWallArea: 0,
      netWallArea: 0,
      volume: over.volume ?? 0,
    },
    counts: {
      rooms: over.rooms ?? 0,
      doors: over.doors ?? 0,
      windows: over.windows ?? 0,
    },
  };
}

describe("StatisticsPanel", () => {
  it("shows the active Floor's surface area and volume", () => {
    render(
      <StatisticsPanel
        floor={makeAggregate({ floorArea: 420, volume: 3360 })}
        sketch={makeAggregate()}
      />,
    );

    expect(screen.getByTestId("floor-surface-area").textContent).toContain("420");
    expect(screen.getByTestId("floor-volume").textContent).toContain("3360");
  });

  it("shows the whole-Sketch totals alongside the Floor's", () => {
    // A one-Floor plan and its whole-Sketch total differ (the Sketch spans a
    // second Floor too), so the panel must report each separately: the Floor's
    // own surface area and the larger Sketch-wide total side by side.
    render(
      <StatisticsPanel
        floor={makeAggregate({ floorArea: 420, volume: 3360 })}
        sketch={makeAggregate({ floorArea: 900, volume: 7200 })}
      />,
    );

    expect(screen.getByTestId("sketch-surface-area").textContent).toContain("900");
    expect(screen.getByTestId("sketch-volume").textContent).toContain("7200");
  });

  it("counts the Rooms and shows zero doors and windows until openings exist", () => {
    // The Floor holds two Rooms, the Sketch five across all Floors. Doors and
    // windows aren't modeled yet, so both counts read 0 rather than being hidden
    // — the panel always shows the tally, it just happens to be zero (S5).
    render(
      <StatisticsPanel
        floor={makeAggregate({ rooms: 2, doors: 0, windows: 0 })}
        sketch={makeAggregate({ rooms: 5, doors: 0, windows: 0 })}
      />,
    );

    expect(screen.getByTestId("floor-rooms").textContent).toContain("2");
    expect(screen.getByTestId("floor-doors").textContent).toContain("0");
    expect(screen.getByTestId("floor-windows").textContent).toContain("0");
    expect(screen.getByTestId("sketch-rooms").textContent).toContain("5");
    expect(screen.getByTestId("sketch-doors").textContent).toContain("0");
    expect(screen.getByTestId("sketch-windows").textContent).toContain("0");
  });
});
