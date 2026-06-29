import { describe, it, expect } from "vitest";
import {
  mapBusinessProfileMetrics,
  fetchLocationPerformance,
  toPerformanceLocation,
} from "./business-profile";
import type {
  GbpDailyMetricTimeSeries,
  GbpPerformanceResponse,
} from "./business-profile";

// A fake authorized client: records the URL fetched and returns a canned JSON
// body, mirroring the reviews.ts test fakes (only `.fetch` is needed).
function makeClient(
  handler: (url: string) => { ok?: boolean; status?: number; body?: unknown },
) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async fetch(input: string | URL) {
        const url = input.toString();
        calls.push(url);
        const { ok = true, status = 200, body = {} } = handler(url);
        return {
          ok,
          status,
          json: async () => body,
        } as unknown as Response;
      },
    },
  };
}

// Build a fetchMultiDailyMetricsTimeSeries response from a flat list of metric
// series — the API nests them under multiDailyMetricTimeSeries[].dailyMetricTimeSeries.
function gbpResponse(series: GbpDailyMetricTimeSeries[]): GbpPerformanceResponse {
  return { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: series }] };
}

describe("mapBusinessProfileMetrics", () => {
  it("maps a CALL_CLICKS daily series to dated 'calls' rows", () => {
    const rows = mapBusinessProfileMetrics({
      organizationId: "org-1",
      response: gbpResponse([
        {
          dailyMetric: "CALL_CLICKS",
          timeSeries: {
            datedValues: [{ date: { year: 2026, month: 6, day: 25 }, value: "12" }],
          },
        },
      ]),
    });

    expect(rows).toEqual([
      {
        organization_id: "org-1",
        source: "business_profile",
        metric_date: "2026-06-25",
        metric: "calls",
        value: 12,
      },
    ]);
  });

  it("maps direction-request and website-click series to their store names", () => {
    const rows = mapBusinessProfileMetrics({
      organizationId: "org-1",
      response: gbpResponse([
        {
          dailyMetric: "BUSINESS_DIRECTION_REQUESTS",
          timeSeries: {
            datedValues: [{ date: { year: 2026, month: 6, day: 25 }, value: "3" }],
          },
        },
        {
          dailyMetric: "WEBSITE_CLICKS",
          timeSeries: {
            datedValues: [{ date: { year: 2026, month: 6, day: 25 }, value: "40" }],
          },
        },
      ]),
    });

    expect(rows.map((r) => [r.metric, r.value])).toEqual([
      ["direction_requests", 3],
      ["website_clicks", 40],
    ]);
  });

  it("emits one row per day across a multi-day series, zero-padding the date", () => {
    const rows = mapBusinessProfileMetrics({
      organizationId: "org-1",
      response: gbpResponse([
        {
          dailyMetric: "CALL_CLICKS",
          timeSeries: {
            datedValues: [
              { date: { year: 2026, month: 1, day: 9 }, value: "5" },
              { date: { year: 2026, month: 1, day: 10 }, value: "8" },
            ],
          },
        },
      ]),
    });

    expect(rows.map((r) => [r.metric_date, r.value])).toEqual([
      ["2026-01-09", 5],
      ["2026-01-10", 8],
    ]);
  });

  it("treats a day with no reported value as zero", () => {
    const rows = mapBusinessProfileMetrics({
      organizationId: "org-1",
      response: gbpResponse([
        {
          dailyMetric: "CALL_CLICKS",
          timeSeries: { datedValues: [{ date: { year: 2026, month: 6, day: 25 } }] },
        },
      ]),
    });

    expect(rows[0].value).toBe(0);
  });

  it("ignores a series for a metric the suite does not track", () => {
    const rows = mapBusinessProfileMetrics({
      organizationId: "org-1",
      response: gbpResponse([
        {
          dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
          timeSeries: {
            datedValues: [{ date: { year: 2026, month: 6, day: 25 }, value: "999" }],
          },
        },
      ]),
    });

    expect(rows).toEqual([]);
  });

  it("returns no rows for an empty response", () => {
    expect(
      mapBusinessProfileMetrics({ organizationId: "org-1", response: {} }),
    ).toEqual([]);
  });
});

describe("fetchLocationPerformance", () => {
  it("requests the three daily metrics over the date range for a location", async () => {
    const canned: GbpPerformanceResponse = {
      multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [] }],
    };
    const { client, calls } = makeClient(() => ({ body: canned }));

    const response = await fetchLocationPerformance(client, {
      location: "locations/555",
      range: { start: "2026-06-18", end: "2026-06-25" },
    });

    expect(response).toEqual(canned);
    expect(calls).toHaveLength(1);

    const url = new URL(calls[0]);
    expect(url.hostname).toBe("businessprofileperformance.googleapis.com");
    expect(url.pathname).toBe(
      "/v1/locations/555:fetchMultiDailyMetricsTimeSeries",
    );
    expect(url.searchParams.getAll("dailyMetrics")).toEqual([
      "CALL_CLICKS",
      "BUSINESS_DIRECTION_REQUESTS",
      "WEBSITE_CLICKS",
    ]);
    expect(url.searchParams.get("dailyRange.start_date.year")).toBe("2026");
    expect(url.searchParams.get("dailyRange.start_date.month")).toBe("6");
    expect(url.searchParams.get("dailyRange.start_date.day")).toBe("18");
    expect(url.searchParams.get("dailyRange.end_date.year")).toBe("2026");
    expect(url.searchParams.get("dailyRange.end_date.month")).toBe("6");
    expect(url.searchParams.get("dailyRange.end_date.day")).toBe("25");
  });

  it("throws when the performance API responds with an error status", async () => {
    const { client } = makeClient(() => ({ ok: false, status: 403 }));

    await expect(
      fetchLocationPerformance(client, {
        location: "locations/555",
        range: { start: "2026-06-18", end: "2026-06-25" },
      }),
    ).rejects.toThrow("403");
  });
});

describe("toPerformanceLocation", () => {
  it("reduces a v4 review location to the Performance API resource name", () => {
    expect(toPerformanceLocation("accounts/123/locations/456")).toBe(
      "locations/456",
    );
  });
});
