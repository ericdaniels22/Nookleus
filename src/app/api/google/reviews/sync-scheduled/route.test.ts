import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-api", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/google/connection", () => ({
  listConnectedOrganizationIds: vi.fn(),
}));
vi.mock("@/lib/google/reviews", () => ({
  syncAllConnectedReviews: vi.fn(),
}));
vi.mock("@/lib/google/client", () => ({
  getGoogleClient: vi.fn(),
}));

import { GET } from "./route";
import { createServiceClient } from "@/lib/supabase-api";
import { listConnectedOrganizationIds } from "@/lib/google/connection";
import { syncAllConnectedReviews } from "@/lib/google/reviews";
import { getGoogleClient } from "@/lib/google/client";

const SECRET = "cron-secret-test";

function req(auth?: string) {
  const headers: Record<string, string> = {};
  if (auth !== undefined) headers.authorization = auth;
  return new Request("http://test/api/google/reviews/sync-scheduled", {
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

// GET /api/google/reviews/sync-scheduled — the Vercel Cron entry point. Same
// Bearer-CRON_SECRET guard as the QB scheduled sync; fans out over every
// connected Organization via syncAllConnectedReviews.
describe("GET /api/google/reviews/sync-scheduled", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(500);
    expect(syncAllConnectedReviews).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization bearer does not match", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(syncAllConnectedReviews).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header is absent", async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(syncAllConnectedReviews).not.toHaveBeenCalled();
  });

  it("syncs every connected org over the service client and returns the tally", async () => {
    process.env.CRON_SECRET = SECRET;
    const service = { tag: "service" };
    vi.mocked(createServiceClient).mockReturnValue(service as never);
    vi.mocked(listConnectedOrganizationIds).mockResolvedValue([
      "org-1",
      "org-2",
    ]);
    vi.mocked(syncAllConnectedReviews).mockResolvedValue({
      organizations: 2,
      synced: 2,
      skipped: 0,
      failed: 0,
      reviewsSynced: 7,
    });

    const res = await GET(req(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.synced).toBe(2);
    expect(body.reviewsSynced).toBe(7);

    // The connected-org list is read over the privileged service client...
    expect(listConnectedOrganizationIds).toHaveBeenCalledWith(service);
    // ...and handed to the fan-out as organizationIds, syncing over the same db.
    expect(syncAllConnectedReviews).toHaveBeenCalledWith(
      expect.objectContaining({
        db: service,
        organizationIds: ["org-1", "org-2"],
      }),
    );

    // getClient is wired to getGoogleClient over the service client, per-org.
    const arg = vi.mocked(syncAllConnectedReviews).mock.calls[0][0];
    await arg.getClient("org-9");
    expect(getGoogleClient).toHaveBeenCalledWith(service, "org-9");
  });
});
