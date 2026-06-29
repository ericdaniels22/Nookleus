// Per-organization Insights ingestion (#607).
//
// Pulls both sources for one Organization over a trailing day window, maps each
// to dated rows, and upserts them idempotently. Re-running the same day is a
// no-op-by-overwrite (the store's conflict key), so the daily cron — and a
// manual re-run — never duplicate. `today` is injected so the window is
// deterministic in tests (no Date.now() in the pulled-apart logic).

import type { SupabaseClient } from "@supabase/supabase-js";
import { listReviewLocations } from "@/lib/google/reviews";
import {
  fetchLocationPerformance,
  mapBusinessProfileMetrics,
  toPerformanceLocation,
  type InsightsApiClient,
  type InsightDateRange,
} from "./business-profile";
import {
  listSearchConsoleSites,
  fetchSearchConsoleMetrics,
  mapSearchConsoleMetrics,
} from "./search-console";
import { upsertInsightMetrics, type InsightMetricUpsert } from "./metrics-store";

const DAY_MS = 24 * 60 * 60 * 1000;

// How many trailing days each run pulls. Google revises recent days for a while,
// so the window overlaps prior runs — the upsert overwrites those days in place.
const DEFAULT_WINDOW_DAYS = 7;

// The inclusive [start, end] range of `days` days ending on `today` (ISO
// "YYYY-MM-DD"). UTC math so it never drifts a day across the local timezone.
export function trailingWindow(today: string, days: number): InsightDateRange {
  const endMs = Date.parse(`${today}T00:00:00Z`);
  const startMs = endMs - (days - 1) * DAY_MS;
  return { start: toIsoDate(startMs), end: today };
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function logSourceFailure(source: string, organizationId: string, err: unknown): void {
  console.error(
    `[insights] ${source} ingest failed for org ${organizationId}: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
}

export interface InsightIngestResult {
  // How many Business Profile locations were pulled.
  locations: number;
  // How many verified Search Console sites the connection exposes (0 → skipped).
  sites: number;
  // Total rows upserted across both sources.
  metricsSynced: number;
}

// Ingest one Organization's Insights for the trailing window ending `today`:
// Business Profile performance for every location, plus Search Console for the
// first verified site, mapped to dated rows and upserted idempotently. `db` must
// be PRIVILEGED — insight_metric is admin-only RLS (see upsertInsightMetrics).
export async function ingestOrganizationInsights(input: {
  db: SupabaseClient;
  organizationId: string;
  client: InsightsApiClient;
  today: string;
  windowDays?: number;
}): Promise<InsightIngestResult> {
  const { db, organizationId, client, today } = input;
  const range = trailingWindow(today, input.windowDays ?? DEFAULT_WINDOW_DAYS);
  const rows: InsightMetricUpsert[] = [];

  // Each source is pulled in its own try so a failure in one never discards the
  // rows already gathered from the other. The motivating case: existing
  // connections predate the webmasters.readonly scope, so their Search Console
  // call 403s until they reconnect — without isolation that would wipe out their
  // Business Profile insights too. The org is only counted FAILED (by throwing)
  // when BOTH sources fail; a partial pull still lands what it got.
  let locations = 0;
  let sites = 0;
  let businessProfileOk = false;
  let searchConsoleOk = false;

  // Business Profile performance, per location (reusing the reviews discovery).
  try {
    const reviewLocations = await listReviewLocations(client);
    locations = reviewLocations.length;
    for (const reviewLocation of reviewLocations) {
      const response = await fetchLocationPerformance(client, {
        location: toPerformanceLocation(reviewLocation),
        range,
      });
      rows.push(...mapBusinessProfileMetrics({ organizationId, response }));
    }
    businessProfileOk = true;
  } catch (err) {
    logSourceFailure("business_profile", organizationId, err);
  }

  // Search Console, first verified site (the v1 simplification).
  try {
    const siteList = await listSearchConsoleSites(client);
    sites = siteList.length;
    const siteUrl = siteList[0];
    if (siteUrl) {
      const response = await fetchSearchConsoleMetrics(client, { siteUrl, range });
      rows.push(...mapSearchConsoleMetrics({ organizationId, response }));
    }
    searchConsoleOk = true;
  } catch (err) {
    logSourceFailure("search_console", organizationId, err);
  }

  // Both sources failed → the connection is wholly broken; throw so the run
  // tally counts the org as FAILED rather than synced-with-zero.
  if (!businessProfileOk && !searchConsoleOk) {
    throw new Error(`both Insights sources failed for org ${organizationId}`);
  }

  const metricsSynced = await upsertInsightMetrics(db, rows);

  return { locations, sites, metricsSynced };
}

// The tally a scheduled run reports. `organizations` is how many were
// considered; `synced` + `skipped` + `failed` partition them.
export interface InsightIngestRunResult {
  organizations: number;
  synced: number;
  skipped: number;
  failed: number;
  metricsSynced: number;
}

// The multi-tenant scheduled-ingest entry point (the cron calls this). Fans out
// over every connected Organization, ingesting each in isolation: an org whose
// connection yields no client (broken / disconnected) is SKIPPED, and an org
// that throws mid-ingest is counted FAILED but never aborts the run — one broken
// connection must not starve every other Organization's Insights. `getClient` is
// injected (the route wires it to getGoogleClient over a privileged db) so the
// fan-out stays testable without token plumbing.
export async function ingestAllConnectedInsights(input: {
  db: SupabaseClient;
  organizationIds: string[];
  today: string;
  getClient: (organizationId: string) => Promise<InsightsApiClient | null>;
  windowDays?: number;
}): Promise<InsightIngestRunResult> {
  const { db, organizationIds, today, getClient, windowDays } = input;
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let metricsSynced = 0;

  for (const organizationId of organizationIds) {
    try {
      const client = await getClient(organizationId);
      if (!client) {
        skipped += 1;
        continue;
      }
      const result = await ingestOrganizationInsights({
        db,
        organizationId,
        client,
        today,
        windowDays,
      });
      synced += 1;
      metricsSynced += result.metricsSynced;
    } catch (err) {
      failed += 1;
      console.error(
        `[insights] ingest failed for org ${organizationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return {
    organizations: organizationIds.length,
    synced,
    skipped,
    failed,
    metricsSynced,
  };
}
