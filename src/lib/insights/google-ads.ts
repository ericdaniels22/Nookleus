// Google Ads reporting → Insights metrics (#610).
//
// Google Ads reports through GAQL over its REST API. The daily ingest runs one
// read-only query — SELECT segments.date, metrics.cost_micros, metrics.clicks,
// metrics.conversions FROM customer — against the searchStream endpoint and maps
// each day to three source-tagged rows (spend, clicks, conversions) for the
// metrics store. There is no mutate path here, by design: the cost-per-lead
// feature only ever reads (acceptance criterion: "no write/mutation path to any
// ads API exists").

import type { InsightMetricUpsert } from "./metrics-store";
import type { InsightsApiClient, InsightDateRange } from "./business-profile";
import { GOOGLE_ADS_ENDPOINTS } from "@/lib/google/config";

// One GoogleAdsRow's metrics. Money is an int64 micros string (cost_micros);
// clicks is an int64 string; conversions is a double. The API omits a field when
// it is zero, so every read is defaulted.
export interface GoogleAdsRowMetrics {
  costMicros?: string;
  clicks?: string;
  conversions?: number;
}

export interface GoogleAdsRowSegments {
  date?: string;
}

export interface GoogleAdsRow {
  segments?: GoogleAdsRowSegments;
  metrics?: GoogleAdsRowMetrics;
}

// googleAds:searchStream streams its results as an array of batches, each
// carrying a slice of the rows. The mapper flattens every batch.
export interface GoogleAdsSearchBatch {
  results?: GoogleAdsRow[];
}

export type GoogleAdsSearchStreamResponse = GoogleAdsSearchBatch[];

// One million micros to the dollar — Google Ads reports money as int64 micros.
const MICROS_PER_UNIT = 1_000_000;

// Pure mapping: a searchStream response → dated, source-tagged rows ready to
// upsert. Each day yields a spend row (micros → dollars), a clicks row and a
// conversions row.
export function mapGoogleAdsMetrics(input: {
  organizationId: string;
  response: GoogleAdsSearchStreamResponse;
}): InsightMetricUpsert[] {
  const { organizationId, response } = input;
  const rows: InsightMetricUpsert[] = [];

  for (const batch of response) {
    for (const row of batch.results ?? []) {
      const metricDate = row.segments?.date;
      if (!metricDate) continue;
      const metrics = row.metrics ?? {};
      rows.push(
        {
          organization_id: organizationId,
          source: "google_ads",
          metric_date: metricDate,
          metric: "spend",
          value: Number(metrics.costMicros ?? 0) / MICROS_PER_UNIT,
        },
        {
          organization_id: organizationId,
          source: "google_ads",
          metric_date: metricDate,
          metric: "clicks",
          value: Number(metrics.clicks ?? 0),
        },
        {
          organization_id: organizationId,
          source: "google_ads",
          metric_date: metricDate,
          metric: "conversions",
          value: Number(metrics.conversions ?? 0),
        },
      );
    }
  }

  return rows;
}

// The one report the feed pulls: per-day spend, clicks and conversions for the
// whole account. FROM customer aggregates across the account's campaigns, so a
// single query covers everything. This string is the entire surface of our Ads
// access — it is a SELECT, never a mutate.
function buildDailyMetricsQuery(range: InsightDateRange): string {
  return (
    "SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.conversions " +
    "FROM customer " +
    `WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'`
  );
}

// Run the read-only daily-metrics query for one Ads customer and return the raw
// searchStream batches for mapGoogleAdsMetrics to flatten. `developerToken` is
// the API-access token (Google Ads requires it as a header in addition to the
// OAuth bearer the client injects). The only endpoint this touches is
// googleAds:searchStream — there is no mutate path.
export async function fetchGoogleAdsMetrics(
  client: InsightsApiClient,
  input: { customerId: string; developerToken: string; range: InsightDateRange },
): Promise<GoogleAdsSearchStreamResponse> {
  const { customerId, developerToken, range } = input;
  const url = `${GOOGLE_ADS_ENDPOINTS.searchBase}/${customerId}/googleAds:searchStream`;

  const res = await client.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "developer-token": developerToken,
    },
    body: JSON.stringify({ query: buildDailyMetricsQuery(range) }),
  });
  if (!res.ok) {
    throw new Error(
      `Google Ads searchStream failed (${res.status}) for customer ${customerId}`,
    );
  }
  return (await res.json()) as GoogleAdsSearchStreamResponse;
}
