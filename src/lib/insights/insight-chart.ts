// Palette-wired Chart.js config for the Marketing → Insights line charts
// (docs/design-system.md §2.7, issue #924). Every color the chart draws comes
// from the shared ChartPalette (#911) — the module reads the design tokens, this
// builder threads them into the Chart.js config so no hex literal ever lives in
// a chart config again.

import type { ChartData, ChartOptions } from "chart.js";
import type { ChartPalette } from "@/lib/charts/palette";

/** One metric's line: its legend label and its per-day values (null = no point). */
export interface InsightDataset {
  label: string;
  data: (number | null)[];
}

/**
 * Build the `data` and `options` for one source's day-level line chart, coloring
 * every series from `palette.series` (cycling if a source has more than five
 * metrics).
 */
export function buildInsightLineChart({
  labels,
  datasets,
  palette,
}: {
  labels: string[];
  datasets: InsightDataset[];
  palette: ChartPalette;
}): { data: ChartData<"line">; options: ChartOptions<"line"> } {
  const data: ChartData<"line"> = {
    labels,
    datasets: datasets.map((ds, i) => {
      const color = palette.series[i % palette.series.length];
      return {
        label: ds.label,
        data: ds.data,
        borderColor: color,
        backgroundColor: color,
        tension: 0.3,
        spanGaps: true,
      };
    }),
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" },
      tooltip: { backgroundColor: palette.tooltip },
    },
    scales: {
      x: {
        grid: { color: palette.grid },
        ticks: { color: palette.axis },
      },
      y: {
        grid: { color: palette.grid },
        ticks: { color: palette.axis },
      },
    },
  };

  return { data, options };
}
