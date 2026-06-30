import { describe, it, expect } from "vitest";
import { mapGoogleAdsMetrics, fetchGoogleAdsMetrics } from "./google-ads";

// Records the single fetch the fetcher makes, and replies with a canned body.
function recordingClient(reply: { ok?: boolean; status?: number; body?: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = {
    fetch: async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: input.toString(), init });
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        json: async () => reply.body ?? [],
      } as Response;
    },
  };
  return { client, calls };
}

describe("mapGoogleAdsMetrics", () => {
  it("maps a day's row into spend, clicks and conversions rows", () => {
    const rows = mapGoogleAdsMetrics({
      organizationId: "org-1",
      response: [
        {
          results: [
            {
              segments: { date: "2026-05-15" },
              // cost_micros is an int64 string; $12.34 is 12_340_000 micros.
              metrics: { costMicros: "12340000", clicks: "5", conversions: 2 },
            },
          ],
        },
      ],
    });

    expect(rows).toEqual([
      { organization_id: "org-1", source: "google_ads", metric_date: "2026-05-15", metric: "spend", value: 12.34 },
      { organization_id: "org-1", source: "google_ads", metric_date: "2026-05-15", metric: "clicks", value: 5 },
      { organization_id: "org-1", source: "google_ads", metric_date: "2026-05-15", metric: "conversions", value: 2 },
    ]);
  });

  it("flattens every searchStream batch, not just the first", () => {
    // searchStream chunks its rows across batches; all of them count.
    const rows = mapGoogleAdsMetrics({
      organizationId: "org-1",
      response: [
        { results: [{ segments: { date: "2026-05-10" }, metrics: { costMicros: "1000000", clicks: "1", conversions: 1 } }] },
        { results: [{ segments: { date: "2026-05-11" }, metrics: { costMicros: "2000000", clicks: "2", conversions: 2 } }] },
      ],
    });

    expect(rows.map((r) => [r.metric_date, r.metric, r.value])).toEqual([
      ["2026-05-10", "spend", 1],
      ["2026-05-10", "clicks", 1],
      ["2026-05-10", "conversions", 1],
      ["2026-05-11", "spend", 2],
      ["2026-05-11", "clicks", 2],
      ["2026-05-11", "conversions", 2],
    ]);
  });

  it("defaults omitted metric fields to zero", () => {
    // Google Ads omits a metric from the row when it is zero for the day.
    const rows = mapGoogleAdsMetrics({
      organizationId: "org-1",
      response: [{ results: [{ segments: { date: "2026-05-12" }, metrics: {} }] }],
    });

    expect(rows).toEqual([
      { organization_id: "org-1", source: "google_ads", metric_date: "2026-05-12", metric: "spend", value: 0 },
      { organization_id: "org-1", source: "google_ads", metric_date: "2026-05-12", metric: "clicks", value: 0 },
      { organization_id: "org-1", source: "google_ads", metric_date: "2026-05-12", metric: "conversions", value: 0 },
    ]);
  });

  it("skips a row that has no date", () => {
    const rows = mapGoogleAdsMetrics({
      organizationId: "org-1",
      response: [{ results: [{ metrics: { costMicros: "5000000" } }] }],
    });

    expect(rows).toEqual([]);
  });

  it("returns no rows for an empty response", () => {
    expect(mapGoogleAdsMetrics({ organizationId: "org-1", response: [] })).toEqual([]);
  });
});

describe("fetchGoogleAdsMetrics", () => {
  it("posts a read-only GAQL searchStream query with the developer token", async () => {
    const { client, calls } = recordingClient({ body: [{ results: [] }] });

    const result = await fetchGoogleAdsMetrics(client, {
      customerId: "1234567890",
      developerToken: "dev-token-xyz",
      range: { start: "2026-05-01", end: "2026-05-31" },
    });

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;

    // Read-only by construction: the only Ads endpoint ever hit is searchStream.
    // A mutate path (googleAds:mutate, :mutate) must never appear.
    expect(url).toContain("/customers/1234567890/googleAds:searchStream");
    expect(url).not.toContain("mutate");
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string>;
    expect(headers["developer-token"]).toBe("dev-token-xyz");

    const body = JSON.parse(init?.body as string);
    expect(body.query).toContain("metrics.cost_micros");
    expect(body.query).toContain("metrics.clicks");
    expect(body.query).toContain("metrics.conversions");
    expect(body.query).toContain("FROM customer");
    expect(body.query).toContain("2026-05-01");
    expect(body.query).toContain("2026-05-31");

    expect(result).toEqual([{ results: [] }]);
  });

  it("throws when the Ads API responds with an error", async () => {
    const { client } = recordingClient({ ok: false, status: 403 });

    await expect(
      fetchGoogleAdsMetrics(client, {
        customerId: "1234567890",
        developerToken: "dev-token-xyz",
        range: { start: "2026-05-01", end: "2026-05-31" },
      }),
    ).rejects.toThrow("403");
  });
});
