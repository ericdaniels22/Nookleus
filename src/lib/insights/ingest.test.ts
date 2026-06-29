import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  trailingWindow,
  ingestOrganizationInsights,
  ingestAllConnectedInsights,
} from "./ingest";

// In-memory insight_metric fake keyed by the conflict columns — an upsert with
// the same key REPLACES across calls, which is what proves a re-run is
// idempotent. WITHIN one batch a repeated conflict key throws, mirroring
// Postgres' cardinality_violation — so a multi-location collision can't hide
// behind last-write-wins.
function makeMetricsDb() {
  const store = new Map<string, Record<string, unknown>>();
  const client = {
    from() {
      return {
        async upsert(rows: Record<string, unknown>[], opts?: { onConflict?: string }) {
          const cols = (opts?.onConflict ?? "").split(",").map((c) => c.trim());
          const seenThisBatch = new Set<string>();
          for (const row of rows) {
            const key = cols.map((c) => String(row[c])).join("|");
            if (seenThisBatch.has(key)) {
              throw new Error(
                "ON CONFLICT DO UPDATE command cannot affect row a second time",
              );
            }
            seenThisBatch.add(key);
            store.set(key, { ...row });
          }
          return { data: null, error: null };
        },
      };
    },
  };
  return { db: client as unknown as SupabaseClient, rows: () => [...store.values()] };
}

// A whole-pipeline fake Google client: routes each request by URL across the
// five endpoints the ingest walks (accounts → locations → performance; sites →
// searchAnalytics), driving the REAL discovery/fetch helpers. `fail` makes one
// source's endpoints answer !ok (a 403/500), so the real helper throws — used to
// prove a failure in one source doesn't discard the other's rows.
function makeSyncClient(
  data: {
    gbpSeries: Array<{ dailyMetric: string; date: string; value: string }>;
    sites: Array<{ siteUrl: string; permissionLevel: string }>;
    scRows: Array<{ date: string; clicks: number; impressions: number }>;
  },
  fail?: { businessProfile?: boolean; searchConsole?: boolean },
) {
  const isSearchConsole = (url: string) =>
    url.startsWith("https://searchconsole.googleapis.com");
  const isBusinessProfile = (url: string) =>
    url.includes("mybusiness") || url.includes(":fetchMultiDailyMetricsTimeSeries");

  function failsFor(url: string): boolean {
    if (fail?.searchConsole && isSearchConsole(url)) return true;
    if (fail?.businessProfile && isBusinessProfile(url)) return true;
    return false;
  }

  function bodyFor(url: string): unknown {
    if (url.includes("/searchAnalytics/query")) {
      return {
        rows: data.scRows.map((r) => ({
          keys: [r.date],
          clicks: r.clicks,
          impressions: r.impressions,
        })),
      };
    }
    if (url.startsWith("https://searchconsole.googleapis.com/webmasters/v3/sites")) {
      return { siteEntry: data.sites };
    }
    if (url.includes("mybusinessaccountmanagement")) {
      return { accounts: [{ name: "accounts/1" }] };
    }
    if (url.includes("mybusinessbusinessinformation")) {
      return { locations: [{ name: "locations/9" }] };
    }
    if (url.includes(":fetchMultiDailyMetricsTimeSeries")) {
      return {
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: data.gbpSeries.map((s) => {
              const [year, month, day] = s.date.split("-").map(Number);
              return {
                dailyMetric: s.dailyMetric,
                timeSeries: { datedValues: [{ date: { year, month, day }, value: s.value }] },
              };
            }),
          },
        ],
      };
    }
    throw new Error(`unexpected URL: ${url}`);
  }

  return {
    async fetch(input: string | URL) {
      const url = input.toString();
      if (failsFor(url)) {
        return { ok: false, status: 403, json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => bodyFor(url) } as unknown as Response;
    },
  };
}

const SAMPLE = {
  gbpSeries: [{ dailyMetric: "CALL_CLICKS", date: "2026-06-25", value: "12" }],
  sites: [{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }],
  scRows: [{ date: "2026-06-25", clicks: 88, impressions: 1200 }],
};

// A two-location Business Profile client: accounts → two locations → per-location
// performance (calls only, the value keyed by location). No verified Search
// Console site, so SC is skipped — this isolates the multi-location path.
function makeMultiLocationGbpClient(input: {
  callsByLocation: Record<string, number>;
  date: string;
}) {
  function bodyFor(url: string): unknown {
    if (url.startsWith("https://searchconsole.googleapis.com/webmasters/v3/sites")) {
      return { siteEntry: [] };
    }
    if (url.includes("mybusinessaccountmanagement")) {
      return { accounts: [{ name: "accounts/1" }] };
    }
    if (url.includes("mybusinessbusinessinformation")) {
      return { locations: Object.keys(input.callsByLocation).map((name) => ({ name })) };
    }
    if (url.includes(":fetchMultiDailyMetricsTimeSeries")) {
      const location = Object.keys(input.callsByLocation).find((loc) =>
        url.includes(`${loc}:fetchMultiDailyMetricsTimeSeries`),
      );
      const [year, month, day] = input.date.split("-").map(Number);
      return {
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: [
              {
                dailyMetric: "CALL_CLICKS",
                timeSeries: {
                  datedValues: [
                    { date: { year, month, day }, value: String(input.callsByLocation[location!]) },
                  ],
                },
              },
            ],
          },
        ],
      };
    }
    throw new Error(`unexpected URL: ${url}`);
  }

  return {
    async fetch(input: string | URL) {
      return { ok: true, status: 200, json: async () => bodyFor(input.toString()) } as unknown as Response;
    },
  };
}

