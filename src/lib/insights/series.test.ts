import { describe, it, expect } from "vitest";
import { toDailySeries, flattenSeriesToRows, monthsInSeries } from "./series";
import type { InsightMetricRow, InsightDailySeries } from "./series";

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

function daily(over: Partial<InsightDailySeries> = {}): InsightDailySeries {
  return {
    source: "google_ads",
    metric: "spend",
    points: [{ date: "2026-05-15", value: 100 }],
    ...over,
  };
}

describe("flattenSeriesToRows", () => {
  it("expands each series point back into a source-tagged metric row", () => {
    const rows = flattenSeriesToRows([
      daily({
        source: "google_ads",
        metric: "spend",
        points: [
          { date: "2026-05-10", value: 100 },
          { date: "2026-05-11", value: 140 },
        ],
      }),
    ]);

    expect(rows).toEqual([
      { source: "google_ads", metric_date: "2026-05-10", metric: "spend", value: 100 },
      { source: "google_ads", metric_date: "2026-05-11", metric: "spend", value: 140 },
    ]);
  });

  it("round-trips toDailySeries: flatten ∘ group restores the rows", () => {
    const rows: InsightMetricRow[] = [
      { source: "google_ads", metric_date: "2026-05-10", metric: "spend", value: 100 },
      { source: "google_ads", metric_date: "2026-05-10", metric: "conversions", value: 2 },
      { source: "local_services_ads", metric_date: "2026-05-11", metric: "leads", value: 5 },
    ];
    const restored = flattenSeriesToRows(toDailySeries(rows));
    expect(restored).toEqual(expect.arrayContaining(rows));
    expect(restored).toHaveLength(rows.length);
  });

  it("returns no rows for an empty series set", () => {
    expect(flattenSeriesToRows([])).toEqual([]);
  });
});

describe("monthsInSeries", () => {
  it("lists the distinct months present, most recent first", () => {
    const months = monthsInSeries([
      daily({ points: [{ date: "2026-04-30", value: 1 }, { date: "2026-05-02", value: 1 }] }),
      daily({ source: "local_services_ads", metric: "leads", points: [{ date: "2026-06-10", value: 1 }] }),
    ]);

    // Latest first so the panel can default to the freshest month.
    expect(months).toEqual(["2026-06", "2026-05", "2026-04"]);
  });

  it("deduplicates months that several days/sources share", () => {
    const months = monthsInSeries([
      daily({ points: [{ date: "2026-05-01", value: 1 }, { date: "2026-05-31", value: 1 }] }),
      daily({ source: "business_profile", metric: "calls", points: [{ date: "2026-05-15", value: 1 }] }),
    ]);

    expect(months).toEqual(["2026-05"]);
  });

  it("returns no months for an empty series set", () => {
    expect(monthsInSeries([])).toEqual([]);
  });
});
