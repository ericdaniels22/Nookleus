/**
 * Shared Chart.js palette — the deep module that ends hex literals in chart
 * configs (docs/design-system.md §2.7, issue #911).
 *
 * Chart.js takes colors as plain JS values, so charts silently keep stale
 * colors unless handed fresh ones. This reads the design tokens from computed
 * CSS at runtime and returns a complete, Chart.js-ready palette. When the
 * variables can't be read (SSR / first paint) it returns the documented static
 * dark values, so it always yields a full palette.
 */

/** A complete set of chart colors, ready to drop into Chart.js configs. */
export interface ChartPalette {
  /** The five series slots, from `--chart-1` … `--chart-5`. */
  series: [string, string, string, string, string];
  /** Grid lines — `--border`. */
  grid: string;
  /** Axis labels / ticks — `--muted-foreground`. */
  axis: string;
  /** Tooltip surface — `--popover`. */
  tooltip: string;
}

/**
 * Documented dark values (docs/design-system.md §2.7), used for SSR / first
 * paint before the CSS custom properties are readable.
 */
const FALLBACK: ChartPalette = {
  series: ["#10B981", "#38BDF8", "#FBBF24", "#A78BFA", "#F87171"],
  grid: "rgba(255, 255, 255, 0.07)", // --border: white @ 7%
  axis: "#8B958F", // --muted-foreground
  tooltip: "#1A211E", // --popover
};

function readRootStyles(): CSSStyleDeclaration | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  return window.getComputedStyle(document.documentElement);
}

/**
 * Build the current chart palette, reading `--chart-1` … `--chart-5`,
 * `--border`, `--muted-foreground`, and `--popover` from computed CSS, each
 * falling back to its documented dark value when unavailable.
 */
export function getChartPalette(): ChartPalette {
  const styles = readRootStyles();
  const read = (name: string, fallback: string): string =>
    styles?.getPropertyValue(name).trim() || fallback;

  return {
    series: [
      read("--chart-1", FALLBACK.series[0]),
      read("--chart-2", FALLBACK.series[1]),
      read("--chart-3", FALLBACK.series[2]),
      read("--chart-4", FALLBACK.series[3]),
      read("--chart-5", FALLBACK.series[4]),
    ],
    grid: read("--border", FALLBACK.grid),
    axis: read("--muted-foreground", FALLBACK.axis),
    tooltip: read("--popover", FALLBACK.tooltip),
  };
}
