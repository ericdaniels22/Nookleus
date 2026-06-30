import { describe, it, expect } from "vitest";
import { costPerLeadBySource } from "./cost-per-lead";
import type { InsightMetricRow } from "./series";

function row(overrides: Partial<InsightMetricRow> = {}): InsightMetricRow {
  return {
    source: "google_ads",
    metric_date: "2026-05-15",
    metric: "spend",
    value: 100,
    ...overrides,
  };
}

describe("costPerLeadBySource", () => {
  it("divides a paid source's monthly spend by its leads", () => {
    const result = costPerLeadBySource(
      [
        row({ source: "google_ads", metric: "spend", value: 400 }),
        row({ source: "google_ads", metric: "conversions", value: 8 }),
      ],
      "2026-05",
    );

    expect(result).toEqual([
      { source: "google_ads", spend: 400, leads: 8, costPerLead: 50 },
    ]);
  });

  it("counts Local Services Ads leads from its own 'leads' metric", () => {
    const result = costPerLeadBySource(
      [
        row({ source: "local_services_ads", metric: "spend", value: 300 }),
        row({ source: "local_services_ads", metric: "leads", value: 12 }),
      ],
      "2026-05",
    );

    expect(result).toEqual([
      { source: "local_services_ads", spend: 300, leads: 12, costPerLead: 25 },
    ]);
  });

  it("treats Business Profile calls as free leads with a true zero cost", () => {
    const result = costPerLeadBySource(
      [row({ source: "business_profile", metric: "calls", value: 20 })],
      "2026-05",
    );

    expect(result).toEqual([
      { source: "business_profile", spend: 0, leads: 20, costPerLead: 0 },
    ]);
  });

  it("reports a null cost-per-lead when a paid source spent but got zero leads", () => {
    // Spent money, no leads to divide by: must NOT divide by zero, must NOT
    // invent a $0. The source stays visible so the wasted spend is seen.
    const result = costPerLeadBySource(
      [row({ source: "google_ads", metric: "spend", value: 250 })],
      "2026-05",
    );

    expect(result).toEqual([
      { source: "google_ads", spend: 250, leads: 0, costPerLead: null },
    ]);
  });

  it("omits sources with no rows in the month and never counts Search Console", () => {
    // Only Google Ads has data. Local Services Ads and Business Profile are
    // absent (no fake-zero rows), and Search Console activity is not a lead.
    const result = costPerLeadBySource(
      [
        row({ source: "google_ads", metric: "spend", value: 90 }),
        row({ source: "google_ads", metric: "conversions", value: 3 }),
        row({ source: "search_console", metric: "clicks", value: 500 }),
        row({ source: "search_console", metric: "impressions", value: 9000 }),
      ],
      "2026-05",
    );

    expect(result).toEqual([
      { source: "google_ads", spend: 90, leads: 3, costPerLead: 30 },
    ]);
  });

  it("omits a source whose only rows are neither spend nor a lead signal", () => {
    // Business Profile reports website_clicks and direction_requests too, and its
    // API omits zero values — so a month can have page-view activity but zero
    // calls and zero spend. That is not a lead at any price: it must produce no
    // row, not a fabricated $0.00 / 0 / dash one (which would bypass the panel's
    // empty state and show a table of fake zeros).
    const result = costPerLeadBySource(
      [
        row({ source: "business_profile", metric: "website_clicks", value: 40 }),
        row({ source: "business_profile", metric: "direction_requests", value: 7 }),
      ],
      "2026-05",
    );

    expect(result).toEqual([]);
  });

  it("counts only the selected month's rows", () => {
    const result = costPerLeadBySource(
      [
        row({ source: "google_ads", metric: "spend", value: 200, metric_date: "2026-05-31" }),
        row({ source: "google_ads", metric: "conversions", value: 4, metric_date: "2026-05-01" }),
        // April and June rows must not leak into the May total.
        row({ source: "google_ads", metric: "spend", value: 999, metric_date: "2026-04-30" }),
        row({ source: "google_ads", metric: "conversions", value: 99, metric_date: "2026-06-01" }),
      ],
      "2026-05",
    );

    expect(result).toEqual([
      { source: "google_ads", spend: 200, leads: 4, costPerLead: 50 },
    ]);
  });

  it("sums repeated rows for a source across the month", () => {
    // Multiple days (or multiple ad accounts collapsed to org level) land as
    // several rows for the same (source, metric) — the monthly total is their sum.
    const result = costPerLeadBySource(
      [
        row({ source: "google_ads", metric: "spend", value: 100, metric_date: "2026-05-10" }),
        row({ source: "google_ads", metric: "spend", value: 140, metric_date: "2026-05-11" }),
        row({ source: "google_ads", metric: "conversions", value: 3, metric_date: "2026-05-10" }),
        row({ source: "google_ads", metric: "conversions", value: 5, metric_date: "2026-05-11" }),
      ],
      "2026-05",
    );

    expect(result).toEqual([
      { source: "google_ads", spend: 240, leads: 8, costPerLead: 30 },
    ]);
  });

  it("orders sources paid-first deterministically, whatever the row order", () => {
    // The store read has no ORDER BY, so rows arrive arbitrarily. The panel rows
    // must still be stable: Google Ads, Local Services Ads, then Business Profile.
    const result = costPerLeadBySource(
      [
        row({ source: "business_profile", metric: "calls", value: 10 }),
        row({ source: "local_services_ads", metric: "spend", value: 300 }),
        row({ source: "local_services_ads", metric: "leads", value: 12 }),
        row({ source: "google_ads", metric: "spend", value: 400 }),
        row({ source: "google_ads", metric: "conversions", value: 8 }),
      ],
      "2026-05",
    );

    expect(result.map((r) => r.source)).toEqual([
      "google_ads",
      "local_services_ads",
      "business_profile",
    ]);
  });

  it("returns no rows for an empty input", () => {
    expect(costPerLeadBySource([], "2026-05")).toEqual([]);
  });
});
