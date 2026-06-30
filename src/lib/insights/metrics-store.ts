// The Insights metrics store (#607, parent PRD #603) — the read/write layer over
// the Organization-scoped insight_metric table.
//
// "Dated, source-tagged rows": every measurement is one row tagged with the
// source it came from (Business Profile performance, Search Console) and the day
// it is for. The sync UPSERTS on (organization_id, source, metric_date, metric)
// so a re-run of the same day overwrites in place — never duplicates. That is
// the idempotency contract the acceptance criteria require. Later slices (Ads,
// Local Services Ads) add new `source` values without any schema change.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightMetricRow } from "./series";

// The sources that land in the store. Free Google sources (Business Profile,
// Search Console) and the paid ad feeds (Google Ads, Local Services Ads, #610)
// all share this one long/narrow table — a new `source` value is the only change
// a new feed needs, no schema migration.
export type InsightMetricSource =
  | "business_profile"
  | "search_console"
  | "google_ads"
  | "local_services_ads";

// The row we upsert into insight_metric. Mirrors the table columns one-for-one
// so the mapper output IS the write payload.
export interface InsightMetricUpsert {
  organization_id: string;
  source: InsightMetricSource;
  // The day the metric is for, as an ISO date ("YYYY-MM-DD").
  metric_date: string;
  // The measurement name, scoped by source (e.g. "calls", "impressions").
  metric: string;
  value: number;
}

// The columns a single upsert batch must be unique on — the table's conflict
// target. Two rows that match on all four cannot coexist in one ON CONFLICT
// batch, so they are collapsed before the write (see collapseByConflictKey).
const CONFLICT_COLUMNS = ["organization_id", "source", "metric_date", "metric"] as const;

// Collapse rows that share the conflict key into one, SUMMING their values.
// An Organization with two Business Profile locations reports the same (source,
// day, metric) twice — the org-level total is their sum. Without this, the
// single upsert batch carries a duplicate conflict key and Postgres rejects the
// whole batch (cardinality_violation, "command cannot affect row a second
// time"), so the org would get zero Insights. First-seen order is preserved.
function collapseByConflictKey(rows: InsightMetricUpsert[]): InsightMetricUpsert[] {
  const merged = new Map<string, InsightMetricUpsert>();
  for (const row of rows) {
    // " " can't appear in a uuid, an ISO date, or the code-controlled
    // source / metric vocabulary, so it's a collision-proof key separator.
    const key = CONFLICT_COLUMNS.map((c) => row[c]).join(" ");
    const existing = merged.get(key);
    if (existing) {
      existing.value += row.value;
    } else {
      merged.set(key, { ...row });
    }
  }
  return [...merged.values()];
}

// Idempotent batch write: upsert on (organization_id, source, metric_date,
// metric) so re-ingesting a day overwrites each measurement in place instead of
// stacking duplicates. Same-key rows within the batch (e.g. two Business Profile
// locations) are summed into one row first, so the batch never trips Postgres'
// cardinality_violation. Returns the number of rows actually written
// (post-collapse). Pass a PRIVILEGED db: insight_metric is admin-only RLS, so a
// non-admin client would silently write zero rows.
export async function upsertInsightMetrics(
  db: SupabaseClient,
  rows: InsightMetricUpsert[],
): Promise<number> {
  const merged = collapseByConflictKey(rows);
  if (merged.length === 0) return 0;
  const { error } = await db
    .from("insight_metric")
    .upsert(merged, { onConflict: CONFLICT_COLUMNS.join(",") });
  if (error) {
    throw new Error(`insight_metric upsert failed: ${error.message}`);
  }
  return merged.length;
}

// The columns the Insights screen needs — the dated, source-tagged measurements,
// without organization_id (the query already scopes to one Organization).
const INSIGHT_READ_COLUMNS = "source, metric_date, metric, value";

// Read one Organization's dated metric rows for the Insights screen. The explicit
// organization_id filter scopes the read even over a privileged db (insight_metric
// is admin-only RLS; the route reads over the service client, mirroring the
// reviews inbox). The flat rows are folded into day-level series by toDailySeries.
export async function listOrganizationInsights(
  db: SupabaseClient,
  organizationId: string,
): Promise<InsightMetricRow[]> {
  const { data, error } = await db
    .from("insight_metric")
    .select(INSIGHT_READ_COLUMNS)
    .eq("organization_id", organizationId);
  if (error) {
    throw new Error(`insight_metric list failed: ${error.message}`);
  }
  return (data ?? []) as unknown as InsightMetricRow[];
}
