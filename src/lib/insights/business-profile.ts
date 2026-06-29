// Business Profile performance → Insights metrics (#607).
//
// The Business Profile Performance API
// (businessprofileperformance.googleapis.com) reports per-location daily metrics
// as time series. `fetchMultiDailyMetricsTimeSeries` returns one series per
// requested DailyMetric, each a list of dated values. We pull the three the
// Marketing suite surfaces — calls, direction requests, website clicks — and map
// each dated value to one source-tagged row for the metrics store.

import type { InsightMetricUpsert } from "./metrics-store";
import { GOOGLE_BUSINESS_ENDPOINTS } from "@/lib/google/config";

// The fetch layer only needs an authorized `.fetch` (GoogleClient injects the
// bearer token). Narrowing to this keeps the Insights helpers testable with a
// tiny fake and decoupled from token plumbing — same shape reviews.ts uses.
export interface InsightsApiClient {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

// An inclusive day range, both ends as ISO "YYYY-MM-DD". The daily ingest pulls
// a trailing window so Google's late revisions to recent days get overwritten.
export interface InsightDateRange {
  start: string;
  end: string;
}

// google.type.Date — the Performance API dates each value with year/month/day.
export interface GbpDate {
  year: number;
  month: number;
  day: number;
}

// One day's value. `value` is an int64 as a string; the API omits it for zero.
export interface GbpDatedValue {
  date: GbpDate;
  value?: string;
}

export interface GbpDailyMetricTimeSeries {
  dailyMetric: string;
  timeSeries: { datedValues?: GbpDatedValue[] };
}

export interface GbpMultiDailyMetricTimeSeries {
  dailyMetricTimeSeries?: GbpDailyMetricTimeSeries[];
}

export interface GbpPerformanceResponse {
  multiDailyMetricTimeSeries?: GbpMultiDailyMetricTimeSeries[];
}

// The DailyMetric enum values we request, mapped to the store's canonical metric
// names (the Marketing suite vocabulary: calls, direction requests, website
// clicks). A series for any other metric is ignored.
const GBP_METRIC_NAMES: Record<string, string> = {
  CALL_CLICKS: "calls",
  BUSINESS_DIRECTION_REQUESTS: "direction_requests",
  WEBSITE_CLICKS: "website_clicks",
};

function formatDate(date: GbpDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${date.year}-${mm}-${dd}`;
}

// Pure mapping: a fetchMultiDailyMetricsTimeSeries response → dated,
// source-tagged rows ready to upsert. One row per (metric, day).
export function mapBusinessProfileMetrics(input: {
  organizationId: string;
  response: GbpPerformanceResponse;
}): InsightMetricUpsert[] {
  const { organizationId, response } = input;
  const rows: InsightMetricUpsert[] = [];

  for (const multi of response.multiDailyMetricTimeSeries ?? []) {
    for (const series of multi.dailyMetricTimeSeries ?? []) {
      const metric = GBP_METRIC_NAMES[series.dailyMetric];
      if (!metric) continue;
      for (const dated of series.timeSeries.datedValues ?? []) {
        rows.push({
          organization_id: organizationId,
          source: "business_profile",
          metric_date: formatDate(dated.date),
          metric,
          value: Number(dated.value ?? 0),
        });
      }
    }
  }

  return rows;
}

// The DailyMetric enum values we request from the Performance API — the three
// the Marketing suite surfaces. Order is the requested order (mirrored by the
// response), which the fetch test pins.
const GBP_REQUESTED_METRICS = [
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "WEBSITE_CLICKS",
] as const;

// Spread an ISO "YYYY-MM-DD" into the year/month/day query params the
// Performance API's google.type.Date range expects (integers, not padded).
function appendDateParams(params: URLSearchParams, prefix: string, iso: string) {
  const [year, month, day] = iso.split("-").map((p) => String(Number(p)));
  params.set(`${prefix}.year`, year);
  params.set(`${prefix}.month`, month);
  params.set(`${prefix}.day`, day);
}

// The reviews API discovers locations as full v4 names
// ("accounts/*/locations/*"); the Performance API keys on the bare
// "locations/*". Reduce one to the other so insights can reuse that discovery.
export function toPerformanceLocation(reviewLocationName: string): string {
  const idx = reviewLocationName.indexOf("locations/");
  return idx === -1 ? reviewLocationName : reviewLocationName.slice(idx);
}

// Fetch one location's daily metric time series over the range. `location` is a
// bare Performance-API resource name ("locations/*"). Returns the raw response
// for mapBusinessProfileMetrics to flatten.
export async function fetchLocationPerformance(
  client: InsightsApiClient,
  input: { location: string; range: InsightDateRange },
): Promise<GbpPerformanceResponse> {
  const { location, range } = input;
  const url = new URL(
    `${GOOGLE_BUSINESS_ENDPOINTS.performanceBase}/${location}:fetchMultiDailyMetricsTimeSeries`,
  );
  for (const metric of GBP_REQUESTED_METRICS) {
    url.searchParams.append("dailyMetrics", metric);
  }
  appendDateParams(url.searchParams, "dailyRange.start_date", range.start);
  appendDateParams(url.searchParams, "dailyRange.end_date", range.end);

  const res = await client.fetch(url.toString());
  if (!res.ok) {
    throw new Error(
      `Google performance fetch failed (${res.status}) for ${location}`,
    );
  }
  return (await res.json()) as GbpPerformanceResponse;
}
