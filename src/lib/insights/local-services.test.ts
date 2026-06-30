import { describe, it, expect } from "vitest";
import { mapLocalServicesMetrics, fetchLocalServicesMetrics } from "./local-services";

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

describe("mapLocalServicesMetrics", () => {
  it("maps a day's row into spend and leads rows", () => {
    const rows = mapLocalServicesMetrics({
      organizationId: "org-1",
      response: [
        {
          results: [
            {
              segments: { date: "2026-05-15" },
              // LSA charges per lead; the campaign's conversions are those leads.
              metrics: { costMicros: "75000000", conversions: 3 },
            },
          ],
        },
      ],
    });

    expect(rows).toEqual([
      { organization_id: "org-1", source: "local_services_ads", metric_date: "2026-05-15", metric: "spend", value: 75 },
      { organization_id: "org-1", source: "local_services_ads", metric_date: "2026-05-15", metric: "leads", value: 3 },
    ]);
  });

  it("defaults omitted metric fields to zero and skips dateless rows", () => {
    const rows = mapLocalServicesMetrics({
      organizationId: "org-1",
      response: [
        { results: [{ segments: { date: "2026-05-16" }, metrics: {} }] },
        { results: [{ metrics: { costMicros: "1000000" } }] },
      ],
    });

    expect(rows).toEqual([
      { organization_id: "org-1", source: "local_services_ads", metric_date: "2026-05-16", metric: "spend", value: 0 },
      { organization_id: "org-1", source: "local_services_ads", metric_date: "2026-05-16", metric: "leads", value: 0 },
    ]);
  });
});

describe("fetchLocalServicesMetrics", () => {
  it("posts a read-only GAQL query scoped to the Local Services campaign", async () => {
    const { client, calls } = recordingClient({ body: [{ results: [] }] });

    const result = await fetchLocalServicesMetrics(client, {
      customerId: "1234567890",
      developerToken: "dev-token-xyz",
      range: { start: "2026-05-01", end: "2026-05-31" },
    });

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;

    // Read-only by construction: searchStream only, never a mutate endpoint.
    expect(url).toContain("/customers/1234567890/googleAds:searchStream");
    expect(url).not.toContain("mutate");
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string>;
    expect(headers["developer-token"]).toBe("dev-token-xyz");

    const body = JSON.parse(init?.body as string);
    expect(body.query).toContain("LOCAL_SERVICES");
    expect(body.query).toContain("metrics.cost_micros");
    expect(body.query).toContain("metrics.conversions");
    expect(body.query).toContain("2026-05-01");
    expect(body.query).toContain("2026-05-31");

    expect(result).toEqual([{ results: [] }]);
  });

  it("throws when the Ads API responds with an error", async () => {
    const { client } = recordingClient({ ok: false, status: 500 });

    await expect(
      fetchLocalServicesMetrics(client, {
        customerId: "1234567890",
        developerToken: "dev-token-xyz",
        range: { start: "2026-05-01", end: "2026-05-31" },
      }),
    ).rejects.toThrow("500");
  });
});
