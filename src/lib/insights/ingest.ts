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
import { fetchGoogleAdsMetrics, mapGoogleAdsMetrics } from "./google-ads";
import { fetchLocalServicesMetrics, mapLocalServicesMetrics } from "./local-services";
import { upsertInsightMetrics, type InsightMetricUpsert } from "./metrics-store";

// Per-organization Google Ads access: the account to report on plus the Google
// Ads API developer token (the API requires it as a header alongside the OAuth
// bearer). When absent, the paid feeds are simply not pulled — an org that has
// not connected Ads (live data is gated on the developer-token approval, #611)
// keeps ingesting its free Google sources unchanged.
export interface AdsIngestConfig {
  customerId: string;
  developerToken: string;
}

// Decide an org's Ads ingest config from the app-level developer token and the
// org's linked Ads customer. Both are required: the developer token is the app's
// API-access grant (one env var), the customer id is per-org. Either being
// absent means the paid feeds stay dark — the gated-until-#611 state, where the
// developer-token approval and per-org Ads-customer discovery land. Pure so the
// cron route stays a thin wiring over a tested decision.
export function resolveAdsIngestConfig(input: {
  developerToken: string | undefined;
  customerId: string | null;
}): AdsIngestConfig | null {
  if (!input.developerToken || !input.customerId) return null;
  return { customerId: input.customerId, developerToken: input.developerToken };
}

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
  // When present, also pull the paid feeds (Google Ads + Local Services Ads) for
  // this Ads customer. Omitted for orgs with no Ads connection (#611).
  ads?: AdsIngestConfig;
}): Promise<InsightIngestResult> {
  const { db, organizationId, client, today, ads } = input;
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
  let googleAdsOk = false;
  let localServicesAdsOk = false;

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

  // Paid feeds (#610), only when the org has an Ads connection. Each runs in its
  // own try so a Local Services failure never discards the search-ads rows (an
  // account may run search ads but no LSA campaign, or vice versa). Both are
  // read-only GAQL pulls — searchStream only, never a mutate endpoint.
  if (ads) {
    try {
      const response = await fetchGoogleAdsMetrics(client, {
        customerId: ads.customerId,
        developerToken: ads.developerToken,
        range,
      });
      rows.push(...mapGoogleAdsMetrics({ organizationId, response }));
      googleAdsOk = true;
    } catch (err) {
      logSourceFailure("google_ads", organizationId, err);
    }

    try {
      const response = await fetchLocalServicesMetrics(client, {
        customerId: ads.customerId,
        developerToken: ads.developerToken,
        range,
      });
      rows.push(...mapLocalServicesMetrics({ organizationId, response }));
      localServicesAdsOk = true;
    } catch (err) {
      logSourceFailure("local_services_ads", organizationId, err);
    }
  }

  // Every attempted source failed → the connection is wholly broken; throw so the
  // run tally counts the org as FAILED rather than synced-with-zero. Unconfigured
  // paid feeds leave their flags false, which is harmless: a free source
  // succeeding is enough to keep the org out of this branch.
  if (!businessProfileOk && !searchConsoleOk && !googleAdsOk && !localServicesAdsOk) {
    throw new Error(`all Insights sources failed for org ${organizationId}`);
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
  // Resolves each org's paid-feed config (Google Ads + LSA), or null when the
  // org has no Ads connection. Omitted entirely until the cron is wired to it.
  getAdsConfig?: (organizationId: string) => Promise<AdsIngestConfig | null>;
}): Promise<InsightIngestRunResult> {
  const { db, organizationIds, today, getClient, windowDays, getAdsConfig } = input;
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
      const ads = getAdsConfig ? await getAdsConfig(organizationId) : null;
      const result = await ingestOrganizationInsights({
        db,
        organizationId,
        client,
        today,
        windowDays,
        ads: ads ?? undefined,
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