describe("trailingWindow", () => {
  it("spans the N days ending on (and including) today", () => {
    expect(trailingWindow("2026-06-25", 7)).toEqual({
      start: "2026-06-19",
      end: "2026-06-25",
    });
  });

  it("crosses a month boundary correctly", () => {
    expect(trailingWindow("2026-03-02", 5)).toEqual({
      start: "2026-02-26",
      end: "2026-03-02",
    });
  });
});

describe("ingestOrganizationInsights", () => {
  it("writes dated rows from both sources for the org", async () => {
    const fake = makeMetricsDb();
    const client = makeSyncClient(SAMPLE);

    const result = await ingestOrganizationInsights({
      db: fake.db,
      organizationId: "org-1",
      client,
      today: "2026-06-25",
    });

    const rows = fake.rows();
    expect(rows).toContainEqual({
      organization_id: "org-1",
      source: "business_profile",
      metric_date: "2026-06-25",
      metric: "calls",
      value: 12,
    });
    expect(rows.filter((r) => r.source === "search_console")).toHaveLength(2);
    expect(result.metricsSynced).toBe(3);
  });

  it("is idempotent: re-running the same day does not duplicate rows", async () => {
    const fake = makeMetricsDb();
    const client = makeSyncClient(SAMPLE);

    await ingestOrganizationInsights({
      db: fake.db,
      organizationId: "org-1",
      client,
      today: "2026-06-25",
    });
    await ingestOrganizationInsights({
      db: fake.db,
      organizationId: "org-1",
      client,
      today: "2026-06-25",
    });

    expect(fake.rows()).toHaveLength(3);
  });

  it("skips the Search Console pull when no verified site is connected", async () => {
    const fake = makeMetricsDb();
    const client = makeSyncClient({
      ...SAMPLE,
      sites: [{ siteUrl: "https://nope.com/", permissionLevel: "siteUnverifiedUser" }],
    });

    const result = await ingestOrganizationInsights({
      db: fake.db,
      organizationId: "org-1",
      client,
      today: "2026-06-25",
    });

    expect(fake.rows().every((r) => r.source === "business_profile")).toBe(true);
    expect(result.metricsSynced).toBe(1);
  });

  it("sums a metric across multiple Business Profile locations into one org-level row", async () => {
    const fake = makeMetricsDb();
    // Two locations both report calls for the same day. They share the
    // (org, source, day, metric) conflict key, so a naive single upsert batch
    // would trip Postgres' cardinality_violation and the org would get ZERO
    // insights. The ingest must instead land one org-level row, summed.
    const client = makeMultiLocationGbpClient({
      callsByLocation: { "locations/8": 12, "locations/9": 8 },
      date: "2026-06-25",
    });

    const result = await ingestOrganizationInsights({
      db: fake.db,
      organizationId: "org-1",
      client,
      today: "2026-06-25",
    });

    const callRows = fake
      .rows()
      .filter((r) => r.source === "business_profile" && r.metric === "calls");
    expect(callRows).toHaveLength(1);
    expect(callRows[0].value).toBe(20);
    // Both locations were pulled, but the tally reports rows actually written.
    expect(result.locations).toBe(2);
    expect(result.metricsSynced).toBe(1);
  });

  it("keeps the Business Profile rows when the Search Console pull fails", async () => {
    const fake = makeMetricsDb();
    // Existing connections predate the webmasters.readonly scope, so their
    // Search Console call 403s until they reconnect. That failure must NOT
    // discard the Business Profile rows already fetched in the same run.
    const client = makeSyncClient(SAMPLE, { searchConsole: true });

    const result = await ingestOrganizationInsights({
      db: fake.db,
      organizationId: "org-1",
      client,
      today: "2026-06-25",
    });

    expect(fake.rows()).toContainEqual({
      organization_id: "org-1",
      source: "business_profile",
      metric_date: "2026-06-25",
      metric: "calls",
      value: 12,
    });
    expect(fake.rows().every((r) => r.source === "business_profile")).toBe(true);
    expect(result.metricsSynced).toBe(1);
  });

  it("keeps the Search Console rows when the Business Profile pull fails", async () => {
    const fake = makeMetricsDb();
    const client = makeSyncClient(SAMPLE, { businessProfile: true });

    const result = await ingestOrganizationInsights({
      db: fake.db,
      organizationId: "org-1",
      client,
      today: "2026-06-25",
    });

    // SC contributes a clicks row and an impressions row; BP contributed none.
    expect(fake.rows().every((r) => r.source === "search_console")).toBe(true);
    expect(fake.rows()).toHaveLength(2);
    expect(result.metricsSynced).toBe(2);
  });
});

describe("ingestAllConnectedInsights", () => {
  it("partitions orgs into synced / skipped / failed without aborting", async () => {
    const fake = makeMetricsDb();
    const healthy = makeSyncClient(SAMPLE);
    // A client whose every request throws — the org ingest fails mid-run.
    const broken = {
      async fetch() {
        throw new Error("boom");
      },
    };

    const result = await ingestAllConnectedInsights({
      db: fake.db,
      organizationIds: ["org-ok", "org-disconnected", "org-error"],
      today: "2026-06-25",
      getClient: async (organizationId) => {
        if (organizationId === "org-ok") return healthy;
        if (organizationId === "org-error") return broken;
        return null; // org-disconnected has no usable connection
      },
    });

    expect(result).toEqual({
      organizations: 3,
      synced: 1,
      skipped: 1,
      failed: 1,
      metricsSynced: 3,
    });
    // The healthy org's rows still landed despite the broken org throwing.
    expect(fake.rows()).toHaveLength(3);
  });
});
