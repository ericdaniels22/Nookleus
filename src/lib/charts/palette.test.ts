import { afterEach, describe, expect, it, vi } from "vitest";

import { getChartPalette } from "./palette";

const CHART_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--border",
  "--muted-foreground",
  "--popover",
] as const;

function clearChartVars() {
  for (const name of CHART_VARS) {
    document.documentElement.style.removeProperty(name);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearChartVars();
});

describe("getChartPalette", () => {
  it("reads the first series slot from --chart-1", () => {
    document.documentElement.style.setProperty("--chart-1", "#123456");

    expect(getChartPalette().series[0]).toBe("#123456");
  });

  it("reads all five series slots from --chart-1 through --chart-5", () => {
    document.documentElement.style.setProperty("--chart-1", "#111111");
    document.documentElement.style.setProperty("--chart-2", "#222222");
    document.documentElement.style.setProperty("--chart-3", "#333333");
    document.documentElement.style.setProperty("--chart-4", "#444444");
    document.documentElement.style.setProperty("--chart-5", "#555555");

    expect(getChartPalette().series).toEqual([
      "#111111",
      "#222222",
      "#333333",
      "#444444",
      "#555555",
    ]);
  });

  it("reads grid from --border, axis from --muted-foreground, tooltip from --popover", () => {
    document.documentElement.style.setProperty("--border", "rgba(1, 2, 3, 0.1)");
    document.documentElement.style.setProperty("--muted-foreground", "#abcdef");
    document.documentElement.style.setProperty("--popover", "#0f0f0f");

    const palette = getChartPalette();

    expect(palette.grid).toBe("rgba(1, 2, 3, 0.1)");
    expect(palette.axis).toBe("#abcdef");
    expect(palette.tooltip).toBe("#0f0f0f");
  });

  it("falls back to the documented dark values when the variables are unset (first-paint)", () => {
    // No properties set on :root — getPropertyValue returns "" for each.
    expect(getChartPalette()).toEqual({
      series: ["#10B981", "#38BDF8", "#FBBF24", "#A78BFA", "#F87171"],
      grid: "rgba(255, 255, 255, 0.07)",
      axis: "#8B958F",
      tooltip: "#1A211E",
    });
  });

  it("falls back per-variable, keeping the ones that are set", () => {
    document.documentElement.style.setProperty("--chart-2", "#222222");

    const palette = getChartPalette();

    expect(palette.series[0]).toBe("#10B981"); // unset -> documented fallback
    expect(palette.series[1]).toBe("#222222"); // set -> read from CSS
  });

  it("returns the complete fallback palette under SSR (no window) without throwing", () => {
    // A live var is set; under SSR it must be ignored (proves the guard fires
    // rather than the test passing vacuously through the jsdom read path).
    document.documentElement.style.setProperty("--chart-1", "#deadbeef");
    vi.stubGlobal("window", undefined);

    expect(getChartPalette()).toEqual({
      series: ["#10B981", "#38BDF8", "#FBBF24", "#A78BFA", "#F87171"],
      grid: "rgba(255, 255, 255, 0.07)",
      axis: "#8B958F",
      tooltip: "#1A211E",
    });
  });
});
