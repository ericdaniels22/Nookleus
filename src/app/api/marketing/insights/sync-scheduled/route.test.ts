import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/google/connection", () => ({
  listConnectedOrganizationIds: vi.fn(),
}));
vi.mock("@/lib/insights/ingest", () => ({
  ingestAllConnectedInsights: vi.fn(),
}));
vi.mock("@/lib/google/client", () => ({
  getGoogleClient: vi.fn(),
}));

import { GET } from "./route";
import { createServiceClient } from "@/lib/supabase-api";
import { listConnectedOrganizationIds } from "@/lib/google/connection";
import { ingestAllConnectedInsights } from "@/lib/insights/ingest";
import { getGoogleClient } from "@/lib/google/client";

const SECRET = "cron-secret-test";

function req(auth?: string) {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  return new Request("http://test/api/marketing/insights/sync-scheduled", {
    headers,
  });
}

let originalSecret: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  originalSecret = process.env.CRON_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

// GET /api/marketing/insights/sync-scheduled — the Vercel Cron entry point for
// the daily Insights ingestion. Same Bearer-CRON_SECRET guard as the reviews
// scheduled sync; fans out over every connected Organization via
// ingestAllConnectedInsights.
describe("GET /api/marketing/insights/sync-scheduled", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(500);
    expect(ingestAllConnectedInsights).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization bearer does not match", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(ingestAllConnectedInsights).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header is absent", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(ingestAllConnectedInsights).not.toHaveBeenCalled();
  });

  it("ingests every connected org over the service client and returns the tally", async () => {
    process.env.CRON_SECRET = SECRET;
    const service = { tag: "service" };
    vi.mocked(createServiceClient).mockReturnValue(service as never);
    vi.mocked(listConnectedOrganizationIds).mockResolvedValue(["org-1", "org-2"]);
    vi.mocked(ingestAllConnectedInsights).mockResolvedValue({
      organizations: 2,
      synced: 2,
      skipped: 0,
      failed: 0,
      metricsSynced: 11,
    });

    const res = await GET(req(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.synced).toBe(2);
    expect(body.metricsSynced).toBe(11);

    // The connected-org list is read over the privileged service client...
    expect(listConnectedOrganizationIds).toHaveBeenCalledWith(service);
    // ...and handed to the fan-out as organizationIds, over the same db, with a
    // concrete ISO `today` driving the trailing window.
    const arg = vi.mocked(ingestAllConnectedInsights).mock.calls[0][0];
    expect(arg.db).toBe(service);
    expect(arg.organizationIds).toEqual(["org-1", "org-2"]);
    expect(arg.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // getClient is wired to getGoogleClient over the service client, per-org.
    await arg.getClient("org-9");
    expect(getGoogleClient).toHaveBeenCalledWith(service, "org-9");
  });
});
