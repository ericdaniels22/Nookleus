import { describe, it, expect } from "vitest";
import { toDailySeries } from "./series";
import type { InsightMetricRow } from "./series";

function row(overrides: Partial<InsightMetricRow> = {}): InsightMetricRow {
  return {
    source: "business_profile",
    metric_date: "2026-06-25",
    metric: "calls",
    value: 12,
    ...overrides,
  };
}

describe("toDailySeries", () => {
  it("groups a metric's rows into one ascending day series", () => {
    const series = toDailySeries([
      row({ metric_date: "2026-06-25", value: 12 }),
      row({ metric_date: "2026-06-24", value: 9 }),
    ]);

    expect(series).toEqual([
      {
        source: "business_profile",
        metric: "calls",
        points: [
          { date: "2026-06-24", value: 9 },
          { date: "2026-06-25", value: 12 },
        ],
      },
    ]);
  });

  it("keeps each (source, metric) pair as its own series", () => {
    const series = toDailySeries([
      row({ source: "business_profile", metric: "calls", value: 12 }),
      row({ source: "search_console", metric: "clicks", value: 88 }),
      row({ source: "business_profile", metric: "website_clicks", value: 40 }),
    ]);

    expect(series.map((s) => [s.source, s.metric])).toEqual([
      ["business_profile", "calls"],
      ["business_profile", "website_clicks"],
      ["search_console", "clicks"],
    ]);
  });

  it("orders series deterministically by source then metric, whatever the row order", () => {
    // The store read has no ORDER BY, so rows arrive in arbitrary order. The
    // series order must still be stable — otherwise the table rows and the
    // chart's line colors (assigned by series index) shuffle between loads.
    const series = toDailySeries([
      row({ source: "search_console", metric: "impressions" }),
      row({ source: "business_profile", metric: "website_clicks" }),
      row({ source: "search_console", metric: "clicks" }),
      row({ source: "business_profile", metric: "calls" }),
    ]);

    expect(series.map((s) => [s.source, s.metric])).toEqual([
      ["business_profile", "calls"],
      ["business_profile", "website_clicks"],
      ["search_console", "clicks"],
      ["search_console", "impressions"],
    ]);
  });

  it("returns no series for an empty row set", () => {
    expect(toDailySeries([])).toEqual([]);
  });
});
