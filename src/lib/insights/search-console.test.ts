import { describe, it, expect } from "vitest";
import {
  mapSearchConsoleMetrics,
  listSearchConsoleSites,
  fetchSearchConsoleMetrics,
} from "./search-console";
import type { SearchConsoleQueryResponse } from "./search-console";

// Build a searchanalytics.query response from a flat list of date rows. Querying
// with dimensions: ["date"] returns one row per day, keyed by the ISO date.
function scResponse(
  rows: Array<{ date: string; clicks: number; impressions: number }>,
): SearchConsoleQueryResponse {
  return {
    rows: rows.map((r) => ({
      keys: [r.date],
      clicks: r.clicks,
      impressions: r.impressions,
    })),
  };
}

// A fake authorized client recording each request's url + init and returning a
// canned JSON body, mirroring the reviews.ts / business-profile.ts test fakes.
function makeClient(
  handler: (url: string) => { ok?: boolean; status?: number; body?: unknown },
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  return {
    calls,
    client: {
      async fetch(input: string | URL, init?: RequestInit) {
        const url = input.toString();
        calls.push({ url, init });
        const { ok = true, status = 200, body = {} } = handler(url);
        return { ok, status, json: async () => body } as unknown as Response;
      },
    },
  };
}

describe("mapSearchConsoleMetrics", () => {
  it("maps a date row to a clicks row and an impressions row", () => {
    const rows = mapSearchConsoleMetrics({
      organizationId: "org-1",
      response: scResponse([{ date: "2026-06-25", clicks: 88, impressions: 1200 }]),
    });

    expect(rows).toEqual([
      {
        organization_id: "org-1",
        source: "search_console",
        metric_date: "2026-06-25",
        metric: "clicks",
        value: 88,
      },
      {
        organization_id: "org-1",
        source: "search_console",
        metric_date: "2026-06-25",
        metric: "impressions",
        value: 1200,
      },
    ]);
  });

  it("emits a clicks and impressions row for each day in a multi-day window", () => {
    const rows = mapSearchConsoleMetrics({
      organizationId: "org-1",
      response: scResponse([
        { date: "2026-06-24", clicks: 10, impressions: 100 },
        { date: "2026-06-25", clicks: 12, impressions: 130 },
      ]),
    });

    expect(rows.map((r) => [r.metric_date, r.metric, r.value])).toEqual([
      ["2026-06-24", "clicks", 10],
      ["2026-06-24", "impressions", 100],
      ["2026-06-25", "clicks", 12],
      ["2026-06-25", "impressions", 130],
    ]);
  });

  it("treats a row with no reported clicks or impressions as zero", () => {
    const rows = mapSearchConsoleMetrics({
      organizationId: "org-1",
      response: { rows: [{ keys: ["2026-06-25"] }] },
    });

    expect(rows.map((r) => [r.metric, r.value])).toEqual([
      ["clicks", 0],
      ["impressions", 0],
    ]);
  });

  it("returns no rows for an empty response", () => {
    expect(
      mapSearchConsoleMetrics({ organizationId: "org-1", response: {} }),
    ).toEqual([]);
  });
});

describe("listSearchConsoleSites", () => {
  it("returns only the verified site URLs the connection can read", async () => {
    const { client, calls } = makeClient(() => ({
      body: {
        siteEntry: [
          { siteUrl: "https://example.com/", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:example.com", permissionLevel: "siteFullUser" },
          { siteUrl: "https://nope.com/", permissionLevel: "siteUnverifiedUser" },
        ],
      },
    }));

    const sites = await listSearchConsoleSites(client);

    expect(sites).toEqual(["https://example.com/", "sc-domain:example.com"]);
    expect(new URL(calls[0].url).hostname).toBe("searchconsole.googleapis.com");
  });
});

describe("fetchSearchConsoleMetrics", () => {
  it("POSTs a date-dimensioned query for the site over the range", async () => {
    const canned = scResponse([{ date: "2026-06-25", clicks: 88, impressions: 1200 }]);
    const { client, calls } = makeClient(() => ({ body: canned }));

    const response = await fetchSearchConsoleMetrics(client, {
      siteUrl: "https://example.com/",
      range: { start: "2026-06-18", end: "2026-06-25" },
    });

    expect(response).toEqual(canned);

    const { url, init } = calls[0];
    // The site URL is path-segment encoded ("/" → %2F, ":" → %3A).
    expect(url).toBe(
      "https://searchconsole.googleapis.com/webmasters/v3/sites/" +
        "https%3A%2F%2Fexample.com%2F/searchAnalytics/query",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      startDate: "2026-06-18",
      endDate: "2026-06-25",
      dimensions: ["date"],
    });
  });

  it("throws when the query responds with an error status", async () => {
    const { client } = makeClient(() => ({ ok: false, status: 403 }));

    await expect(
      fetchSearchConsoleMetrics(client, {
        siteUrl: "https://example.com/",
        range: { start: "2026-06-18", end: "2026-06-25" },
      }),
    ).rejects.toThrow("403");
  });
});
