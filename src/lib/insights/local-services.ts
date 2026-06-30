// Local Services Ads reporting → Insights metrics (#610).
//
// Local Services Ads data flows through the same Google Ads API as paid search,
// so this feed reuses the GAQL searchStream shape — it just queries the Local
// Services campaign and reads a different lead signal. LSA charges per lead, so
// the campaign's conversions ARE its leads; we map cost_micros → spend and
// conversions → leads, each tagged source "local_services_ads". Like the Ads
// feed, the only endpoint touched is searchStream — read-only, no mutate path.

import type { InsightMetricUpsert } from "./metrics-store";
import type { InsightsApiClient, InsightDateRange } from "./business-profile";
import type { GoogleAdsSearchStreamResponse } from "./google-ads";
import { GOOGLE_ADS_ENDPOINTS } from "@/lib/google/config";

// One million micros to the dollar — Google Ads reports money as int64 micros.
const MICROS_PER_UNIT = 1_000_000;

// Pure mapping: a searchStream response for the Local Services campaign → dated,
// source-tagged rows ready to upsert. Each day yields a spend row (micros →
// dollars) and a leads row (the campaign's charged conversions).
export function mapLocalServicesMetrics(input: {
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
          source: "local_services_ads",
          metric_date: metricDate,
          metric: "spend",
          value: Number(metrics.costMicros ?? 0) / MICROS_PER_UNIT,
        },
        {
          organization_id: organizationId,
          source: "local_services_ads",
          metric_date: metricDate,
          metric: "leads",
          value: Number(metrics.conversions ?? 0),
        },
      );
    }
  }

  return rows;
}

// The one report the LSA feed pulls: per-day spend and leads for the Local
// Services campaign. The advertising_channel_type filter restricts the query to
// LSA, so the same FROM campaign report can't pick up paid-search spend. This
// string is the entire surface of our LSA access — a SELECT, never a mutate.
function buildLocalServicesQuery(range: InsightDateRange): string {
  return (
    "SELECT segments.date, metrics.cost_micros, metrics.conversions " +
    "FROM campaign " +
    "WHERE campaign.advertising_channel_type = 'LOCAL_SERVICES' " +
    `AND segments.date BETWEEN '${range.start}' AND '${range.end}'`
  );
}

// Run the read-only Local Services query for one Ads customer and return the raw
// searchStream batches for mapLocalServicesMetrics to flatten. `developerToken`
// is the Google Ads API-access token (required as a header alongside the OAuth
// bearer the client injects). The only endpoint touched is googleAds:searchStream
// — there is no mutate path.
export async function fetchLocalServicesMetrics(
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
    body: JSON.stringify({ query: buildLocalServicesQuery(range) }),
  });
  if (!res.ok) {
    throw new Error(
      `Google LSA searchStream failed (${res.status}) for customer ${customerId}`,
    );
  }
  return (await res.json()) as GoogleAdsSearchStreamResponse;
}
