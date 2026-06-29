// Search Console performance → Insights metrics (#607).
//
// The Search Console API (searchconsole.googleapis.com) reports search
// performance via searchanalytics.query. Querying with dimensions: ["date"]
// returns one row per day, each keyed by the ISO date and carrying that day's
// clicks and impressions. We map each day to two source-tagged rows — one for
// clicks, one for impressions — for the metrics store.

import type { InsightMetricUpsert } from "./metrics-store";
import type { InsightsApiClient, InsightDateRange } from "./business-profile";
import { GOOGLE_SEARCH_CONSOLE_ENDPOINTS } from "@/lib/google/config";

// One row from a searchanalytics.query response. With dimensions: ["date"],
// `keys` is a single-element array holding the day as "YYYY-MM-DD".
export interface SearchConsoleQueryRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
}

export interface SearchConsoleQueryResponse {
  rows?: SearchConsoleQueryRow[];
}

// Pure mapping: a searchanalytics.query response (dimensions: ["date"]) → dated,
// source-tagged rows ready to upsert. Each day yields a clicks row and an
// impressions row.
export function mapSearchConsoleMetrics(input: {
  organizationId: string;
  response: SearchConsoleQueryResponse;
}): InsightMetricUpsert[] {
  const { organizationId, response } = input;
  const rows: InsightMetricUpsert[] = [];

  for (const row of response.rows ?? []) {
    const metricDate = row.keys?.[0];
    if (!metricDate) continue;
    rows.push(
      {
        organization_id: organizationId,
        source: "search_console",
        metric_date: metricDate,
        metric: "clicks",
        value: Number(row.clicks ?? 0),
      },
      {
        organization_id: organizationId,
        source: "search_console",
        metric_date: metricDate,
        metric: "impressions",
        value: Number(row.impressions ?? 0),
      },
    );
  }

  return rows;
}

// One entry from sites.list. permissionLevel "siteUnverifiedUser" means the
// connection cannot read performance for the site, so it's excluded.
interface SearchConsoleSiteEntry {
  siteUrl: string;
  permissionLevel?: string;
}

interface SearchConsoleSitesResponse {
  siteEntry?: SearchConsoleSiteEntry[];
}

// The site URLs this connection can actually read (verified). Discovery mirrors
// the GBP "first verified site" simplification: the ingest uses the first.
export async function listSearchConsoleSites(
  client: InsightsApiClient,
): Promise<string[]> {
  const res = await client.fetch(GOOGLE_SEARCH_CONSOLE_ENDPOINTS.sites);
  if (!res.ok) {
    throw new Error(`Google search console sites fetch failed (${res.status})`);
  }
  const page = (await res.json()) as SearchConsoleSitesResponse;
  return (page.siteEntry ?? [])
    .filter((s) => s.permissionLevel !== "siteUnverifiedUser")
    .map((s) => s.siteUrl);
}

// Query one verified site's daily clicks/impressions over the range. Returns the
// raw response for mapSearchConsoleMetrics to flatten into rows.
export async function fetchSearchConsoleMetrics(
  client: InsightsApiClient,
  input: { siteUrl: string; range: InsightDateRange },
): Promise<SearchConsoleQueryResponse> {
  const { siteUrl, range } = input;
  const url =
    `${GOOGLE_SEARCH_CONSOLE_ENDPOINTS.searchAnalyticsBase}/` +
    `${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const res = await client.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: range.start,
      endDate: range.end,
      dimensions: ["date"],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Google search console query failed (${res.status}) for ${siteUrl}`,
    );
  }
  return (await res.json()) as SearchConsoleQueryResponse;
}
