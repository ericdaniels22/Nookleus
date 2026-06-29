// Insights history aggregation (#607).
//
// The store holds one row per (source, metric, day). The Insights screen wants
// day-level history per measurement — "show both sources with day-level history,
// not just a snapshot". `toDailySeries` folds the flat rows into one series per
// (source, metric), each a list of points in ascending date order, ready to
// drive a line chart or table.

import type { InsightMetricSource } from "./metrics-store";

// A row as read back from insight_metric (organization_id is already filtered by
// the query, so the series shape drops it).
export interface InsightMetricRow {
  source: InsightMetricSource;
  metric_date: string;
  metric: string;
  value: number;
}

export interface InsightMetricPoint {
  date: string;
  value: number;
}

export interface InsightDailySeries {
  source: InsightMetricSource;
  metric: string;
  points: InsightMetricPoint[];
}

// Group flat metric rows into per-(source, metric) day series. Each series'
// points are sorted ascending by date, and the series themselves are ordered
// deterministically by (source, metric) — the store read has no ORDER BY, so
// without this the table rows and the chart's index-assigned line colors would
// shuffle between loads.
export function toDailySeries(rows: InsightMetricRow[]): InsightDailySeries[] {
  const bySeries = new Map<string, InsightDailySeries>();

  for (const row of rows) {
    const key = `${row.source}|${row.metric}`;
    let series = bySeries.get(key);
    if (!series) {
      series = { source: row.source, metric: row.metric, points: [] };
      bySeries.set(key, series);
    }
    series.points.push({ date: row.metric_date, value: row.value });
  }

  for (const series of bySeries.values()) {
    series.points.sort((a, b) => a.date.localeCompare(b.date));
  }

  return [...bySeries.values()].sort(
    (a, b) =>
      a.source.localeCompare(b.source) || a.metric.localeCompare(b.metric),
  );
}
